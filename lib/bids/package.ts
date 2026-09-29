import { createHash } from "node:crypto";

import { hasNeedsInput } from "@/lib/bids/full-bid";

export type PackageSupportingItem = {
  id: string;
  requirementKey: string;
  label: string;
  kind: string;
  required: boolean;
  conditional: boolean;
  originalForm: boolean;
  action: "external_attachment";
  sourceVersionIds?: string[];
  sourceFiles: string[];
  listingSource: boolean;
  ready: boolean;
  applicable: boolean;
  blocking: boolean;
};

export type PackageSupportingChecklist = {
  fingerprint: string;
  sourceCurrent: boolean;
  readyForPackage: boolean;
  blockingItemIds: string[];
  readyItemIds: string[];
  applicableItemIds: string[];
  items: PackageSupportingItem[];
};

export type BidPackageBlocker = {
  code: "draft_missing" | "source_not_current" | "needs_input" | "supporting_item";
  message: string;
  itemId?: string;
};

export type BidPackageApproval = {
  fingerprint: string;
  approvedAt: string;
};

function stableIds(values: string[]) {
  return [...new Set(values)].sort();
}

export function bidPackageFingerprint(input: {
  content: string | null;
  sourceFingerprint: string | null;
  understandingId: string | null;
  supportingChecklist: PackageSupportingChecklist;
}) {
  return createHash("sha256").update(JSON.stringify({
    content: input.content ?? "",
    sourceFingerprint: input.sourceFingerprint,
    understandingId: input.understandingId,
    supportingFingerprint: input.supportingChecklist.fingerprint,
    readyItemIds: stableIds(input.supportingChecklist.readyItemIds),
    applicableItemIds: stableIds(input.supportingChecklist.applicableItemIds),
  })).digest("hex");
}

export function evaluateBidPackageReadiness(input: {
  content: string | null;
  sourceReady: boolean;
  sourceBlockers: string[];
  sourceFingerprint: string | null;
  understandingId: string | null;
  supportingChecklist: PackageSupportingChecklist;
}) {
  const blockers: BidPackageBlocker[] = [];
  if (!input.content?.trim()) {
    blockers.push({ code: "draft_missing", message: "Create and save the bid response before package approval." });
  }
  if (!input.sourceReady || !input.supportingChecklist.sourceCurrent) {
    blockers.push({
      code: "source_not_current",
      message: input.sourceBlockers[0] ?? "Refresh the current solicitation source package before package approval.",
    });
  }
  if (input.content?.trim() && hasNeedsInput(input.content)) {
    blockers.push({
      code: "needs_input",
      message: "Resolve every Needs your input placeholder in the saved bid response before package approval.",
    });
  }
  const byId = new Map(input.supportingChecklist.items.map((item) => [item.id, item]));
  for (const itemId of input.supportingChecklist.blockingItemIds) {
    const item = byId.get(itemId);
    blockers.push({
      code: "supporting_item",
      itemId,
      message: item
        ? `Supporting material is still needed: ${item.label}`
        : "A required supporting item is still needed.",
    });
  }
  return {
    blockers,
    readyForApproval: blockers.length === 0,
    packageFingerprint: bidPackageFingerprint({
      content: input.content,
      sourceFingerprint: input.sourceFingerprint,
      understandingId: input.understandingId,
      supportingChecklist: input.supportingChecklist,
    }),
  };
}

export function isBidPackageApprovalCurrent(
  approval: BidPackageApproval | null | undefined,
  packageFingerprint: string,
) {
  return Boolean(approval && approval.fingerprint === packageFingerprint && approval.approvedAt);
}

export type BidPackageManifest = ReturnType<typeof buildBidPackageManifest>;

export function buildBidPackageManifest(input: {
  workspaceId: string;
  opportunityId: string;
  title: string;
  content: string;
  packageFingerprint: string;
  approvedAt: string;
  snapshotId: string | null;
  sourceFingerprint: string | null;
  understandingId: string | null;
  supportingChecklist: PackageSupportingChecklist;
  submission: { url: string | null; instructions: string[] };
}) {
  const contentSha256 = createHash("sha256").update(input.content).digest("hex");
  const supportingItems = [...input.supportingChecklist.items]
    .sort((left, right) => left.requirementKey.localeCompare(right.requirementKey) || left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      requirementKey: item.requirementKey,
      label: item.label,
      kind: item.kind,
      required: item.required,
      conditional: item.conditional,
      applicable: item.required || item.applicable,
      ready: item.ready,
      originalForm: item.originalForm,
      sourceFiles: [...item.sourceFiles].sort(),
      delivery: "external" as const,
      note: "This supporting file is not stored in this govTract package. Add the completed file separately in the authoritative procurement system.",
    }));
  return {
    schemaVersion: "govtract-bid-package-v1" as const,
    workspaceId: input.workspaceId,
    opportunityId: input.opportunityId,
    title: input.title,
    packageFingerprint: input.packageFingerprint,
    approvedAt: input.approvedAt,
    source: {
      snapshotId: input.snapshotId,
      documentSetFingerprint: input.sourceFingerprint,
      understandingId: input.understandingId,
    },
    primaryArtifact: {
      path: "bid-response.md" as const,
      sha256: contentSha256,
      byteLength: Buffer.byteLength(input.content, "utf8"),
    },
    supportingItems,
    submission: {
      url: input.submission.url,
      instructions: [...input.submission.instructions],
      submittedByGovTract: false as const,
    },
  };
}

function writeString(buffer: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar field exceeds ${length} bytes.`);
  bytes.copy(buffer, offset, 0, bytes.length);
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const digits = Math.max(1, length - 1);
  const octal = Math.max(0, value).toString(8).padStart(digits - 1, "0") + "\0";
  writeString(buffer, offset, length, octal.slice(-length));
}

function tarHeader(name: string, size: number) {
  const header = Buffer.alloc(512, 0);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "govtract");
  writeString(header, 297, 32, "govtract");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 6, checksumText);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function tarEntry(name: string, content: Buffer) {
  const padding = (512 - (content.length % 512)) % 512;
  return Buffer.concat([tarHeader(name, content.length), content, Buffer.alloc(padding, 0)]);
}

export function buildBidPackageTar(content: string, manifest: BidPackageManifest) {
  const response = Buffer.from(content, "utf8");
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return Buffer.concat([
    tarEntry("bid-response.md", response),
    tarEntry("manifest.json", manifestBytes),
    Buffer.alloc(1024, 0),
  ]);
}
