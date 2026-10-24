import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
const require=createRequire(import.meta.url);const {chromium}=require("playwright");
const manifest=JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST,"utf8"));const prisma=new PrismaClient();
assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM platform_test.ownership`,[{run_id:manifest.runId}]);
const freePort=()=>new Promise(resolve=>{const server=createServer().listen(0,"127.0.0.1",()=>{const port=server.address().port;server.close(()=>resolve(port));});});
manifest.appPort=await freePort();manifest.browserPort=await freePort();
const root=resolve(manifest.artifactDirectory);const profile=resolve(root,"browser-profile");await mkdir(profile);
const seed=ts.transpileModule((await readFile("prisma/seed.ts","utf8")).replaceAll('"../src/','"'+new URL('../../dist/',import.meta.url).href),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
await writeFile(resolve(root,"seed.mjs"),seed);
const seeded=spawnSync(process.execPath,[resolve(root,"seed.mjs")],{env:process.env,encoding:"utf8"});if(seeded.status!==0)throw Error(`Owned seed failed: ${seeded.stderr.slice(-1000)}`);
await prisma.siteSetting.upsert({where:{key:"STORAGE_LOCAL_DIR"},create:{key:"STORAGE_LOCAL_DIR",value:relative(process.cwd(),resolve(root,"uploads"))},update:{value:relative(process.cwd(),resolve(root,"uploads"))}});
const bob=await prisma.user.findUniqueOrThrow({where:{email:"bob@example.com"}});const alice=await prisma.user.findUniqueOrThrow({where:{email:"alice@example.com"}});
const memberships=await prisma.orgMember.findMany({where:{userId:alice.id,deletedAt:null}});const org=memberships[0].orgId;
await prisma.role.updateMany({where:{name:"ADMIN"},data:{permissions:{push:["referenceNote:read","referenceNote:create","referenceNote:update","referenceNote:delete","referenceEquipment:read","referenceEquipment:create","referenceEquipment:update","referenceEquipment:delete"]}}});
const app=spawn(process.execPath,["tests/fixtures/application.mjs"],{env:{...process.env,PORT:String(manifest.appPort),PLATFORM_TEST_RUN_ID:manifest.runId,PRIVATE_ASSET_ROOT:resolve(root,"private")},stdio:["ignore","pipe","pipe"]});
const chrome=spawn(chromium.executablePath(),["--headless=new","--no-sandbox","--disable-gpu",`--user-data-dir=${profile}`,`--remote-debugging-port=${manifest.browserPort}`,"--remote-debugging-address=127.0.0.1","about:blank"],{stdio:"ignore"});
manifest.appPid=app.pid;manifest.browserPid=chrome.pid;await writeFile(process.env.PLATFORM_TEST_MANIFEST,JSON.stringify(manifest,null,2));
let browser;let log="";app.stdout.on("data",b=>log+=b);app.stderr.on("data",b=>log+=b);
const base=`http://127.0.0.1:${manifest.appPort}`;const results=[];
try{
 for(let i=0;i<100;i++){try{if((await fetch(`${base}/health`)).ok)break;}catch{}await delay(100);}
 for(let i=0;i<50;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${manifest.browserPort}`);break;}catch{}await delay(100);}
 if(!browser)throw Error("Owned browser did not start");
 const context=browser.contexts()[0];const page=await context.newPage();
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto(base);
 assert.equal(await page.locator('h1').innerText(),'Skip the setup.\nBuild your thing.');assert.equal(await page.locator('[data-feature]:visible').count(),12);
 await page.getByRole('button',{name:'Automate work',exact:true}).click();assert.equal(await page.locator('[data-feature]:visible').count(),4);
 await page.getByRole('searchbox',{name:'Search features'}).fill('no-matching-feature-1234');assert.equal(await page.locator('[data-feature]:visible').count(),0);await page.locator('#no-features').waitFor({state:'visible'});
 await page.getByRole('searchbox',{name:'Search features'}).fill('');await page.locator('[data-filter="all"]').click();
 await page.locator('[data-feature]').first().locator('summary').click();assert(await page.locator('[data-feature]').first().locator('.file-list').isVisible());await page.locator('[data-feature]').first().locator('summary').click();
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.getByRole('button',{name:'Copy Docker startup command'}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'docker compose up --build -d --wait');
 await page.locator('[data-check="identity"]').check();await page.reload();assert(await page.locator('[data-check="identity"]').isChecked());assert.equal(await page.locator('#progress-text').innerText(),'1 of 6 complete');
 await page.getByRole('button',{name:'Reset',exact:true}).click();assert.equal(await page.locator('#progress-text').innerText(),'0 of 6 complete');
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.waitForFunction(()=>window.scrollY===0);
 await page.screenshot({path:resolve(root,'getting-started-desktop.png'),fullPage:true});await page.screenshot({path:resolve(root,'getting-started-preview.png'),fullPage:false});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),`no horizontal overflow at ${width}px`);}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>window.scrollY===0);await page.screenshot({path:resolve(root,'getting-started-mobile.png'),fullPage:true});
 const staticContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:1024,height:768}});const staticPage=await staticContext.newPage();await staticPage.goto(base+'/getting-started');
 assert.equal(await staticPage.locator('[data-feature]:visible').count(),12);await staticPage.locator('[data-feature]').first().locator('summary').click();assert(await staticPage.locator('[data-feature]').first().locator('.file-list').isVisible());await staticContext.close();
 for(const href of await page.locator('a[href^="#"]').evaluateAll(links=>links.map(link=>link.getAttribute('href'))))assert.equal(await page.locator(href).count(),1,href);
 assert.deepEqual(pageErrors,[]);results.push('implementation guide: fresh homepage, feature filters/search/notes, clipboard, persisted checklist, 320/390px layouts and no-JavaScript access');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(`${base}/admin/login`);await page.locator('[name="email"]').fill("alice@example.com");await page.locator('[name="password"]').fill("password123");
 await Promise.all([page.waitForURL(`${base}/admin`),page.locator('button[type="submit"]').click()]);results.push("actual login and CSRF form");
 for(const path of ["/","/pages/welcome","/projects","/admin/user","/admin/page","/admin/organizations","/admin/settings","/admin/logs/diagnostics"]){const response=await page.goto(base+path);assert.equal(response.status(),200,path);}results.push("public/admin pages");
 assert.equal(await page.evaluate(async()=> (await fetch('/projects',{method:'POST',body:new URLSearchParams({name:'Rejected'})})).status),403);results.push("missing CSRF rejected");
 await page.goto(`${base}/admin/jobs`);
 const queueChecks=await page.evaluate(async()=>{
   const queues=await fetch('/admin/jobs/api/queues').then(r=>r.json());
   const absent=await fetch('/admin/jobs/api/queues/email/pause',{method:'PUT'});
   const token=decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith('XSRF-TOKEN=')).split('=').slice(1).join('='));
   const accepted=await fetch('/admin/jobs/api/queues/email/pause',{method:'PUT',headers:{'X-XSRF-TOKEN':token}});
   const resumed=await fetch('/admin/jobs/api/queues/email/resume',{method:'PUT',headers:{'X-XSRF-TOKEN':token}});
   return {queues,absent:absent.status,accepted:accepted.status,resumed:resumed.status};
 });
 assert(JSON.stringify(queueChecks.queues).includes('email'));assert.equal(queueChecks.absent,403);assert.equal(queueChecks.accepted,200);assert.equal(queueChecks.resumed,200);
 results.push('real Redis email queue: CSRF rejection, pause and resume');
 for(const kind of ["referenceNote","referenceEquipment"]){
  await page.goto(`${base}/admin/${kind}/new?orgId=${org}`);const operation=await page.locator('[name="_adminOperationId"]').first().inputValue();
  await page.locator('[name="_adminPayload"]').fill(JSON.stringify({name:"",enabled:false,details:{quantity:null,labels:["test"]}}));
  await page.getByRole("button",{name:"Save",exact:true}).click();await page.waitForLoadState();
  assert.equal(await page.locator('[name="_adminOperationId"]').first().inputValue(),operation,"validation preserves operation");
  await page.locator('[name="_adminPayload"]').fill(JSON.stringify({name:`Owned ${kind}`,enabled:false,details:{quantity:null,labels:["test"]}}));
  await page.getByRole("button",{name:"Save",exact:true}).click();await page.waitForLoadState();
  assert.equal(await page.locator('[name="_adminVersion"]').first().inputValue(),"1");
  const before=await page.locator('[name="_adminOperationId"]').first().inputValue();
  const form=await page.locator('form').filter({has:page.locator('[name="_adminPayload"]')}).evaluate(el=>Object.fromEntries(new FormData(el)));
  const target=page.url();const first=await context.request.post(target,{form});assert.equal(first.status(),200);
  const repeat=await context.request.post(target,{form});assert.equal(repeat.status(),200);
  const changed={...form,_adminOperationId:crypto.randomUUID()};const stale=await context.request.post(target,{form:changed});assert.equal(stale.status(),409);
  assert(before);results.push(`${kind}: typed nested form, validation recovery, CAS and replay`);
 }
 // Integrations hardening Phase 1 (INT-01/02/05) through the real admin UI, CSRF forms and owned SQL.
 {
  const seeded=await prisma.integrationConnection.findFirstOrThrow({where:{name:"Seed Synthetic Echo",deletedAt:null}});
  assert(memberships.some(m=>m.orgId===seeded.orgId),"alice belongs to the seeded integration org");
  const integrationOrg=seeded.orgId;const platformTest=await prisma.workflowDefinition.findUniqueOrThrow({where:{key:"platform.test"}});
  const postForm=async(button)=>{await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"),button.click()]);await page.waitForLoadState("load");};
  const scheduleName=`Owned integration health ${manifest.runId}`;
  try{
   assert.equal((await page.goto(`${base}/workflows/${platformTest.slug}?orgId=${integrationOrg}`)).status(),200);
   assert(await page.getByText("AVAILABLE",{exact:true}).first().isVisible(),"healthy binding renders AVAILABLE");
   await page.goto(`${base}/admin/integrations/${seeded.id}?orgId=${integrationOrg}`);
   await postForm(page.getByRole("button",{name:"Disable",exact:true}));
   let row=await prisma.integrationConnection.findUniqueOrThrow({where:{id:seeded.id}});assert.equal(row.status,"DISABLED");assert(row.disabledAt);
   await postForm(page.getByRole("button",{name:"Test Connection",exact:true}));
   row=await prisma.integrationConnection.findUniqueOrThrow({where:{id:seeded.id}});
   assert.equal(row.status,"DISABLED","testing a disabled connection keeps it DISABLED");assert(row.disabledAt);assert.equal(row.lastTestStatus,"SUCCEEDED");
   assert(!page.url().includes("seed-synthetic-token")&&!(await page.content()).includes("seed-synthetic-token"),"no credential in redirect or page");
   await page.goto(`${base}/workflows/${platformTest.slug}?orgId=${integrationOrg}`);
   assert(await page.getByText("CONNECTION_UNAVAILABLE",{exact:true}).first().isVisible(),"start page shows CONNECTION_UNAVAILABLE");
   assert(await page.getByText("Integration connection is unavailable").first().isVisible(),"start page shows reason");
   assert(await page.getByText("An administrator must bind active connections").isVisible(),"start page blocks launch");
   await page.goto(`${base}/admin/integrations/workflow-bindings/${platformTest.id}?orgId=${integrationOrg}`);
   assert(await page.getByText("Integration connection is unavailable").first().isVisible(),"bindings page shows reason");
   await prisma.workflowSchedule.create({data:{orgId:integrationOrg,workflowDefinitionId:platformTest.id,createdById:alice.id,scheduleId:`owned-${manifest.runId}`,name:scheduleName,cronExpression:"0 * * * *"}});
   await page.goto(`${base}/admin/workflow-operations?orgId=${integrationOrg}`);
   assert(await page.getByText("Schedules with unavailable integrations").isVisible(),"operations lists schedule binding issues");
   assert(await page.getByText("binding unavailable").first().isVisible());
   assert.equal(await page.locator(`a[href="/admin/integrations/workflow-bindings/${platformTest.id}?orgId=${integrationOrg}"]`).count(),1,"fix-bindings link");
   await page.screenshot({path:resolve(root,"integration-health.png"),fullPage:true});
   results.push("integrations Phase 1: disable + test keeps DISABLED via real CSRF forms; start/bindings pages show CONNECTION_UNAVAILABLE with reason; operations flags the schedule");
  }finally{
   await prisma.workflowSchedule.updateMany({where:{orgId:integrationOrg,name:scheduleName},data:{deletedAt:new Date(),status:"DELETED"}});
   await prisma.integrationConnection.update({where:{id:seeded.id},data:{status:"ACTIVE",disabledAt:null}});
  }
 }
 await writeFile(resolve(root,"browser-identity.json"),JSON.stringify({pid:chrome.pid,expectedProfile:profile,expectedPort:manifest.browserPort,args:(await readFile(`/proc/${chrome.pid}/cmdline`,"utf8")).split("\0")},null,2));
 for(const script of ["browser-acceptance-test.mjs","upload-smoke-test.mjs"]){
  const result=await new Promise(resolve=>{const task=spawn(process.execPath,[`tests/acceptance/${script}`],{env:{...process.env,APP_BASE_URL:base},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";task.stdout.on("data",b=>stdout+=b);task.stderr.on("data",b=>stderr+=b);const timer=setTimeout(()=>task.kill("SIGKILL"),90000);task.once("exit",status=>{clearTimeout(timer);resolve({status,stdout,stderr});});});
  await writeFile(resolve(root,script+".log"),result.stdout+result.stderr);assert.equal(result.status,0,script);
 }
 await page.screenshot({path:resolve(root,"browser-verification.png"),fullPage:true});
 await writeFile(resolve(root,"browser-results.json"),JSON.stringify({result:"PASS",checks:results,alice:alice.id,bob:bob.id},null,2));console.log("Owned browser/UI validation: PASS");
}finally{await browser?.close();chrome.kill("SIGKILL");app.kill("SIGTERM");await writeFile(resolve(root,"application.log"),log);await prisma.$disconnect();}
