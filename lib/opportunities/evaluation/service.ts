import { getDefaultCompanyProfile } from "@/lib/company/profile";
import { getOpportunityDetail } from "@/lib/opportunities/detail";
import {
  getOpportunityDecision,
  loadLatestOpportunityEvaluation,
  persistOpportunityEvaluation,
} from "@/lib/opportunities/evaluation/persistence";
import { evaluateOpportunityInputs } from "@/lib/opportunities/evaluation/rules";
import {
  loadLatestSolicitationRequirements,
  materializeRequirementsForUnderstanding,
} from "@/lib/procurement/requirements/persistence";
import { loadLatestCompletedSolicitationUnderstanding } from "@/lib/procurement/understanding/read";

export class OpportunityEvaluationPrerequisiteError extends Error {
  constructor(
    public readonly code: "company_profile_missing" | "opportunity_not_found",
    message: string,
  ) {
    super(message);
    this.name = "OpportunityEvaluationPrerequisiteError";
  }
}

export async function runOpportunityEvaluation(opportunityId: string) {
  const [profile, opportunity, understanding] = await Promise.all([
    getDefaultCompanyProfile(),
    getOpportunityDetail(opportunityId),
    loadLatestCompletedSolicitationUnderstanding(opportunityId),
  ]);

  if (!profile) {
    throw new OpportunityEvaluationPrerequisiteError(
      "company_profile_missing",
      "Complete the company profile before evaluating an opportunity.",
    );
  }
  if (!opportunity) {
    throw new OpportunityEvaluationPrerequisiteError(
      "opportunity_not_found",
      "Opportunity was not found.",
    );
  }

  if (understanding) {
    await materializeRequirementsForUnderstanding(understanding.id);
  }
  const requirements = await loadLatestSolicitationRequirements(opportunityId);

  const result = evaluateOpportunityInputs({
    now: new Date(),
    profile: {
      productsServices: profile.productsServices,
      capabilities: profile.capabilities,
      preferredIndustries: profile.preferredIndustries,
      preferredKeywords: profile.preferredKeywords,
      excludedKeywords: profile.excludedKeywords,
      serviceAreas: profile.serviceAreas,
      preferredContractMin: profile.preferredContractMin,
      preferredContractMax: profile.preferredContractMax,
      naicsCodes: profile.naicsCodes,
      certifications: profile.certifications,
      statuses: profile.statuses,
      licenses: profile.licenses,
      governmentRegistrations: profile.governmentRegistrations,
      pastPerformance: profile.pastPerformance,
    },
    opportunity: {
      dueAt: opportunity.dueAt,
      location: opportunity.location,
      classifications: opportunity.classifications.map((classification) => ({
        scheme: classification.scheme,
        code: classification.code,
        name: classification.name,
      })),
    },
    requirements,
  });

  return persistOpportunityEvaluation({
    opportunityId,
    companyProfileId: profile.id,
    solicitationUnderstandingId: requirements?.understandingId ?? understanding?.id ?? null,
    result,
  });
}

export async function loadOpportunityEvaluationState(opportunityId: string) {
  const profile = await getDefaultCompanyProfile();
  if (!profile) {
    return {
      profileAvailable: false as const,
      profileId: null,
      evaluation: null,
      decision: null,
    };
  }

  const [evaluation, decision] = await Promise.all([
    loadLatestOpportunityEvaluation(opportunityId, profile.id),
    getOpportunityDecision(opportunityId, profile.id),
  ]);

  return {
    profileAvailable: true as const,
    profileId: profile.id,
    evaluation,
    decision,
  };
}
