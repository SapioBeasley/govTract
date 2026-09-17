import type { HoustonCheckbookSourceMetadata } from "./adapter";

export const HOUSTON_CKAN_ACTION_BASE = "https://data.houstontx.gov/api/3/action";
export const HOUSTON_CHECKBOOK_PACKAGE = "checkbook";

interface CkanResource {
  id?: string;
  resource_id?: string;
  name?: string;
  format?: string;
  datastore_active?: boolean;
  last_modified?: string | null;
  hash?: string | null;
  url?: string;
}

interface CkanPackage {
  name?: string;
  metadata_modified?: string | null;
  resources?: CkanResource[];
}

interface CkanEnvelope<T> {
  success?: boolean;
  result?: T;
  error?: unknown;
}

export type HoustonCheckbookResource = HoustonCheckbookSourceMetadata & {
  fiscalYear: number;
};

export interface HoustonCheckbookPage {
  fields: Array<{ id: string; type: string }>;
  records: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

function nonblank(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function resourceFiscalYear(name: unknown) {
  const text = nonblank(name);
  if (!text) return null;
  const match = /^Checkbook\s+(\d{4})$/i.exec(text);
  return match ? Number(match[1]) : null;
}

export function extractHoustonCheckbookResources(pkg: CkanPackage): HoustonCheckbookResource[] {
  const packageName = nonblank(pkg.name) ?? HOUSTON_CHECKBOOK_PACKAGE;
  const packageRevision = nonblank(pkg.metadata_modified);

  return (pkg.resources ?? [])
    .map((resource): HoustonCheckbookResource | null => {
      const fiscalYear = resourceFiscalYear(resource.name);
      const resourceId = nonblank(resource.id) ?? nonblank(resource.resource_id);
      const resourceName = nonblank(resource.name);
      const resourceUrl = nonblank(resource.url);
      const resourceRevision =
        nonblank(resource.hash) ?? nonblank(resource.last_modified) ?? packageRevision;

      if (
        !fiscalYear ||
        !resource.datastore_active ||
        nonblank(resource.format)?.toUpperCase() !== "CSV" ||
        !resourceId ||
        !resourceName ||
        !resourceUrl ||
        !resourceRevision
      ) {
        return null;
      }

      return {
        fiscalYear,
        packageName,
        resourceId,
        resourceName,
        resourceRevision,
        resourceModifiedAt: nonblank(resource.last_modified),
        resourceUrl,
      };
    })
    .filter((resource): resource is HoustonCheckbookResource => resource !== null)
    .sort((left, right) => left.fiscalYear - right.fiscalYear);
}

export class HoustonCheckbookClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input?: { baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = input?.baseUrl ?? HOUSTON_CKAN_ACTION_BASE;
    this.fetchImpl = input?.fetchImpl ?? fetch;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      headers: {
        accept: "application/json",
        "user-agent": "govTract-houston-checkbook/1.0",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Houston CKAN request failed with HTTP ${response.status}: ${path}`);
    }

    const envelope = (await response.json()) as CkanEnvelope<T>;
    if (!envelope.success || envelope.result === undefined) {
      throw new Error(`Houston CKAN request failed: ${path}`);
    }
    return envelope.result;
  }

  async discoverResources() {
    const pkg = await this.request<CkanPackage>(
      `package_show?id=${encodeURIComponent(HOUSTON_CHECKBOOK_PACKAGE)}`,
    );
    const resources = extractHoustonCheckbookResources(pkg);
    if (resources.length === 0) {
      throw new Error("Houston Checkbook package has no active fiscal-year datastore resources");
    }
    return resources;
  }

  async fetchPage(
    resource: HoustonCheckbookResource,
    input: { limit: number; offset: number },
  ): Promise<HoustonCheckbookPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000) {
      throw new Error(`Invalid Houston Checkbook page limit: ${input.limit}`);
    }
    if (!Number.isInteger(input.offset) || input.offset < 0) {
      throw new Error(`Invalid Houston Checkbook page offset: ${input.offset}`);
    }

    const query = new URLSearchParams({
      resource_id: resource.resourceId,
      limit: String(input.limit),
      offset: String(input.offset),
    });
    const result = await this.request<{
      fields?: Array<{ id?: unknown; type?: unknown }>;
      records?: Array<Record<string, unknown>>;
      total?: unknown;
    }>(`datastore_search?${query.toString()}`);

    const total = Number(result.total);
    if (!Number.isInteger(total) || total < 0 || !Array.isArray(result.records)) {
      throw new Error(`Houston CKAN returned a malformed datastore page for ${resource.resourceId}`);
    }

    return {
      fields: (result.fields ?? [])
        .filter(
          (field): field is { id: string; type: string } =>
            typeof field.id === "string" && typeof field.type === "string",
        )
        .map((field) => ({ id: field.id, type: field.type })),
      records: result.records,
      total,
      limit: input.limit,
      offset: input.offset,
    };
  }
}
