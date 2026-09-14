import { generateSolicitationUnderstanding } from "@/lib/procurement/understanding/generation";

const opportunityId = "22259ea2-bcc1-450e-b6ed-a35cf71ab218";

const result = await generateSolicitationUnderstanding({
  opportunityId,
  trigger: "manual",
  explicitManualUserAction: true,
});

console.log(
  JSON.stringify({
    state: result.state,
    understandingId: "understandingId" in result ? result.understandingId : null,
    completenessStatus: "completenessStatus" in result ? result.completenessStatus : null,
    incompleteReason: "incompleteReason" in result ? result.incompleteReason : null,
    reason: "reason" in result ? result.reason : null,
  }),
);

if (result.state === "blocked" || result.state === "failed") {
  process.exitCode = 1;
}
