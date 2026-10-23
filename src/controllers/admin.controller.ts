// The ONE controller behind every admin CRUD page.
// It looks up the schema by :model, fetches data, pre-fetches relation options,
// assembles a JSON payload, and renders the shared list/form templates.
import type { Request, Response, NextFunction } from "express";
import { getSchema, allSchemas } from "../admin/schema.registry.js";
import type { AdminSchema, FieldDef, RelationOptionsMap } from "../admin/schema.types.js";
import type { AdminAction, AdminResourceContext } from "../admin/resource.types.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { cleanDeep } from "../lib/sanitize.js";
import { AppError } from "../lib/AppError.js";
import { permissionsService } from "../services/permissions.service.js";
import { getResource } from "./resourceRegistry.js";
import { sessionService } from "../services/session.service.js";
import { roleService } from "../services/role.service.js";
import { adminResourceService } from "../services/admin-resource.service.js";
import { ZodError } from "zod";

const scopeQuery = (context?: AdminResourceContext) => context ? `?orgId=${encodeURIComponent(context.orgId)}` : "";
const openResource = (req: Request, schema: AdminSchema, action: AdminAction, mutation = false) =>
  adminResourceService.open(schema, () => getResource(schema.key), { actor: req.user,
    requestedOrgId: req.body?._adminOrgId ?? req.query.orgId, action }, mutation ? req.body : undefined);

// Pre-fetch options for every relation field in a schema.
// The view never queries the DB — it receives ready-made { id, label } lists.
async function fetchRelationOptions(fields: FieldDef[]): Promise<RelationOptionsMap> {
  const map: RelationOptionsMap = {};
  for (const field of fields) {
    if ((field.type === "relation" || field.type === "multiRelation") && (field.relation ?? field.multiRelation)) {
      const relConfig = field.relation ?? field.multiRelation!;
      const resource = getResource(relConfig.model);
      const records = await resource.listAll();
      map[field.key] = records.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        label: String(r[relConfig.labelField] ?? r.id),
      }));
    }
    // Recurse into nested object fields.
    if (field.fields) {
      Object.assign(map, await fetchRelationOptions(field.fields));
    }
  }
  return map;
}

function castFields(data: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    // Declared nested IDs identify existing rows; services must validate their
    // ownership. Other readonly fields and undeclared input are not mutations.
    if (field.readonly && field.key !== "id") continue;
    if (Object.hasOwn(data, field.key)) result[field.key] = data[field.key];
    if (field.readonly) continue;
    const value = result[field.key];

    if (field.type === "number") {
      if (value === "" || value === undefined || value === null) {
        result[field.key] = field.required ? 0 : null;
      } else {
        result[field.key] = Number(value);
      }
    } else if (field.type === "boolean") {
      result[field.key] = value === "on" || value === "true" || value === true;
    } else if (field.type === "relation") {
      if (value === "" || value === undefined || value === null) {
        result[field.key] = null;
      }
    } else if (field.type === "multiRelation") {
      // Checkboxes submit as name[] → body-parser puts them in an array.
      // Normalize: if absent (all unchecked) → empty array, else ensure array.
      const raw = result[field.key];
      if (raw === undefined || raw === null || raw === "") {
        result[field.key] = [];
      } else if (!Array.isArray(raw)) {
        result[field.key] = [String(raw)];
      } else {
        result[field.key] = (raw as string[]).filter(Boolean);
      }
    } else if (field.type === "object" && field.fields) {
      if (value && typeof value === "object") {
        result[field.key] = castFields(value as Record<string, unknown>, field.fields);
      }
    } else if (field.type === "array" && value && Array.isArray(value)) {
      if (field.itemType === "number") {
        result[field.key] = value.map(v => v === "" ? 0 : Number(v));
      } else if (field.itemType === "object" && field.fields) {
        result[field.key] = value.map(item => castFields(item as Record<string, unknown>, field.fields!));
      }
    }
  }

  return result;
}

