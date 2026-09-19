import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

export type PlannedBidOutlineSection = {
  title: string;
  instructions: string;
  content: null;
  status: "draft";
  requirementLinks: { sourceRequirementKeys: string[] };
  sortOrder: number;
  wordCount: 0;
  metadata: {
    outlineKey: string;
    pageLimit: number | null;
    formatting: string | null;
    source: "solicitation_heading" | "fallback_group";
  };
};

type Group = {
  title: string;
  order: number | null;
  firstAppearance: number;
  source: PlannedBidOutlineSection["metadata"]["source"];
  requirements: PersistedSolicitationRequirement[];
};

const excludedTypes = new Set(["evaluation", "disqualifier", "deadline", "schedule", "mandatory_event", "location", "quantity"]);

function meaningfulString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function explicitHeading(requirement: PersistedSolicitationRequirement): string | null {
  const details = requirement.details;
  for (const key of ["responseHeading", "responseSection", "sectionHeading"]) {
    const heading = meaningfulString(details[key]);
    if (heading) return heading;
  }
  // Only a section heading anchored at the beginning can override the fallback;
  // arbitrary prose or submission metadata is not treated as an ordered heading.
  const text = requirement.text.trim();
  if (/^(?:section|volume)\s+(?:\d+|[IVXLC]+)\s*[:.\-–]\s*\S/i.test(text)) {
    return text.split(/\s+[—–]\s+(?:maximum|max|up to|no more than)\b/i)[0]!.replace(/\.\s*$/, "").trim();
  }
  return null;
}

function explicitOrder(requirement: PersistedSolicitationRequirement, heading: string): number | null {
  const order = requirement.details.responseOrder ?? requirement.details.sectionOrder;
  if (typeof order === "number" && Number.isFinite(order) && order >= 0) return order;
  const match = heading.match(/^(?:section|volume)\s+(\d+|[IVXLC]+)\s*[:.\-–]/i);
  if (!match) return null;
  if (/^\d+$/.test(match[1]!)) return Number(match[1]);
  const roman = match[1]!.toUpperCase();
  if (!/^(?:X{0,3})(?:IX|IV|V?I{0,3})$/.test(roman)) return null;
  const numerals: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const n = numerals[roman[i]!]!;
    total += n < (numerals[roman[i + 1]!] ?? 0) ? -n : n;
  }
  return total || null;
}

function fallbackTitle(requirement: PersistedSolicitationRequirement): string | null {
  switch (requirement.type) {
    case "scope":
    case "deliverable":
    case "work":
      return "Technical response";
    case "pricing":
      return "Pricing response";
    case "qualification":
    case "license":
      return "Qualifications";
    case "certification":
    case "insurance":
    case "bonding":
    case "insurance_bonding":
      return "Certifications and supporting documents";
    case "form":
      return "Required forms and attachments";
    case "submission_instruction":
      return "Submission package";
    default:
      return null;
  }
}

function pageLimit(requirement: PersistedSolicitationRequirement): number | null {
  for (const key of ["pageLimit", "maxPages"]) {
    const value = requirement.details[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  const match = requirement.text.match(/\b(?:maximum|max|no more than|not exceed|up to)\s+(\d+)\s+pages?\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Deterministic, user-invoked outline planning from persisted solicitation requirements.
 * Explicit headings and their order win; generic groups are labeled as fallback, never
 * presented as authoritative solicitation headings. No model, network, or DB work occurs.
 */
export function planBidOutline(requirements: PersistedSolicitationRequirement[]): PlannedBidOutlineSection[] {
  const groups = new Map<string, Group>();

  requirements.forEach((requirement, index) => {
    const heading = explicitHeading(requirement);
    if (!heading && excludedTypes.has(requirement.type)) return;
    const title = heading ?? fallbackTitle(requirement);
    if (!title) return;
    const key = heading ? "heading:" + title.toLocaleLowerCase("en-US") : "fallback:" + title;
    const previous = groups.get(key);
    if (previous) {
      previous.requirements.push(requirement);
      return;
    }
    groups.set(key, {
      title,
      order: heading ? explicitOrder(requirement, heading) : null,
      firstAppearance: index,
      source: heading ? "solicitation_heading" : "fallback_group",
      requirements: [requirement],
    });
  });

  return [...groups.entries()]
    .sort((a, b) => {
      const first = a[1];
      const second = b[1];
      if (first.source !== second.source) return first.source === "solicitation_heading" ? -1 : 1;
      if (first.source === "solicitation_heading" && second.source === "solicitation_heading") {
        if (first.order !== null && second.order !== null && first.order !== second.order) return first.order - second.order;
        if (first.order !== null && second.order === null) return -1;
        if (first.order === null && second.order !== null) return 1;
      }
      return first.firstAppearance - second.firstAppearance;
    })
    .map(([key, group], sortOrder) => {
      const limits = group.requirements.map(pageLimit).filter((n): n is number => n !== null);
      const formatting = group.requirements.map((r) => meaningfulString(r.details.formatting)).find((n) => n !== null) ?? null;
      const sourceInstructions = [...new Set(group.requirements.map((r) => r.text.trim()).filter(Boolean))];
      return {
        title: group.title,
        instructions: [
          ...sourceInstructions,
          ...(limits.length ? ["Page limit: " + Math.min(...limits) + " pages."] : []),
          ...(formatting ? ["Formatting: " + formatting] : []),
        ].join("\n"),
        content: null,
        status: "draft" as const,
        requirementLinks: { sourceRequirementKeys: [...new Set(group.requirements.map((r) => r.requirementKey))] },
        sortOrder,
        wordCount: 0 as const,
        metadata: {
          outlineKey: key,
          pageLimit: limits.length ? Math.min(...limits) : null,
          formatting,
          source: group.source,
        },
      };
    });
}
