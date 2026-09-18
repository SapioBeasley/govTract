import type {
  HistoricalProcurementIdentifier,
  HistoricalProcurementSourceAdapter,
} from "@/lib/procurement/historical/adapter";

export const HOUSTON_CHECKBOOK_SOURCE = "houston-open-checkbook";
export const HOUSTON_CHECKBOOK_AGENCY = "City of Houston";
export const HOUSTON_CHECKBOOK_DATASET_URL = "https://data.houstontx.gov/dataset/checkbook";

export type HoustonCheckbookSourceMetadata = {
  packageName: string;
  resourceId: string;
  resourceName: string;
  resourceRevision: string;
  resourceModifiedAt?: string | null;
  resourceUrl: string;
};

export type HoustonCheckbookRecord = Record<string, unknown> & {
  source: HoustonCheckbookSourceMetadata;
  row: Record<string, unknown>;
};

function optionalText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function requiredRowId(record: HoustonCheckbookRecord) {
  const id = optionalText(record.row._id);
  if (!id) throw new Error("Houston Checkbook row is missing _id");
  return id;
}

function parseOptionalDate(value: unknown) {
  const text = optionalText(value);
  if (!text) return null;

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Invalid Houston Checkbook clearing date: ${text}`);

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid Houston Checkbook clearing date: ${text}`);
  }
  return date;
}

function parseOptionalTimestamp(value: unknown) {
  const text = optionalText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseOptionalFiscalYear(value: unknown) {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^\d{4}$/.test(text)) throw new Error(`Invalid Houston Checkbook fiscal year: ${text}`);
  return Number(text);
}

function parseOptionalAmount(value: unknown) {
  const text = optionalText(value);
  if (!text) return null;
  const normalized = text.replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid Houston Checkbook amount: ${text}`);
  }
  return normalized;
}

function identifier(type: string, value: unknown): HistoricalProcurementIdentifier | null {
  const text = optionalText(value);
  return text ? { type, value: text } : null;
}

function compactIdentifiers(
  values: Array<HistoricalProcurementIdentifier | null>,
): HistoricalProcurementIdentifier[] {
  return values.filter((value): value is HistoricalProcurementIdentifier => value !== null);
}

export const houstonCheckbookAdapter: HistoricalProcurementSourceAdapter<HoustonCheckbookRecord> = {
  source: HOUSTON_CHECKBOOK_SOURCE,

  identify(record) {
    return {
      sourceRecordId: `${record.source.resourceId}:${requiredRowId(record)}`,
      sourceRevisionId: record.source.resourceRevision,
    };
  },

  toSourceRecord(record, context) {
    return {
      sourceRecordId: `${record.source.resourceId}:${requiredRowId(record)}`,
      sourceRevisionId: record.source.resourceRevision,
      sourceModifiedAt: parseOptionalTimestamp(record.source.resourceModifiedAt),
      sourceAgency: context.agency ?? HOUSTON_CHECKBOOK_AGENCY,
      canonicalUrl: record.source.resourceUrl || context.canonicalUrl || HOUSTON_CHECKBOOK_DATASET_URL,
      rawPayload: record.row,
    };
  },

  normalize(record, context) {
    const row = record.row;
    const departmentId = optionalText(row["Department ID"]);
    const departmentName = optionalText(row["Department Name"]);
    const vendorName = optionalText(row["Vendor Name"]);
    const amount = parseOptionalAmount(row.Amount);
    const fiscalYear = parseOptionalFiscalYear(row["Fiscal Year"]);
    const occurredAt = parseOptionalDate(row["Clearing Date"]);
    const agencyName = context.agency ?? HOUSTON_CHECKBOOK_AGENCY;

    return [
      {
        sourceFactKey: "payment",
        recordType: "payment",
        title: optionalText(row["Payment Document Number"])
          ? `Houston payment ${optionalText(row["Payment Document Number"])}`
          : "Houston vendor payment",
        occurredAt,
        fiscalYear,
        monetary: amount
          ? {
              type: "payment",
              amount,
              currency: "USD",
            }
          : null,
        buyer: {
          name: agencyName,
          unitName: departmentName,
          sourceNativeId: departmentId,
        },
        vendor: vendorName ? { name: vendorName } : null,
        identifiers: compactIdentifiers([
          identifier("payment_document", row["Payment Document Number"]),
          identifier("vendor_invoice", row["Vendor Invoice"]),
          identifier("purchase_order", row["Purchase Order Number"]),
          identifier("purchase_order_item", row["Purchase Order Item"]),
          identifier("contract", row["Contract Number"]),
          identifier("wbs", row["WBS ID"]),
          identifier("fund", row["Fund ID"]),
          identifier("gl_account", row["GL Account Number"]),
        ]),
        metadata: {
          procurementType: optionalText(row["Type of procurement"]),
          fundName: optionalText(row["Fund Name"]),
          wbsDescription: optionalText(row["WBS Description"]),
          glAccountDescription: optionalText(row["GL Account Description"]),
          sourcePackage: record.source.packageName,
          sourceResourceId: record.source.resourceId,
          sourceResourceName: record.source.resourceName,
        },
        evidence: {
          sourceResourceId: record.source.resourceId,
          sourceRowId: requiredRowId(record),
          sourceFields: {
            paymentDocumentNumber: "Payment Document Number",
            amount: "Amount",
            date: "Clearing Date",
            vendor: "Vendor Name",
            department: "Department Name",
          },
        },
      },
    ];
  },
};
