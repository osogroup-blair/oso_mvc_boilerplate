import { workflowInfo } from "@temporalio/workflow";
import { showcaseActivities, type UnderwritingCheckType, type UnderwritingCheckResult, type UnderwritingRiskCheckChildInput } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function underwritingRiskCheckChildWorkflow(
  input: UnderwritingRiskCheckChildInput
): Promise<UnderwritingCheckResult> {
 return runVersionedWorkflow(undefined, async()=>{
  const info = workflowInfo();
  const required: Record<UnderwritingCheckType, string[]> = {
    identity: ["identityDocument", "businessRegistration"],
    financial: ["bankStatements", "requestedAmount"],
    fraud: ["identityDocument", "bankStatements"],
  };
  const missingFields = required[input.checkType].filter((field) => input.data[field] === undefined || input.data[field] === "");
  await showcaseActivities.runShowcaseSyntheticStep({
    orgId: input.orgId,
    workflowDefinitionKey: input.workflowDefinitionKey,
    requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.underwritingCapstone">,
    stepKey: `underwriting.riskCheck.${input.checkType}`,
    idempotencyKey: `${info.workflowId}:risk-check`,
    payload: {
      parentWorkflowId: input.parentWorkflowId,
      applicationId: input.applicationId,
      checkType: input.checkType,
      missingFields,
      attempt: input.attempt,
    },
  });
  if (missingFields.length > 0) {
    return {
      checkType: input.checkType,
      status: "insufficient_information",
      riskScore: 50,
      findings: [{
        checkType: input.checkType,
        severity: "medium",
        message: `${input.checkType} check needs ${missingFields.join(", ")}`,
      }],
      missingFields,
      affectedByFields: missingFields,
      checkedAt: new Date().toISOString(),
      summary: `${input.checkType} check requires additional information.`,
    };
  }
  const riskFlags = String(input.data.riskFlags ?? "").toLowerCase();
  const highRisk = input.demoScenario === "auto_reject" || riskFlags.includes(input.checkType) || input.data[`${input.checkType}Risk`] === "high";
  const mediumRisk = input.demoScenario === "manual_review" || riskFlags.includes("medium") || input.data[`${input.checkType}Risk`] === "medium";
  const riskScore = highRisk ? 86 : mediumRisk ? 58 : input.checkType === "financial" && Number(input.data.requestedAmount ?? 0) > 100_000 ? 62 : 18;
  return {
    checkType: input.checkType,
    status: riskScore >= 80 ? "failed" : "passed",
    riskScore,
    findings: [{
      checkType: input.checkType,
      severity: riskScore >= 80 ? "high" : riskScore >= 50 ? "medium" : "info",
      message: riskScore >= 80
        ? `${input.checkType} check found a synthetic high-risk signal.`
        : riskScore >= 50
          ? `${input.checkType} check requires analyst review.`
          : `${input.checkType} check passed synthetic policy.`,
    }],
    missingFields: [],
    affectedByFields: [],
    checkedAt: new Date().toISOString(),
    summary: `${input.checkType} check completed with risk score ${riskScore}.`,
  };

 });
}
