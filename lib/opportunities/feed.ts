import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { opportunities, opportunityClassifications } from "@/lib/db/schema";

export type OpportunityFeedMarket = "houston" | "all";

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

export async function getOpportunityFeed(
  market: OpportunityFeedMarket,
): Promise<OpportunityFeedItem[]> {
  const db = getDb();
  const activeFilter = eq(opportunities.isActive, true);
  const marketFilter =
    market === "houston"
      ? and(activeFilter, eq(opportunities.agencySlug, "city-of-houston"))
      : activeFilter;

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
    .where(marketFilter)
    .orderBy(asc(opportunities.dueAt), desc(opportunities.publishedAt));

  if (rows.length === 0) return [];

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

  const classificationsByOpportunity = new Map<
    string,
    OpportunityFeedClassification[]
  >();

  for (const classification of classifications) {
    const existing = classificationsByOpportunity.get(classification.opportunityId) ?? [];
    existing.push({
      scheme: classification.scheme,
      code: classification.code,
      name: classification.name,
    });
    classificationsByOpportunity.set(classification.opportunityId, existing);
  }

  return rows.map((row) => ({
    ...row,
    classifications: classificationsByOpportunity.get(row.id) ?? [],
  }));
}
