import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunities, opportunityClassifications } from "@/lib/db/schema";

export type OpportunityFeedMarket = "houston" | "all";
export type OpportunityFeedLevel = "federal" | "local";
export type OpportunityFeedSort = "relevance" | "newest" | "deadline";

export type OpportunityFeedClassification = {
  scheme: string;
  code: string | null;
  name: string;
};

export type OpportunityFeedItem = {
  id: string;
  source: string;
  solicitationNumber: string | null;
  title: string;
  status: string | null;
  opportunityType: string | null;
  agencyName: string | null;
  agencySlug: string | null;
  departments: string[];
  categories: string[];
  publishedAt: Date | null;
  dueAt: Date | null;
  canonicalUrl: string | null;
  location: Record<string, unknown>;
  classifications: OpportunityFeedClassification[];
};

export type OpportunityFeedFilters = {
  market: OpportunityFeedMarket;
  query?: string;
  source?: string;
  agency?: string;
  geography?: string;
  deadlineDays?: number;
  postedDays?: number;
  status?: string;
  opportunityType?: string;
  naics?: string;
  level?: OpportunityFeedLevel;
  sort?: OpportunityFeedSort;
  page?: number;
  pageSize?: number;
};

export type OpportunityFeedResult = {
  items: OpportunityFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type OpportunityFeedFacets = {
  sources: string[];
  agencies: string[];
  statuses: string[];
  opportunityTypes: string[];
};

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;
const FEDERAL_SOURCES = ["sam", "sam.gov", "sam-gov"];

function marketConditions(market: OpportunityFeedMarket) {
  const conditions = [eq(opportunities.isActive, true)];

  if (market === "houston") {
    conditions.push(eq(opportunities.agencySlug, "city-of-houston"));
  }

  return conditions;
}

function buildConditions(filters: OpportunityFeedFilters) {
  const conditions = marketConditions(filters.market);
  const now = new Date();
  const query = filters.query?.trim();

  if (query) {
    const pattern = `%${query}%`;
    const searchCondition = or(
      ilike(opportunities.title, pattern),
      ilike(opportunities.solicitationNumber, pattern),
      ilike(opportunities.agencyName, pattern),
      ilike(opportunities.description, pattern),
      sql<boolean>`array_to_string(${opportunities.departments}, ' ') ILIKE ${pattern}`,
      sql<boolean>`array_to_string(${opportunities.categories}, ' ') ILIKE ${pattern}`,
      sql<boolean>`EXISTS (
        SELECT 1
        FROM opportunity_classifications oc
        WHERE oc.opportunity_id = ${opportunities.id}
          AND (oc.code ILIKE ${pattern} OR oc.name ILIKE ${pattern})
      )`,
    );

    if (searchCondition) conditions.push(searchCondition);
  }

  if (filters.source) {
    conditions.push(eq(opportunities.source, filters.source));
  }

  if (filters.agency) {
    conditions.push(eq(opportunities.agencyName, filters.agency));
  }

  if (filters.geography?.trim()) {
    const pattern = `%${filters.geography.trim()}%`;
    conditions.push(sql<boolean>`${opportunities.location}::text ILIKE ${pattern}`);
  }

  if (filters.deadlineDays && filters.deadlineDays > 0) {
    conditions.push(gte(opportunities.dueAt, now));
    conditions.push(
      lte(
        opportunities.dueAt,
        new Date(now.getTime() + filters.deadlineDays * 24 * 60 * 60 * 1000),
      ),
    );
  }

  if (filters.postedDays && filters.postedDays > 0) {
    conditions.push(
      gte(
        opportunities.publishedAt,
        new Date(now.getTime() - filters.postedDays * 24 * 60 * 60 * 1000),
      ),
    );
  }

  if (filters.status) {
    conditions.push(eq(opportunities.status, filters.status));
  }

  if (filters.opportunityType) {
    conditions.push(eq(opportunities.opportunityType, filters.opportunityType));
  }

  if (filters.naics?.trim()) {
    const pattern = `${filters.naics.trim()}%`;
    conditions.push(sql<boolean>`EXISTS (
      SELECT 1
      FROM opportunity_classifications oc
      WHERE oc.opportunity_id = ${opportunities.id}
        AND lower(oc.scheme) = 'naics'
        AND oc.code ILIKE ${pattern}
    )`);
  }

  if (filters.level === "federal") {
    conditions.push(
      sql<boolean>`lower(${opportunities.source}) IN (${sql.join(
        FEDERAL_SOURCES.map((source) => sql`${source}`),
        sql`, `,
      )})`,
    );
  } else if (filters.level === "local") {
    conditions.push(
      sql<boolean>`lower(${opportunities.source}) NOT IN (${sql.join(
        FEDERAL_SOURCES.map((source) => sql`${source}`),
        sql`, `,
      )})`,
    );
  }

  return conditions;
}

function buildOrderBy(filters: OpportunityFeedFilters) {
  const query = filters.query?.trim();
  const sort = filters.sort ?? (query ? "relevance" : "deadline");

  if (sort === "newest") {
    return [desc(opportunities.publishedAt), asc(opportunities.dueAt)];
  }

  if (sort === "relevance" && query) {
    const pattern = `%${query}%`;
    const relevance = sql<number>`CASE
      WHEN ${opportunities.title} ILIKE ${pattern} THEN 5
      WHEN ${opportunities.solicitationNumber} ILIKE ${pattern} THEN 4
      WHEN ${opportunities.agencyName} ILIKE ${pattern} THEN 3
      WHEN array_to_string(${opportunities.categories}, ' ') ILIKE ${pattern} THEN 2
      WHEN ${opportunities.description} ILIKE ${pattern} THEN 1
      ELSE 0
    END`;

    return [desc(relevance), asc(opportunities.dueAt), desc(opportunities.publishedAt)];
  }

  return [asc(opportunities.dueAt), desc(opportunities.publishedAt)];
}

export async function getOpportunityFeed(
  filters: OpportunityFeedFilters,
): Promise<OpportunityFeedResult> {
  const db = getDb();
  const conditions = buildConditions(filters);
  const where = and(...conditions);
  const requestedPage = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(filters.pageSize ?? DEFAULT_PAGE_SIZE)),
  );

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(where);

  const total = Number(countRow?.count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);

  const rows = await db
    .select({
      id: opportunities.id,
      source: opportunities.source,
      solicitationNumber: opportunities.solicitationNumber,
      title: opportunities.title,
      status: opportunities.status,
      opportunityType: opportunities.opportunityType,
      agencyName: opportunities.agencyName,
      agencySlug: opportunities.agencySlug,
      departments: opportunities.departments,
      categories: opportunities.categories,
      publishedAt: opportunities.publishedAt,
      dueAt: opportunities.dueAt,
      canonicalUrl: opportunities.canonicalUrl,
      location: opportunities.location,
    })
    .from(opportunities)
    .where(where)
    .orderBy(...buildOrderBy(filters))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  if (rows.length === 0) {
    return { items: [], total, page, pageSize, pageCount };
  }

  const classifications = await db
    .select({
      opportunityId: opportunityClassifications.opportunityId,
      scheme: opportunityClassifications.scheme,
      code: opportunityClassifications.code,
      name: opportunityClassifications.name,
    })
    .from(opportunityClassifications)
    .where(
      inArray(
        opportunityClassifications.opportunityId,
        rows.map((row) => row.id),
      ),
    );

  const classificationsByOpportunity = new Map<string, OpportunityFeedClassification[]>();

  for (const classification of classifications) {
    const existing = classificationsByOpportunity.get(classification.opportunityId) ?? [];
    existing.push({
      scheme: classification.scheme,
      code: classification.code,
      name: classification.name,
    });
    classificationsByOpportunity.set(classification.opportunityId, existing);
  }

  return {
    items: rows.map((row) => ({
      ...row,
      classifications: classificationsByOpportunity.get(row.id) ?? [],
    })),
    total,
    page,
    pageSize,
    pageCount,
  };
}

