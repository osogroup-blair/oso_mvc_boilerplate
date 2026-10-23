import type { PlatformWorkflowContext } from "../contracts.js";
import { ensureWorkflowExecutionProjection } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';

export async function temporalPlatformHeartbeatWorkflow(
  input: Record<string, never> = {},
  context?: PlatformWorkflowContext
): Promise<string> {
 return runVersionedWorkflow(context, async()=>{
  await ensureWorkflowExecutionProjection(input, context);
  return "ok";

 });
}