export class AdminController {
  private async validationForm(req:Request,res:Response,next:NextFunction,error:unknown,isNew:boolean) {
    if(!(error instanceof ZodError))return next(error);
    try {
      const schema=getSchema(req.params.model);
      if(!schema.adapter)return next(error);
      const {context}=await openResource(req,schema,isNew?"create":"update",true);
      if(!context)return next(error);
      const resource=schema.adapter.bind(context);
      const record=isNew?{}:await resource.getById(req.params.id);
      if(!record)throw AppError.notFound();
      const relationOptions=await schema.adapter.options(schema.fields,context,record);
      const form=adminResourceService.form(schema,context,record,isNew);
      if(form.adminMetadata){form.adminMetadata.operationId=String(req.body._adminOperationId);if(req.body._adminVersion!==undefined)form.adminMetadata.expectedVersion=Number(req.body._adminVersion);}
      return res.status(400).render("admin/form",{layout:"main",title:`${isNew?"New":"Edit"} ${schema.label}`,schema,record,relationOptions,isNew,
        action:`/admin/${schema.key}${isNew?"":"/"+req.params.id}${scopeQuery(context)}`,deleteAction:`/admin/${schema.key}/${req.params.id}/delete${scopeQuery(context)}`,adminQuery:scopeQuery(context),...form,
        formPayloadJson:typeof req.body._adminPayload==="string"?req.body._adminPayload.slice(0,65536):form.formPayloadJson,
        validationErrors:error.errors.map(issue=>({field:issue.path.join("."),message:issue.message}))});
    }catch(failure){return next(failure);}
  }
  // GET /admin  — index of all registered models with application metrics
  async index(_req: Request, res: Response, next: NextFunction) {
    try {
      const [
        pagesCount,
        usersCount,
        activeSessionsCount,
        rolesCount,
        allRoles
      ] = await Promise.all([
        getResource("page").count(),
        getResource("user").count(),
        sessionService.countActive(),
        getResource("role").count(),
        roleService.listWithUserCounts()
      ]);

      const dataObjectsCount = allSchemas().length;

      res.render("admin/index", {
        layout: "main",
        title: "Dashboard",
        metrics: {
          pages: pagesCount,
          users: usersCount,
          activeSessions: activeSessionsCount,
          roles: rolesCount,
          dataObjects: dataObjectsCount,
        },
        rolesBreakdown: allRoles.map((r: any) => ({
          name: r.name,
          userCount: r._count.users
        }))
      });
    } catch (err) {
      next(err);
    }
  }

  // GET /admin/models — list of all registered models with record counts
  async modelsList(_req: Request, res: Response, next: NextFunction) {
    try {
      const schemas = allSchemas();
      const schemasWithCounts = await Promise.all(
        schemas.map(async (s) => {
          try {
            if (s.adapter) return { key: s.key, label: s.labelPlural, count: "Scoped", category: s.category };
            const resource = getResource(s.key);
            const count = await resource.count();
            return { key: s.key, label: s.labelPlural, count, category: s.category };
          } catch (_err) {
            return { key: s.key, label: s.labelPlural, count: 0, category: s.category };
          }
        })
      );

      const systemSchemas = schemasWithCounts.filter(s => s.category === "system");
      const applicationSchemas = schemasWithCounts.filter(s => s.category === "application");

      res.render("admin/models", {
        layout: "main",
        title: "Database Models",
        systemSchemas,
        applicationSchemas
      });
    } catch (err) {
      next(err);
    }
  }

