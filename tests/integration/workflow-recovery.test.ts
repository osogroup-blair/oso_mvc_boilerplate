import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID,createHash } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { ActivityIdempotencyModel } from "../../src/models/activityIdempotency.model.js";
import { ActivityIdempotencyService } from "../../src/services/activity-idempotency.service.js";
import { WorkflowExecutionModel } from "../../src/models/workflowExecution.model.js";
import { WorkflowExecutionService } from "../../src/services/workflow-execution.service.js";
import { WorkflowHumanTaskModel } from "../../src/models/workflowHumanTask.model.js";
import { stableHash } from "../../src/lib/stable-hash.js";
let orgId:string,userId:string,definitionId:string;
beforeAll(async()=>{
 const role=await prisma.role.create({data:{name:randomUUID(),permissions:["workflow:start","workflow:act"]}});
 const user=await prisma.user.create({data:{name:"Synthetic recovery",email:`${randomUUID()}@example.invalid`,passwordHash:"not-login",roleId:role.id}});userId=user.id;
 const org=await prisma.organization.create({data:{name:"Synthetic recovery",slug:randomUUID()}});orgId=org.id;
 await prisma.orgMember.create({data:{orgId,userId,role:"OWNER"}});
 const definition=await prisma.workflowDefinition.create({data:{key:randomUUID(),slug:randomUUID(),workflowType:"platformTestWorkflow",name:"Recovery",contractVersion:1,defaultTaskQueue:"owned"}});definitionId=definition.id;
});
afterAll(async()=>{await prisma.$disconnect();});

it("recovers a lost start response and concurrent HTTP/Activity projections with one atomic creation audit",async()=>{
 const executions=new WorkflowExecutionModel();const runs=new Map<string,string>();let calls=0;
 const catalog={getBySlug:async()=>({id:definitionId,key:"platform.test",slug:"platform-test",workflowType:"platformTestWorkflow",isEnabled:true,defaultTaskQueue:"owned",roles:[{roleId:"role",capability:"START"}]})};
 const temporal={startWorkflow:async(input:any)=>{calls++;let run=runs.get(input.workflowId);if(!run){run=randomUUID();runs.set(input.workflowId,run);throw Error("Synthetic lost response after accepted start");}return {workflowId:input.workflowId,runId:run};}};
 const service=new WorkflowExecutionService(executions,catalog as never,{resolveForUser:async()=>({activeOrg:{id:orgId}})} as never,{can:async()=>true} as never,temporal as never,undefined,
  {getRequirementStatuses:async()=>[],assertRequiredBindingsAvailable:()=>{}} as never);
 const input={slug:"platform-test",orgId,input:{message:"SYNTHETIC PRIVATE START INPUT",durationSeconds:1,businessKey:randomUUID()}};
 await expect(service.start({userId,roleId:"role"},input)).rejects.toThrow("lost response");
 const [a,b]=await Promise.all([service.start({userId,roleId:"role"},input),service.start({userId,roleId:"role"},input)]);
 expect(a.id).toBe(b.id);expect(runs.size).toBe(1);expect(calls).toBe(3);
 const intent=await executions.findIntent(a.workflowId);expect(JSON.stringify(intent?.envelope)).not.toContain("SYNTHETIC PRIVATE START INPUT");expect(intent?.state).toBe("STARTED");
 expect(await prisma.auditLog.count({where:{entityId:a.id,action:"workflowExecution.created"}})).toBe(1);
 await expect(service.start({userId,roleId:"role"},{...input,input:{...input.input,message:"changed"}})).rejects.toMatchObject({statusCode:409});
 await expect(executions.createOrFind({...a,id:undefined,runId:randomUUID()} as never)).rejects.toMatchObject({statusCode:409});
});

