import { and, eq } from "drizzle-orm";

import { isCurrentBidRequirement } from "@/lib/bids/requirement-questions";
import {
  isBidResponseSourceType,
  type BidResponseSourceType,
} from "@/lib/bids/requirement-question-rules";
import { getBidWorkspace } from "@/lib/bids/workspace";
import { bidRequirements } from "@/lib/db/canonical-schema";
import { getDb } from "@/lib/db/client";

export type UpdateBidRequirementResponseInput = {
  responseNotes: string | null;
  responseSourceType: BidResponseSourceType | null;
  responseSourceName: string | null;
};

export async function updateBidRequirementResponse(
  workspaceId: string,
  requirementId: string,
  input: UpdateBidRequirementResponseInput,
) {
  if (input.responseNotes !== null &&
      (typeof input.responseNotes !== "string" || input.responseNotes.length > 10_000)) {
    throw new Error("Requirement response must be text of at most 10,000 characters.");
  }
  if (input.responseSourceType !== null && !isBidResponseSourceType(input.responseSourceType)) {
    throw new Error("Requirement response source type is invalid.");
  }
  if (input.responseSourceName !== null &&
      (typeof input.responseSourceName !== "string" || input.responseSourceName.length > 500)) {
    throw new Error("Requirement response source name must be text of at most 500 characters.");
  }

  const answer = input.responseNotes?.trim() || null;
  const sourceName = input.responseSourceName?.trim() || null;
  if (answer && !input.responseSourceType) {
    throw new Error("Choose who supplied this requirement response.");
  }

  const workspace = await getBidWorkspace(workspaceId);
  if (!workspace) throw new Error("Bid workspace was not found.");
  const requirement = workspace.requirements.find((row) => row.id === requirementId);
  if (!requirement) throw new Error("Bid requirement was not found.");
  if (!isCurrentBidRequirement(requirement, workspace)) {
    throw new Error("This requirement belongs to an older solicitation version. Generate current requirement questions before editing it.");
  }

  await getDb().update(bidRequirements).set({
    responseNotes: answer,
    responseSourceType: answer ? input.responseSourceType : null,
    responseSourceName: answer ? sourceName : null,
    updatedAt: new Date(),
  }).where(and(
    eq(bidRequirements.id, requirementId),
    eq(bidRequirements.bidWorkspaceId, workspaceId),
  ));

  return getBidWorkspace(workspaceId);
}