  // GET /admin/:model  — list view
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:read`);
      const { resource, context } = await openResource(req, schema, "read");
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query);

      const [records, total] = await Promise.all([
        resource.list(params),
        resource.count(params.search),
      ]);

      res.render("admin/list", {
        layout: "main",
        title: schema.labelPlural,
        schema,
        columns: schema.listColumns.map((key) => schema.fields.find((f) => f.key === key)!),
        records: records.map((r: any) => ({
          ...r,
          _readonly: schema.isRecordReadonly ? schema.isRecordReadonly(r) : false
        })),
        meta: buildMeta(query, total),
        query,
        adminOrgId: context?.orgId,
        adminQuery: scopeQuery(context),
      });
    } catch (err) {
      next(err);
    }
  }

  // GET /admin/:model/new  — create form
  async createForm(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:create`);
      const { context } = await openResource(req, schema, "create");
      const record = context ? await schema.adapter?.defaults?.(context) ?? {} : {};
      const relationOptions = context ? await schema.adapter!.options(schema.fields, context, record) : await fetchRelationOptions(schema.fields);
      res.render("admin/form", {
        layout: "main",
        title: `New ${schema.label}`,
        schema,
        record,
        relationOptions,
        action: `/admin/${schema.key}${scopeQuery(context)}`,
        adminQuery: scopeQuery(context),
        ...adminResourceService.form(schema, context, record, true),
        isNew: true,
      });
    } catch (err) {
      next(err);
    }
  }

  // GET /admin/:model/:id  — edit form
  async editForm(req: Request, res: Response, next: NextFunction) {
    try {
      let schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:update`);
      const { resource, context } = await openResource(req, schema, "update");
      const record = await resource.getById(req.params.id);
      if (!record) throw AppError.notFound(schema.label);
      if (schema.fieldsForRecord) schema = { ...schema, fields: schema.fieldsForRecord(record) };
      const relationOptions = context ? await schema.adapter!.options(schema.fields, context, record) : await fetchRelationOptions(schema.fields);
      res.render("admin/form", {
        layout: "main",
        title: `Edit ${schema.label}`,
        schema,
        record,
        relationOptions,
        action: `/admin/${schema.key}/${req.params.id}${scopeQuery(context)}`,
        deleteAction: `/admin/${schema.key}/${req.params.id}/delete${scopeQuery(context)}`,
        adminQuery: scopeQuery(context),
        ...adminResourceService.form(schema, context, record),
        isNew: false,
        isReadonly: schema.isRecordReadonly ? schema.isRecordReadonly(record) : false,
      });
    } catch (err) {
      next(err);
    }
  }

  // POST /admin/:model  — create
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:create`);
      const { resource, context, mutation } = await openResource(req, schema, "create", true);
      const data = context ? await adminResourceService.parse(schema, req.body, context, mutation!) : castFields(cleanDeep(req.body), schema.fields);
      const created = await resource.create(data, req.user?.id);
      res.redirect(`/admin/${schema.key}/${(created as { id: string }).id}${scopeQuery(context)}`);
    } catch (err) {
      await this.validationForm(req,res,next,err,true);
    }
  }

  // POST /admin/:model/:id  — update
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:update`);
      const { resource, context, mutation } = await openResource(req, schema, "update", true);
      const before = await resource.getById(req.params.id);
      if (!before) throw AppError.notFound(schema.label);
      if (schema.isRecordReadonly?.(before)) throw AppError.forbidden("This record is managed by the application");
      const fields = schema.fieldsForRecord?.(before) ?? schema.fields;
      const data = context ? await adminResourceService.parse(schema, req.body, context, mutation!) : castFields(cleanDeep(req.body), fields);
      await resource.update(req.params.id, data, req.user?.id);
      res.redirect(`/admin/${schema.key}/${req.params.id}${scopeQuery(context)}`);
    } catch (err) {
      await this.validationForm(req,res,next,err,false);
    }
  }

  // POST /admin/:model/:id/delete  — soft delete
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = getSchema(req.params.model);
      if (req.user) await permissionsService.assert(req.user.role, `${schema.key}:delete`);
      const { resource, context } = await openResource(req, schema, "delete", true);
      const before = await resource.getById(req.params.id);
      if (!before) throw AppError.notFound(schema.label);
      if (schema.isRecordReadonly?.(before)) throw AppError.forbidden("This record is managed by the application");
      await resource.remove(req.params.id, req.user?.id);
      res.redirect(`/admin/${schema.key}${scopeQuery(context)}`);
    } catch (err) {
      next(err);
    }
  }
}

export const adminController = new AdminController();