export async function getOpportunityFeedFacets(
  market: OpportunityFeedMarket,
): Promise<OpportunityFeedFacets> {
  const db = getDb();
  const baseConditions = marketConditions(market);
  const baseWhere = and(...baseConditions);

  const [sourceRows, agencyRows, statusRows, typeRows] = await Promise.all([
    db
      .selectDistinct({ value: opportunities.source })
      .from(opportunities)
      .where(baseWhere)
      .orderBy(asc(opportunities.source)),
    db
      .selectDistinct({ value: opportunities.agencyName })
      .from(opportunities)
      .where(and(...baseConditions, isNotNull(opportunities.agencyName)))
      .orderBy(asc(opportunities.agencyName)),
    db
      .selectDistinct({ value: opportunities.status })
      .from(opportunities)
      .where(and(...baseConditions, isNotNull(opportunities.status)))
      .orderBy(asc(opportunities.status)),
    db
      .selectDistinct({ value: opportunities.opportunityType })
      .from(opportunities)
      .where(and(...baseConditions, isNotNull(opportunities.opportunityType)))
      .orderBy(asc(opportunities.opportunityType)),
  ]);

  return {
    sources: sourceRows.map((row) => row.value),
    agencies: agencyRows.flatMap((row) => (row.value ? [row.value] : [])),
    statuses: statusRows.flatMap((row) => (row.value ? [row.value] : [])),
    opportunityTypes: typeRows.flatMap((row) => (row.value ? [row.value] : [])),
  };
}
