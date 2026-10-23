import { workflowInfo } from "@temporalio/workflow";
import { showcaseActivities, type ClientEngagementChildInput, type ClientEngagementWorkstreamResult } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';

export async function clientEngagementWorkstreamWorkflow(
  input: ClientEngagementChildInput
): Promise<ClientEngagementWorkstreamResult> {
 return runVersionedWorkflow(undefined, async()=>{
  const info = workflowInfo();
  const result = await showcaseActivities.runShowcaseSyntheticStep({
    orgId: input.orgId,
    workflowDefinitionKey: input.workflowDefinitionKey,
    requirementKey: "syntheticEcho",
    stepKey: `clientEngagement.workstream.${input.workstream}`,
    idempotencyKey: `${info.workflowId}:deliver`,
    payload: {
      parentWorkflowId: input.parentWorkflowId,
      engagementId: input.engagementId,
      clientName: input.clientName,
      workstream: input.workstream,
    },
  });
  const defaultMilestones = [
    `${input.workstream} plan completed`,
    `${input.workstream} build completed`,
    `${input.workstream} validation completed`,
  ];
  const echoedMilestones = result.echoed.completedMilestones;
  return {
    workstream: input.workstream,
    childWorkflowId: info.workflowId,
    completedMilestones: Array.isArray(echoedMilestones) ? echoedMilestones.map(String) : defaultMilestones,
    completedAt: new Date().toISOString(),
  };

 });
}
