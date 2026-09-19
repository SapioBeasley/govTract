import assert from "node:assert/strict";
import test from "node:test";

import { planBidOutline } from "@/lib/bids/outline";
import type { PersistedSolicitationRequirement } from "@/lib/procurement/requirements/persistence";

function requirement(
  key: string,
  type: string,
  text: string,
  details: Record<string, unknown> = {},
  sourceSection = "submissionComponents",
): PersistedSolicitationRequirement {
  return {
    id: key,
    requirementKey: key,
    type,
    level: "required",
    text,
    sourceSection,
    sourceFindingKey: key,
    details,
    evidence: [],
  };
}

test("explicit solicitation headings and order override generic response templates", () => {
  const requirements = [
    requirement("pricing", "pricing", "Complete the pricing worksheet.", {}, "pricingInstructions"),
    requirement("technical", "submission_instruction", "Describe the technical solution.", {
      responseHeading: "Volume II — Technical Proposal",
      responseOrder: 2,
      pageLimit: 12,
      formatting: "11-point font; single-spaced",
    }),
    requirement("cover", "submission_instruction", "Include a signed cover letter.", {
      responseHeading: "Volume I — Cover Letter",
      responseOrder: 1,
    }),
    requirement("other", "evaluation", "Evaluation weighs experience at 40%.", {}, "evaluationCriteria"),
  ];
  const sections = planBidOutline(requirements);
  assert.deepEqual(sections.map((section) => section.title), [
    "Volume I — Cover Letter",
    "Volume II — Technical Proposal",
    "Pricing response",
  ]);
  assert.deepEqual(sections[1]?.requirementLinks.sourceRequirementKeys, ["technical"]);
  assert.deepEqual(sections[1]?.metadata.pageLimit, 12);
  assert.equal(sections[1]?.instructions?.includes("11-point font; single-spaced"), true);
  assert.equal(sections.some((section) => section.instructions?.includes("Evaluation weighs")), false);
  assert.equal(sections.every((section) => section.content === null), true);
});

test("requirements with matching headings share one section and keep all requirement links", () => {
  const requirements = [
    requirement("a", "submission_instruction", "Provide organization chart.", { responseHeading: "Section 3: Staffing", responseOrder: 3 }),
    requirement("b", "qualification", "Include staff licenses.", { responseHeading: "Section 3: Staffing", responseOrder: 3 }, "qualifications"),
    requirement("c", "form", "Submit Form A."),
  ];
  const sections = planBidOutline(requirements);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections[0]?.requirementLinks.sourceRequirementKeys, ["a", "b"]);
  assert.deepEqual(sections[1]?.requirementLinks.sourceRequirementKeys, ["c"]);
  assert.equal(sections[0]?.sortOrder, 0);
  assert.equal(sections[1]?.sortOrder, 1);
});

test("fallback sections remain evidence-linked without inventing a solicitation section order", () => {
  const requirements = [
    requirement("tech", "scope", "Describe approach.", {}, "scope"),
    requirement("price", "pricing", "Provide unit rates.", {}, "pricingInstructions"),
    requirement("event", "mandatory_event", "Attend a prebid meeting.", {}, "mandatoryEvents"),
  ];
  const first = planBidOutline(requirements);
  assert.deepEqual(first.map((section) => section.title), ["Technical response", "Pricing response"]);
  assert.deepEqual(first[0]?.requirementLinks.sourceRequirementKeys, ["tech"]);
  assert.deepEqual(planBidOutline(requirements), first);
});

test("anchored Section headings and page limits are retained rather than replaced by a generic template", () => {
  const sections = planBidOutline([
    requirement("section4", "submission_instruction", "Section 4: Technical Approach — maximum 15 pages."),
    requirement("section2", "submission_instruction", "Section 2: Project Management — maximum 5 pages."),
  ]);
  assert.deepEqual(sections.map((section) => section.title), [
    "Section 2: Project Management",
    "Section 4: Technical Approach",
  ]);
  assert.deepEqual(sections.map((section) => section.metadata.pageLimit), [5, 15]);
});
