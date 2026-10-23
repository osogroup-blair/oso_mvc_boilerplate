import assert from "node:assert/strict";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn,spawnSync } from "node:child_process";
import { randomUUID,createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client,Connection } from "@temporalio/client";
import { Worker,NativeConnection,Runtime,bundleWorkflowCode } from "@temporalio/worker";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { temporalClientGateway } from "../../dist/lib/temporalClient.js";
import { WorkflowHumanTaskService } from "../../dist/services/workflow-human-task.service.js";
import { WorkflowHumanTaskModel } from "../../dist/models/workflowHumanTask.model.js";
import { workflowRegistrations } from "../../dist/temporal/workflow-registry.js";
import { temporalDataConverter } from "../../dist/lib/temporalPayload.js";
import { workflowExecutionService } from "../../dist/services/workflow-execution.service.js";
import { stableHash } from "../../dist/lib/stable-hash.js";
const manifest=JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST,"utf8"));const root=resolve(manifest.artifactDirectory);
const prisma=new PrismaClient();assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM platform_test.ownership`,[{run_id:manifest.runId}]);
const connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS});const client=new Client({connection,namespace:manifest.temporal.namespace,dataConverter:temporalDataConverter});
const legacyClient=new Client({connection,namespace:manifest.temporal.namespace});
Runtime.install({shutdownSignals:[]});const native=await NativeConnection.connect({address:process.env.TEMPORAL_ADDRESS});
const hash=value=>createHash("sha256").update(value).digest("hex");
const wait=async(check,label,timeout=20000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await delay(100);}throw Error(`Deadline: ${label}`);};
let child;let running;let legacyWorker;const logs=[];const checks=[];
const startBuilt=()=>{const process=spawn(globalThis.process.execPath,["dist/temporal/worker.js"],{env:globalThis.process.env,stdio:["ignore","pipe","pipe"]});process.exited=false;process.once("exit",code=>{process.exited=true;process.code=code;});for(const stream of [process.stdout,process.stderr])stream.on("data",chunk=>logs.push(chunk.toString()));return process;};
try{
 child=startBuilt();await wait(async()=>{try{const value=await temporalClientGateway.applicationCanary(2000);return value.result.status==="ok";}catch{return false;}},"Activity application canary");checks.push("real application Activity canary");
 await assert.rejects(temporalClientGateway.applicationCanary(1000,`missing-${randomUUID()}`));checks.push("dead queue canary deadline");
 const role=await prisma.role.create({data:{name:`reliability-${randomUUID()}`,permissions:["workflow:act","workflow:start"]}});
 const user=await prisma.user.create({data:{name:"Synthetic operator",email:`${randomUUID()}@example.invalid`,passwordHash:"not-login",roleId:role.id}});
 const org=await prisma.organization.create({data:{name:"Synthetic reliability",slug:randomUUID()}});await prisma.orgMember.create({data:{orgId:org.id,userId:user.id,role:"OWNER"}});
 for(const key of ["platform.approval","platform.heartbeat"]){const reg=workflowRegistrations.find(row=>row.key===key);await prisma.workflowDefinition.upsert({where:{key},update:{},create:{key,slug:reg.slug,name:reg.name,workflowType:reg.workflowType,defaultTaskQueue:manifest.temporal.taskQueue,contractVersion:1}});}
 const heartbeatDefinition=await prisma.workflowDefinition.update({where:{key:"platform.heartbeat"},data:{isEnabled:true,defaultTaskQueue:manifest.temporal.taskQueue}});
 await prisma.workflowDefinitionRole.create({data:{workflowDefinitionId:heartbeatDefinition.id,roleId:role.id,capability:"START"}});
 child.kill("SIGTERM");await wait(async()=>child.exited,"pause Worker for pending-start fault");assert.equal(child.code,0);child=undefined;
 const originalStart=temporalClientGateway.startWorkflow.bind(temporalClientGateway);let loseStart=true;
 temporalClientGateway.startWorkflow=async input=>{const result=await originalStart(input);if(loseStart){loseStart=false;throw Error("Synthetic accepted start response lost");}return result;};
 const startInput={slug:heartbeatDefinition.slug,orgId:org.id,operationId:randomUUID(),input:{}};
 await assert.rejects(workflowExecutionService.start({userId:user.id,roleId:role.id},startInput),/Synthetic accepted start response lost/);
 const recoveredStarts=await workflowExecutionService.recoverPendingStarts({userId:user.id,roleId:role.id},org.id);assert.equal(recoveredStarts.length,1);
 const exactStart=await workflowExecutionService.start({userId:user.id,roleId:role.id},startInput);assert.equal(exactStart.id,recoveredStarts[0].id);
 assert.equal(await prisma.auditLog.count({where:{entityId:exactStart.id,action:"workflowExecution.created"}}),1);
 temporalClientGateway.startWorkflow=originalStart;checks.push("real accepted start lost response, durable intent recovery and exact-run duplicate projection");
 child=startBuilt();await wait(async()=>{try{return (await temporalClientGateway.applicationCanary(2000)).result.status==="ok";}catch{return false;}},"Worker after intent recovery");
 const canaryRun=await temporalClientGateway.applicationCanary(3000);
 const workflowId=`${manifest.temporal.namespace}-human-${randomUUID()}`;const handle=await client.workflow.start("platformApprovalWorkflow",{workflowId,taskQueue:manifest.temporal.taskQueue,args:[{title:"Synthetic approval",instructions:"Synthetic only"},{orgId:org.id,startedById:user.id,workflowDefinitionKey:"platform.approval",actionProtocol:"update-v1"}]});
 let task;await wait(async()=>{task=await prisma.workflowHumanTask.findFirst({where:{workflowId,status:"OPEN"}});return Boolean(task);},"durable human task");
 await prisma.workflowHumanTask.update({where:{id:task.id},data:{assignedUserId:user.id}});
 // Wait for the create-Activity result to be incorporated into Workflow state.
 assert.equal(Buffer.from((await handle.fetchHistory()).events[0].workflowExecutionStartedEventAttributes.input.payloads[0].metadata.encoding).toString(),"binary/boilerplate-aes-gcm-v1");
 await wait(async()=>{try{return (await handle.query("platformApprovalState")).taskId===task.id;}catch{return false;}},"human Update readiness");
 await assert.rejects(handle.executeUpdate("platformApprovalAction.submit",{updateId:randomUUID(),args:[{operationId:randomUUID(),taskId:"wrong-task",actionKey:"complete",decision:"approved",channel:"AUTHENTICATED",submittedAt:new Date().toISOString()}]}));
 const tasks=new WorkflowHumanTaskModel();const service=new WorkflowHumanTaskService(tasks,undefined,undefined,temporalClientGateway);
 const key=randomUUID();const input={taskId:task.id,actionKey:"complete",input:{decision:"approved",comment:"Synthetic"},idempotencyKey:key};
 // First transport response is lost after Temporal has accepted the Update.
 const submit=temporalClientGateway.submitHumanAction.bind(temporalClientGateway);let lost=true;
 temporalClientGateway.submitHumanAction=async(...args)=>{const response=await submit(...args);if(lost){lost=false;throw Error("Synthetic lost Update response");}return response;};
 await assert.rejects(service.submitAuthenticated({userId:user.id,roleId:role.id},input));
 const pending=await tasks.findReceiptByIdempotencyKey(task.id,key);assert.equal(pending.status,"RECEIVED");
 const recovered=await service.submitAuthenticated({userId:user.id,roleId:role.id},input);assert.equal(recovered.receipt.status,"SUCCEEDED");
 const output=await handle.result();assert.equal(output.phase,"approved");assert.equal(output.businessOutcome,"SUCCEEDED");
 const same=await service.submitAuthenticated({userId:user.id,roleId:role.id},input);assert.equal(same.alreadySubmitted,true);
 await assert.rejects(service.submitAuthenticated({userId:user.id,roleId:role.id},{...input,input:{decision:"rejected"}}));
 assert.equal(await prisma.auditLog.count({where:{id:pending.id}}),1);checks.push("real Update rejection, lost response recovery, stable receipt, business outcome");
 const cancelled=await client.workflow.start("platformApprovalWorkflow",{workflowId:`${workflowId}-cancel`,taskQueue:manifest.temporal.taskQueue,args:[{title:"Cancel",instructions:"Synthetic"},{orgId:org.id,startedById:user.id,workflowDefinitionKey:"platform.approval",actionProtocol:"update-v1"}]});
 await wait(async()=>Boolean(await prisma.workflowHumanTask.findFirst({where:{workflowId:cancelled.workflowId,status:"OPEN"}})),"cancel task");await cancelled.cancel();await assert.rejects(cancelled.result());
 await wait(async()=>await prisma.workflowHumanTask.count({where:{workflowId:cancelled.workflowId,status:"OPEN"}})===0,"noncancellable task cleanup");checks.push("waiting human cancellation cleanup");
 // Real Schedule trigger ingests an exact run projection via the application Activity.
 const schedule=await client.schedule.create({scheduleId:`schedule-${randomUUID()}`,spec:{intervals:[{every:"1 day"}]},action:{type:"startWorkflow",workflowType:"temporalPlatformHeartbeatWorkflow",taskQueue:manifest.temporal.taskQueue,args:[{}, {orgId:org.id,startedById:user.id,workflowDefinitionKey:"platform.heartbeat"}]},state:{paused:true}});
 await schedule.trigger();await wait(async()=>await prisma.workflowExecution.count({where:{orgId:org.id,workflowDefinition:{key:"platform.heartbeat"}}})>0,"Schedule projection ingestion");await schedule.delete();checks.push("actual Schedule trigger and projection");
 child.kill("SIGTERM");await wait(async()=>child.exited,"built Worker stop");assert.equal(child.code,0);child=undefined;

 // Capture genuine server histories from the immutable pre-change Git source.
 const priorSource=spawnSync("git",["show","1582ae5d91129251380ce72716f4d480f76211b1:src/temporal/workflows/index.ts"],{encoding:"utf8"});assert.equal(priorSource.status,0);
 const legacyDir=resolve(root,"legacy");await mkdir(legacyDir);const entry=resolve(legacyDir,"index.js");await writeFile(entry,ts.transpileModule(priorSource.stdout,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const bundle=await bundleWorkflowCode({workflowsPath:entry,webpackConfigHook:config=>({...config,resolve:{...config.resolve,modules:[resolve("node_modules"),...(config.resolve?.modules ?? [])]}})});await writeFile(resolve(legacyDir,"workflows.js"),bundle.code);
 const queue=`legacy-${manifest.runId}`;
 const synthetic={ensureWorkflowExecutionProjection:async()=>({executionId:randomUUID(),created:true}),createHumanTask:async()=>({taskId:randomUUID(),status:"OPEN"}),closeHumanTask:async()=>{},runSyntheticIntegration:async()=>({providerKey:"synthetic.echo",connectionId:"synthetic",replayed:false}),runShowcaseSyntheticStep:async input=>({stepKey:input.stepKey,providerKey:"synthetic.echo",connectionId:"synthetic",replayed:false,echoed:{...input.payload}})};
 legacyWorker=await Worker.create({connection:native,namespace:manifest.temporal.namespace,taskQueue:queue,workflowBundle:{code:bundle.code},activities:synthetic});running=legacyWorker.run();
 const common={message:"Synthetic",durationSeconds:30,title:"Synthetic",instructions:"Synthetic",customerId:"synthetic",companyName:"Synthetic",primaryContactName:"Synthetic",primaryContactEmail:"nobody@example.invalid",requestedUsers:["nobody@example.invalid"],requestId:"synthetic",requestType:"Synthetic",requester:"Synthetic",amount:2000,description:"Synthetic",orderId:"synthetic",items:[{id:"one",quantity:1,price:1}],paymentTokenRef:"synthetic-ref",shippingAddress:"Synthetic",email:"nobody@example.invalid",sourceRecordId:"synthetic",eventId:"synthetic",sourceSystem:"Synthetic",changedFields:["name"],employeeId:"synthetic",name:"Synthetic",manager:"Synthetic",department:"Synthetic",startDate:"2026-10-20",requestedSystems:["email"],accessProfile:"synthetic",provisioningLeadTimeSeconds:30,engagementId:"synthetic",clientName:"Synthetic",sponsorEmail:"nobody@example.invalid",projectManager:"Synthetic",targetGoLiveDate:"2026-12-01",scopeSummary:"Synthetic",workstreams:["data"],phaseDelaySeconds:30,documentId:"synthetic",documentRef:"private-reference-only",caseId:"synthetic",customerMessageSummary:"Synthetic",planTier:"growth",accountStatus:"active",recentInvoiceId:"synthetic",reviewId:"synthetic",reviewPeriod:"2026",controls:[{controlId:"one",title:"Synthetic",owner:"Synthetic",evidenceRequired:"reference",classification:"manual"}],applicationId:"synthetic",applicantName:"Synthetic",applicationType:"business_loan",demoScenario:"missing_information"};
 const handles=[];
 for(const registration of workflowRegistrations){const input=registration.validateStart({...common,demoScenario:registration.workflowType==="aiSupportAgentWorkflow"?"credit_requires_approval":"missing_information"});handles.push({type:registration.workflowType,handle:await legacyClient.workflow.start(registration.workflowType,{workflowId:`history-${registration.key}-${manifest.runId}`,taskQueue:queue,args:[input,{orgId:"synthetic",startedById:"synthetic",workflowDefinitionKey:registration.key}]})});}
 handles.push({type:"clientEngagementWorkstreamWorkflow",handle:await legacyClient.workflow.start("clientEngagementWorkstreamWorkflow",{workflowId:`history-child-engagement-${manifest.runId}`,taskQueue:queue,args:[{orgId:"synthetic",workflowDefinitionKey:"showcase.client-engagement",parentWorkflowId:"synthetic",engagementId:"synthetic",clientName:"Synthetic",workstream:"data"}]})});
 handles.push({type:"underwritingRiskCheckChildWorkflow",handle:await legacyClient.workflow.start("underwritingRiskCheckChildWorkflow",{workflowId:`history-child-risk-${manifest.runId}`,taskQueue:queue,args:[{orgId:"synthetic",workflowDefinitionKey:"showcase.underwriting",parentWorkflowId:"synthetic",applicationId:"synthetic",checkType:"identity",data:{},demoScenario:"missing_information",attempt:1}]})});
 await delay(2500);legacyWorker.shutdown();await running;legacyWorker=undefined;
 const candidate=await bundleWorkflowCode({workflowsPath:resolve("dist/temporal/workflows/index.js")});await writeFile(resolve(root,"candidate-workflows.js"),candidate.code);
 const histories=[];
 for(const row of handles){const history=await row.handle.fetchHistory();assert(!history.events.some(event=>event.workflowTaskFailedEventAttributes),`${row.type} has no task failure`);assert(!history.events.some(event=>event.workflowExecutionFailedEventAttributes),`${row.type} did not fail`);
   assert(history.events.some(event=>event.workflowTaskCompletedEventAttributes),`${row.type} processed history`);
   await Worker.runReplayHistory({workflowBundle:{code:candidate.code}},history,row.handle.workflowId);
   const file=`${row.type}.json`;const bytes=JSON.stringify(history);await writeFile(resolve(legacyDir,file),bytes);histories.push({file,historyFormat:"protobuf-json",workflowId:row.handle.workflowId,workflowType:row.type,sourceRelease:"local-baseline-1582ae5d",branch:"representative-running-or-completed",synthetic:true,reviewed:true,sha256:hash(bytes)});
 }
 legacyWorker=await Worker.create({connection:native,namespace:manifest.temporal.namespace,taskQueue:queue,workflowBundle:{code:candidate.code},activities:synthetic});running=legacyWorker.run();
 const oldApproval=handles.find(row=>row.type==="platformApprovalWorkflow").handle;
 const oldState=await oldApproval.query("platformApprovalState");assert.equal(oldState.phase,"waiting");
 await oldApproval.signal("platformApprovalAction",{taskId:oldState.taskId,actionKey:"complete",decision:"approved",channel:"AUTHENTICATED",submittedAt:new Date().toISOString()});
 const oldResult=await oldApproval.result();assert.equal(oldResult.phase,"approved");
 assert(!(await oldApproval.fetchHistory()).events.some(event=>event.workflowTaskFailedEventAttributes));
 legacyWorker.shutdown();await running;legacyWorker=undefined;checks.push("prior-source waiting Workflow resumes under candidate Worker using retained Signal");
 const canaryHistory=await client.workflow.getHandle(canaryRun.workflowId).fetchHistory();
 await Worker.runReplayHistory({workflowBundle:{code:candidate.code},dataConverter:temporalDataConverter},canaryHistory,canaryRun.workflowId);
 const canaryBytes=JSON.stringify(canaryHistory);await writeFile(resolve(legacyDir,"temporalApplicationCanaryWorkflow.json"),canaryBytes);
 histories.push({file:"temporalApplicationCanaryWorkflow.json",historyFormat:"protobuf-json",workflowId:canaryRun.workflowId,workflowType:"temporalApplicationCanaryWorkflow",sourceRelease:"local-candidate-new-type",branch:"completed",synthetic:true,reviewed:true,sha256:hash(canaryBytes)});
 await writeFile(resolve(root,"candidate-workflows.js.manifest.json"),JSON.stringify({version:1,sha256:hash(candidate.code),lockfileSha256:hash(await readFile("package-lock.json")),workflowTypes:histories.map(row=>row.workflowType).sort()}));
 // A deliberately incompatible timer-before-first-command variant must fail replay.
 const incompatible=priorSource.stdout.replace('  await ensureWorkflowExecutionProjection(input, context);','  await sleep(123456);\n  await ensureWorkflowExecutionProjection(input, context);');
 await writeFile(entry,ts.transpileModule(incompatible,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const broken=await bundleWorkflowCode({workflowsPath:entry,webpackConfigHook:config=>({...config,resolve:{...config.resolve,modules:[resolve("node_modules"),...(config.resolve?.modules ?? [])]}})});
 const heartbeat=handles.find(row=>row.type==="temporalPlatformHeartbeatWorkflow");await assert.rejects(Worker.runReplayHistory({workflowBundle:{code:broken.code}},await heartbeat.handle.fetchHistory(),heartbeat.handle.workflowId));
 await writeFile(resolve(legacyDir,"manifest.json"),JSON.stringify({version:1,supportedReleases:["local-baseline-1582ae5d","local-candidate-new-type"],requiredCases:histories.map(({workflowType,sourceRelease,branch})=>({workflowType,sourceRelease,branch})),histories,note:"Local prior-source baseline only; not an inventory of deployed production releases."},null,2));checks.push("15 prior-source histories plus new-type canary replay; incompatible control rejected");
 const exactReplay=spawnSync(process.execPath,["scripts/temporal-replay.mjs",`--manifest=${resolve(legacyDir,"manifest.json")}`,`--bundle=${resolve(root,"candidate-workflows.js")}`,`--bundle-sha256=${hash(candidate.code)}`],{env:process.env,encoding:"utf8",maxBuffer:16*1024*1024});
 await writeFile(resolve(root,"exact-bundle-replay.log"),exactReplay.stdout+exactReplay.stderr);assert.equal(exactReplay.status,0,"exact bundle CLI replay");checks.push("exact bundle CLI replay and digest sidecar verification");
 await writeFile(resolve(root,"reliability-results.json"),JSON.stringify({result:"PASS",checks,candidateSha256:hash(candidate.code),legacySourceSha256:hash(priorSource.stdout)},null,2));console.log(JSON.stringify({result:"PASS",checks}));
}finally{if(legacyWorker){legacyWorker.shutdown();await running.catch(()=>{});}if(child&&!child.exited){child.kill("SIGTERM");await wait(async()=>child.exited,"cleanup Worker").catch(()=>child.kill("SIGKILL"));}await writeFile(resolve(root,"reliability-worker.log"),logs.join(""));await temporalClientGateway.close();await native.close();await connection.close();await prisma.$disconnect();}
