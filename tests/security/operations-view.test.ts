import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";

it("renders actual operations payload counts and organization-scoped execution identity",async()=>{
 const h=Handlebars.create();h.registerHelper("eq",(a,b)=>a===b);
 const render=h.compile(await readFile("src/views/admin/workflow-operations/dashboard.hbs","utf8"));
 const html=render({activeOrg:{id:"owned-org",name:"Owned"},csrfToken:"synthetic-csrf",query:{staleMinutes:15},temporal:{status:"ok"},worker:{reachable:true,expectedTaskQueue:"owned-queue"},taskQueue:{workflowPollerCount:5,activityPollerCount:7},scheduleCounts:{ACTIVE:0},staleExecutions:[{id:"projection-1",workflowId:"exact-workflow-identity",workflowDefinition:{name:"Synthetic"},status:"RUNNING"}]});
 expect(html).toContain("Workflow pollers: 5 · Activity pollers: 7");
 expect(html).toContain("exact-workflow-identity");
 expect(html).toContain('/workflows/executions/projection-1?orgId=owned-org');
 expect(html).toContain('action="/admin/workflow-operations/recover-starts"');
});

it("renders schedules with unavailable integration bindings and links to the binding page",async()=>{
 const h=Handlebars.create();h.registerHelper("eq",(a,b)=>a===b);
 const render=h.compile(await readFile("src/views/admin/workflow-operations/dashboard.hbs","utf8"));
 const base={activeOrg:{id:"owned-org",name:"Owned"},csrfToken:"synthetic-csrf",query:{staleMinutes:15},temporal:{status:"ok"},worker:{reachable:true},taskQueue:{},scheduleCounts:{ACTIVE:1},staleExecutions:[]};
 expect(render({...base,scheduleIntegrationIssues:[]})).not.toContain("binding unavailable");
 const html=render({...base,scheduleIntegrationIssues:[{schedule:{id:"sch-1",name:"Nightly",scheduleId:"temporal-sch-1"},workflowDefinition:{id:"def-1",name:"Data Sync"},unavailable:[{key:"syntheticEcho",label:"Synthetic Echo",status:"DISABLED",reason:"Workflow integration binding is disabled"}]}]});
 expect(html).toContain("binding unavailable");
 expect(html).toContain("Synthetic Echo (syntheticEcho): DISABLED · Workflow integration binding is disabled");
 expect(html).toContain('/admin/integrations/workflow-bindings/def-1?orgId=owned-org');
 expect(html).toContain('/admin/workflow-operations/schedules/sch-1?orgId=owned-org');
});
