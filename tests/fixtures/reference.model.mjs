import { PrismaClient } from "@prisma/client";
import { AppError } from "../../dist/lib/AppError.js";
export const prisma=new PrismaClient();
export class ReferenceModel {
  async createSchema(){await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS platform_test.resource (id text PRIMARY KEY, org_id text NOT NULL, kind text NOT NULL, version int NOT NULL DEFAULT 1, data jsonb NOT NULL, deleted boolean NOT NULL DEFAULT false)');
    await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS platform_test.resource_receipt (id text PRIMARY KEY, hash text NOT NULL, result jsonb NOT NULL)');}
  async list(org,kind){return prisma.$queryRaw`SELECT id,version,data FROM platform_test.resource WHERE org_id=${org} AND kind=${kind} AND NOT deleted`;}
  async get(id,org,kind){return (await prisma.$queryRaw`SELECT id,version,data FROM platform_test.resource WHERE id=${id} AND org_id=${org} AND kind=${kind} AND NOT deleted`)[0] ?? null;}
  async command({org,kind,id,operation,hash,version,data,remove=false}){
    return prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${operation}))`;
      const prior=(await tx.$queryRaw`SELECT hash,result FROM platform_test.resource_receipt WHERE id=${operation}`)[0];
      if(prior){if(prior.hash!==hash)throw AppError.conflict("Operation intent mismatch");return prior.result;}
      let rows;
      if(version===undefined)rows=await tx.$queryRaw`INSERT INTO platform_test.resource (id,org_id,kind,data) VALUES (${id},${org},${kind},${JSON.stringify(data)}::jsonb) RETURNING id,version,data`;
      else rows=await tx.$queryRaw`UPDATE platform_test.resource SET data=${JSON.stringify(data)}::jsonb,version=version+1,deleted=${remove} WHERE id=${id} AND org_id=${org} AND kind=${kind} AND version=${version} AND NOT deleted RETURNING id,version,data`;
      if(!rows.length)throw AppError.conflict("Stale resource version; reload before editing");
      const result=rows[0];await tx.$executeRaw`INSERT INTO platform_test.resource_receipt(id,hash,result) VALUES(${operation},${hash},${JSON.stringify(result)}::jsonb)`;return result;
    });
  }
}
