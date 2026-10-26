// Maps an admin schema key → a uniform CRUD interface backed by a service.
// This is the seam that lets ONE admin controller drive ANY model.
// Register a new model's resource here when you add its schema.
import type { AdminResource } from "../admin/resource.types.js";
export type { AdminResource } from "../admin/resource.types.js";
import { AppError } from "../lib/AppError.js";
import { userService } from "../services/user.service.js";
import { pageService } from "../services/page.service.js";
import { navigationItemService } from "../services/navigationItem.service.js";
import { routeService } from "../services/route.service.js";
import { roleService } from "../services/role.service.js";
import { projectService } from "../services/project.service.js";
import { taskService } from "../services/task.service.js";
import { tagService } from "../services/tag.service.js";


// Adapter: wraps the typed UserService in the generic AdminResource shape.
// Casts are intentional and isolated here — services stay strongly typed.
const userResource: AdminResource = {
  list: (p) => userService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => userService.list({ skip: 0, take: 1000, orderBy: { name: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => userService.count(s),
  getById: (id) => userService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => userService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => userService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => userService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const pageResource: AdminResource = {
  list: (p) => pageService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => pageService.list({ skip: 0, take: 1000, orderBy: { title: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => pageService.count(s),
  getById: (id) => pageService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => pageService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => pageService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => pageService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const navigationItemResource: AdminResource = {
  list: (p) => navigationItemService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => navigationItemService.list({ skip: 0, take: 1000, orderBy: { label: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => navigationItemService.count(s),
  getById: (id) => navigationItemService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => navigationItemService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => navigationItemService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => navigationItemService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const routeResource: AdminResource = {
  list: (p) => routeService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => routeService.list({ skip: 0, take: 1000, orderBy: { pattern: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => routeService.count(s),
  getById: (id) => routeService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => routeService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => routeService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => routeService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const roleResource: AdminResource = {
  list: (p) => roleService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => roleService.list({ skip: 0, take: 1000, orderBy: { name: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => roleService.count(s),
  getById: (id) => roleService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => roleService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => roleService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => roleService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const projectResource: AdminResource = {
  list: (p) => projectService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => projectService.list({ skip: 0, take: 1000, orderBy: { name: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => projectService.count(s),
  getById: (id) => projectService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => projectService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => projectService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => projectService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const taskResource: AdminResource = {
  list: (p) => taskService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => taskService.list({ skip: 0, take: 1000, orderBy: { title: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => taskService.count(s),
  getById: (id) => taskService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => taskService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => taskService.update(id, d as never, actor, undefined, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => taskService.remove(id, actor, undefined, operationId) as Promise<Record<string, unknown>>,
};

const tagResource: AdminResource = {
  list: (p) => tagService.list(p) as Promise<Record<string, unknown>[]>,
  listAll: () => tagService.list({ skip: 0, take: 1000, orderBy: { name: "asc" } }) as Promise<Record<string, unknown>[]>,
  count: (s) => tagService.count(s),
  getById: (id) => tagService.getById(id) as Promise<Record<string, unknown>>,
  create: (d, actor, operationId) => tagService.create(d as never, actor, operationId) as Promise<Record<string, unknown>>,
  update: (id, d, actor, operationId) => tagService.update(id, d as never, actor, operationId) as Promise<Record<string, unknown>>,
  remove: (id, actor, operationId) => tagService.remove(id, actor, operationId) as Promise<Record<string, unknown>>,
};

const resources = new Map<string, AdminResource>();
resources.set("user", userResource);
resources.set("page", pageResource);
resources.set("navigationItem", navigationItemResource);
resources.set("route", routeResource);
resources.set("role", roleResource);
resources.set("project", projectResource);
resources.set("task", taskResource);
resources.set("tag", tagResource);

export function getResource(key: string): AdminResource {
  const r = resources.get(key);
  if (!r) throw AppError.notFound(`Admin resource "${key}"`);
  return r;
}