it("fences delayed completions and reconciles unsafe provider uncertainty without a second effect",async()=>{
 const model=new ActivityIdempotencyModel();const service=new ActivityIdempotencyService(model,{get:async()=>"1"} as never);
 let finish!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);const wait=new Promise<void>(resolve=>finish=resolve);
 let effects=0;const receipts=new Map<string,{receipt:string}>();const key=randomUUID();
 const old=service.run(orgId,"fenced",key,{value:1},async operation=>{effects++;receipts.set(operation,{receipt:"provider-1"});entered();await wait;return {receipt:"provider-1"};},{retrySafe:true});
 const oldOutcome=old.then(value=>({value}),error=>({error}));await started;
 const row=(await model.find(orgId,"fenced",key))!;await prisma.activityIdempotency.update({where:{id:row.id},data:{lockedAt:new Date(Date.now()-120000)}});
 const winner=await service.run(orgId,"fenced",key,{value:1},async()=>{effects++;return {receipt:"duplicate"};},{reconcile:async op=>receipts.has(op)?{found:true,value:receipts.get(op)!}:{found:false}});
 finish();expect(await oldOutcome).toHaveProperty("error");expect(winner.value.receipt).toBe("provider-1");expect(effects).toBe(1);
 expect((await model.find(orgId,"fenced",key))?.attempt).toBe(2);
 const unsafe=randomUUID();let unsafeEffects=0;
 await expect(service.run(orgId,"unsafe",unsafe,{},async()=>{unsafeEffects++;throw Error("PRIVATE PROVIDER CANARY");})).rejects.toThrow();
 await expect(service.run(orgId,"unsafe",unsafe,{},async()=>{unsafeEffects++;return {};})).rejects.toMatchObject({statusCode:409});
 expect(unsafeEffects).toBe(1);const uncertain=await model.find(orgId,"unsafe",unsafe);expect(uncertain?.status).toBe("UNCERTAIN");expect(JSON.stringify(uncertain?.error)).not.toContain("PRIVATE PROVIDER CANARY");
});

it("retains provider success after result-commit loss and reuses the provider receipt on recovery",async()=>{
 const model=new ActivityIdempotencyModel();const original=model.complete.bind(model);let fail=true;
 model.complete=async(...args)=>{if(fail){fail=false;throw Error("Synthetic result commit loss");}return original(...args);};
 const service=new ActivityIdempotencyService(model,{get:async()=>"1"} as never);const key=randomUUID();let effects=0;
 await expect(service.run(orgId,"commit-loss",key,{},async()=>{effects++;return {receipt:"saved-externally"};})).rejects.toThrow("commit loss");
 const row=(await model.find(orgId,"commit-loss",key))!;expect(row.status).toBe("RUNNING");await prisma.activityIdempotency.update({where:{id:row.id},data:{lockedAt:new Date(Date.now()-120000)}});
 const recovered=await service.run(orgId,"commit-loss",key,{},async()=>{effects++;return {receipt:"bad"};},{reconcile:async()=>({found:true,value:{receipt:"saved-externally"}})});
 expect(effects).toBe(1);expect(recovered.value.receipt).toBe("saved-externally");
});

it("atomically owns task delivery, token consumption and evidence, with queue acceptance separate from business completion",async()=>{
 const execution=await prisma.workflowExecution.create({data:{orgId,startedById:userId,workflowDefinitionId:definitionId,workflowId:randomUUID(),runId:randomUUID()}});
 const task=await prisma.workflowHumanTask.create({data:{orgId,workflowExecutionId:execution.id,workflowId:execution.workflowId,runId:execution.runId,taskKey:randomUUID(),taskType:"approval",title:"Synthetic",actionForm:{},context:{}}});
 const token=await prisma.workflowTaskToken.create({data:{taskId:task.id,tokenHash:createHash("sha256").update(randomUUID()).digest("hex"),expiresAt:new Date(Date.now()+60000)}});
 const model=new WorkflowHumanTaskModel();const reserve=(idempotencyKey:string)=>model.createReceipt({orgId,taskId:task.id,workflowExecutionId:execution.id,actionKey:"complete",idempotencyKey,channel:"TOKEN",tokenId:token.id,requestHash:stableHash({decision:"approved"})});
 const race=await Promise.allSettled([reserve(randomUUID()),reserve(randomUUID())]);expect(race.filter(item=>item.status==="fulfilled")).toHaveLength(1);
 const receipt=(race.find(item=>item.status==="fulfilled") as PromiseFulfilledResult<any>).value;
 const input={taskId:task.id,receiptId:receipt.id,tokenId:token.id,result:{acknowledgement:"QUEUED",businessOutcome:"PENDING"},audit:{action:"workflowHumanTask.deliver",entityType:"WorkflowHumanTask",entityId:task.id}};
 await prisma.$executeRawUnsafe(`CREATE FUNCTION platform_test.reject_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='workflowHumanTask.deliver' THEN RAISE EXCEPTION 'synthetic commit fault'; END IF; RETURN NEW; END; $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER bp_reject_delivery BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION platform_test.reject_delivery()`);
 try{await expect(model.commitDelivery(input)).rejects.toThrow();expect((await prisma.workflowTaskToken.findUnique({where:{id:token.id}}))?.consumedAt).toBeNull();expect((await prisma.workflowActionReceipt.findUnique({where:{id:receipt.id}}))?.status).toBe("RECEIVED");}
 finally{await prisma.$executeRawUnsafe('DROP TRIGGER bp_reject_delivery ON "AuditLog"');await prisma.$executeRawUnsafe('DROP FUNCTION platform_test.reject_delivery()');}
 const committed=await model.commitDelivery(input);await model.commitDelivery(input);expect(committed.task.status).toBe("OPEN");expect(committed.task.deliveryStatus).toBe("QUEUED");
 expect(await prisma.auditLog.count({where:{id:receipt.id}})).toBe(1);expect((await prisma.workflowTaskToken.findUnique({where:{id:token.id}}))?.consumedAt).not.toBeNull();
});

