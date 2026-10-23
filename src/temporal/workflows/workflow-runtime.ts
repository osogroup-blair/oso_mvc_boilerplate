import { ApplicationFailure, CancelledFailure, CancellationScope, defineUpdate, isCancellation, patched, proxyActivities, setHandler, workflowInfo, type SignalDefinition } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { openHumanTasks } from "./shared.js";
const maintenance=proxyActivities<{cancelOpenWorkflowTasks(input:{orgId:string;workflowId:string;runId:string}):Promise<void>;applicationCanary():Promise<{status:string}>}>({startToCloseTimeout:"30 seconds",scheduleToCloseTimeout:"2 minutes",retry:{maximumAttempts:3}});

export function setHumanActionHandler(signal:SignalDefinition<[WorkflowHumanActionInput]>,accept:(input:WorkflowHumanActionInput)=>boolean) {
  const accepted=new Map<string,string>();
  setHandler(signal,input=>{accept(input);}); // Original Signal names/semantics remain supported.
  setHandler(defineUpdate<{accepted:true;operationId:string},[WorkflowHumanActionInput]>(`${signal.name}.submit`),input=>{
    if(!input.operationId)throw ApplicationFailure.nonRetryable("Operation identity required","ACTION_ID_REQUIRED");
    const prior=accepted.get(input.taskId);
    if(prior && prior!==input.operationId)throw ApplicationFailure.nonRetryable("Task already queued","ACTION_CONFLICT");
    if(!prior){
      const task=openHumanTasks.get(input.taskId);
      if(!task || task.actionKey!==input.actionKey || !accept(input))throw ApplicationFailure.nonRetryable("Action not accepted in current state","ACTION_REJECTED");
      accepted.set(input.taskId,input.operationId);
    }
    return {accepted:true,operationId:input.operationId};
  });
}

export async function runVersionedWorkflow<T>(context:PlatformWorkflowContext|undefined,run:()=>Promise<T>):Promise<T> {
  if(!patched("platform-runtime-v2"))return run();
  try {
    const result=await run();
    if(CancellationScope.current().consideredCancelled)throw new CancelledFailure("Workflow cancelled");
    if(result && typeof result==="object") {
      const value=result as Record<string,unknown>;const state=String(value.status ?? value.phase ?? value.stage ?? "");
      const businessOutcome=["completed","approved","fulfilled","compliant","resolved"].includes(state)?"SUCCEEDED"
        :["rejected","declined","non_compliant"].includes(state)?"REJECTED":"UNKNOWN";
      return {...value,businessOutcome} as T;
    }
    return result;
  }catch(error){
    if(isCancellation(error))await CancellationScope.nonCancellable(async()=>{
      if(context?.orgId)await maintenance.cancelOpenWorkflowTasks({orgId:context.orgId,workflowId:workflowInfo().workflowId,runId:workflowInfo().runId});
    });
    throw error;
  }
}
export async function temporalApplicationCanaryWorkflow(){return maintenance.applicationCanary();}
