import { AppError } from "../lib/AppError.js";
export interface WorkflowTaskPolicyContext { task: { id:string;orgId:string;context:unknown }; actorUserId?:string; tokenId?:string; channel:"AUTHENTICATED"|"TOKEN" }
export class WorkflowTaskPolicies {
  private readonly policies=new Map<string,(input:WorkflowTaskPolicyContext)=>Promise<boolean>>();
  register(type:string,policy:(input:WorkflowTaskPolicyContext)=>Promise<boolean>) {
    if(this.policies.has(type))throw Error("Task policy already registered"); this.policies.set(type,policy);
  }
  async assert(type:string,input:WorkflowTaskPolicyContext) {
    const policy=this.policies.get(type);
    // Generic platform authorization is still mandatory at the service boundary.
    // A registered policy adds current resource/assignment/guest constraints.
    if(policy && !await policy(input))throw AppError.forbidden("Task resource policy denied this action");
  }
}
export const workflowTaskPolicies=new WorkflowTaskPolicies();