it("applies two resource task policies after tenant/assignment authorization and enforces live token revocation on replay",async()=>{
 const { WorkflowTaskPolicies }=await import("../../src/services/workflow-task-policy.service.js");
 const { WorkflowHumanTaskService }=await import("../../src/services/workflow-human-task.service.js");
 const definition=await prisma.workflowDefinition.upsert({where:{key:"platform.approval"},update:{},create:{key:"platform.approval",slug:"platform-approval",workflowType:"platformApprovalWorkflow",name:"Policy approval",contractVersion:1,defaultTaskQueue:"owned"}});
 const user=await prisma.user.findUniqueOrThrow({where:{id:userId}});const actor={userId,roleId:user.roleId!};
 const execution=await prisma.workflowExecution.create({data:{orgId,startedById:userId,workflowDefinitionId:definition.id,workflowId:randomUUID(),runId:randomUUID()}});
 const policies=new WorkflowTaskPolicies();let calls=0;
 policies.register("reference.note",async input=>{calls++;return (input.task.context as any).owner===input.actorUserId;});
 policies.register("reference.equipment",async input=>{calls++;return input.channel==="TOKEN"&&(input.task.context as any).guestAllowed===true;});
 const service=new WorkflowHumanTaskService(undefined,undefined,undefined,{signalWorkflow:async()=>{}} as never,undefined,undefined,undefined,policies);
 const create=(type:string,context:any)=>prisma.workflowHumanTask.create({data:{orgId,workflowExecutionId:execution.id,workflowId:execution.workflowId,runId:execution.runId,taskKey:randomUUID(),taskType:type,title:"Synthetic policy",assignedUserId:userId,actionForm:{},context}});
 const note=await create("reference.note",{owner:userId});expect((await service.getAuthenticatedTask(actor,note.id,orgId)).task.id).toBe(note.id);
 await prisma.workflowHumanTask.update({where:{id:note.id},data:{context:{owner:"different-current-owner"}}});await expect(service.getAuthenticatedTask(actor,note.id,orgId)).rejects.toMatchObject({statusCode:403});
 const previous=calls;await expect(service.getAuthenticatedTask({...actor,userId:randomUUID()},note.id,orgId)).rejects.toThrow();expect(calls).toBe(previous);
 const equipment=await create("reference.equipment",{guestAllowed:true});await expect(service.getAuthenticatedTask(actor,equipment.id,orgId)).rejects.toMatchObject({statusCode:403});
 const raw=randomUUID();const token=await prisma.workflowTaskToken.create({data:{taskId:equipment.id,tokenHash:createHash("sha256").update(raw).digest("hex"),expiresAt:new Date(Date.now()+60000)}});
 expect((await service.getTokenTask(raw)).task.id).toBe(equipment.id);
 const key=randomUUID();const input={decision:"approved"};const delivered=await service.submitWithToken(raw,"complete",input,key);expect(delivered.receipt.status).toBe("SUCCEEDED");
 expect((await service.submitWithToken(raw,"complete",input,key)).alreadySubmitted).toBe(true);
 await expect(service.submitWithToken(raw,"complete",input,randomUUID())).rejects.toMatchObject({statusCode:409});
 await prisma.workflowTaskToken.update({where:{id:token.id},data:{revokedAt:new Date()}});await expect(service.submitWithToken(raw,"complete",input,key)).rejects.toMatchObject({statusCode:403});
 await prisma.workflowTaskToken.update({where:{id:token.id},data:{revokedAt:null,expiresAt:new Date(Date.now()-1000)}});await expect(service.submitWithToken(raw,"complete",input,key)).rejects.toMatchObject({statusCode:403});
});
