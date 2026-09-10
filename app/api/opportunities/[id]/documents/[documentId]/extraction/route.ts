import { and, asc, desc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/client";
import {
  documentExtractionSegments,
  documentExtractions,
  opportunityDocumentVersionExtractions,
} from "@/lib/db/document-extractions-schema";
import {
  opportunityDocuments,
  opportunityDocumentVersions,
} from "@/lib/db/schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 4;

function safeFailureMessage(code: string | null) {
  switch (code) {
    case "source_too_large":
      return "This document is above the current extraction size limit.";
    case "source_bytes_unavailable":
      return "The source file needs to be retrieved again before extraction can run.";
    case "extractor_error":
      return "The document could not be parsed. It can be retried in a later extraction run.";
    default:
      return "Document extraction did not complete. Check the next ingestion run or retry the extraction.";
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const { id, documentId } = await context.params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(documentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDb();
  const [document] = await db
    .select({ id: opportunityDocuments.id })
    .from(opportunityDocuments)
    .where(
      and(
        eq(opportunityDocuments.id, documentId),
        eq(opportunityDocuments.opportunityId, id),
        eq(opportunityDocuments.isActive, true),
      ),
    )
    .limit(1);

  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [latestVersion] = await db
    .select({
      id: opportunityDocumentVersions.id,
      versionNumber: opportunityDocumentVersions.versionNumber,
      checksumSha256: opportunityDocumentVersions.checksumSha256,
    })
    .from(opportunityDocumentVersions)
    .where(eq(opportunityDocumentVersions.opportunityDocumentId, documentId))
    .orderBy(desc(opportunityDocumentVersions.versionNumber))
    .limit(1);

  if (!latestVersion?.checksumSha256) {
    return NextResponse.json(
      { state: "pending", segments: [], hasMore: false, nextCursor: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const linkedExtractions = await db
    .select({
      id: documentExtractions.id,
      status: documentExtractions.status,
      checksumSha256: documentExtractions.checksumSha256,
      failureCode: documentExtractions.failureCode,
      truncated: documentExtractions.truncated,
    })
    .from(opportunityDocumentVersionExtractions)
    .innerJoin(
      documentExtractions,
      eq(opportunityDocumentVersionExtractions.documentExtractionId, documentExtractions.id),
    )
    .where(
      eq(
        opportunityDocumentVersionExtractions.opportunityDocumentVersionId,
        latestVersion.id,
      ),
    )
    .orderBy(desc(documentExtractions.updatedAt));

  const extraction =
    linkedExtractions.find(
      (candidate) => candidate.checksumSha256 === latestVersion.checksumSha256,
    ) ?? null;

  if (!extraction) {
    return NextResponse.json(
      { state: "pending", segments: [], hasMore: false, nextCursor: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (extraction.status === "failed") {
    return NextResponse.json(
      {
        state: "failed",
        message: safeFailureMessage(extraction.failureCode),
        segments: [],
        hasMore: false,
        nextCursor: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!["extracted", "truncated"].includes(extraction.status)) {
    return NextResponse.json(
      { state: "pending", segments: [], hasMore: false, nextCursor: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const cursorValue = Number(new URL(request.url).searchParams.get("after") ?? "-1");
  const cursor = Number.isInteger(cursorValue) && cursorValue >= -1 ? cursorValue : -1;
  const rows = await db
    .select({
      id: documentExtractionSegments.id,
      ordinal: documentExtractionSegments.ordinal,
      segmentType: documentExtractionSegments.segmentType,
      locator: documentExtractionSegments.locator,
      content: documentExtractionSegments.content,
    })
    .from(documentExtractionSegments)
    .where(
      and(
        eq(documentExtractionSegments.documentExtractionId, extraction.id),
        gt(documentExtractionSegments.ordinal, cursor),
      ),
    )
    .orderBy(asc(documentExtractionSegments.ordinal))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const segments = rows.slice(0, PAGE_SIZE);
  const nextCursor = hasMore ? segments.at(-1)?.ordinal ?? null : null;

  return NextResponse.json(
    {
      state: "extracted",
      versionNumber: latestVersion.versionNumber,
      checksumSha256: latestVersion.checksumSha256,
      truncated: extraction.truncated,
      segments,
      hasMore,
      nextCursor,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
