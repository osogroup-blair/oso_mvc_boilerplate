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
