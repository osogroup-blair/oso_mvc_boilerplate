import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ReferenceModel } from "./reference.model.mjs";
import { stableHash } from "../../dist/lib/stable-hash.js";
import { organizationContextService } from "../../dist/services/organizationContext.service.js";
import { AppError } from "../../dist/lib/AppError.js";
const model=new ReferenceModel();
export async function referenceSchemas(){await model.createSchema();return ["referenceNote","referenceEquipment"].map(kind=>{
 const adapter={transport:"json",async resolveContext({actor,requestedOrgId,action}){
   const context=await organizationContextService.resolveForUser(actor.id,requestedOrgId);if(!context.activeOrg)throw AppError.forbidden();
   if(kind==="referenceEquipment" && action!=="read" && actor.role!=="ADMIN")throw AppError.forbidden();return {actor,orgId:context.activeOrg.id};
 },bind(context,mutation){const get=async id=>{const row=await model.get(id,context.orgId,kind);if(!row)throw AppError.notFound();return row;};
   const command=async (id,data,remove=false)=>model.command({org:context.orgId,kind,id,operation:mutation.operationId,version:mutation.expectedVersion,data,remove,
     hash:stableHash({actor:context.actor.id,org:context.orgId,kind,id:mutation.expectedVersion===undefined?undefined:id,data,remove,version:mutation.expectedVersion})});
   return {list:async()=>model.list(context.orgId,kind),listAll:async()=>model.list(context.orgId,kind),count:async()=> (await model.list(context.orgId,kind)).length,getById:get,
    create:async data=>command(randomUUID(),data),update:async(id,data)=>command(id,data),remove:async id=>command(id,(await get(id)).data,true)};
 },parse:async value=>z.object({name:z.string().min(2,"Name needs at least two characters"),enabled:z.boolean(),details:z.object({quantity:z.number().nullable(),labels:z.array(z.string())})}).strict().parse(value),
 options:async()=>({}),version:row=>row.version,formValues:row=>row.data ?? {name:"",enabled:false,details:{quantity:null,labels:[]}}};
 return {key:kind,label:kind,labelPlural:kind,category:"application",listColumns:["id","version"],fields:[{key:"id",type:"text"},{key:"version",type:"number"}],adapter};
});}
