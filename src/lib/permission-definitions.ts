export interface PermissionDef {
  resource: string;
  action: string;
  label: string;
  description?: string;
}

export const DEFINED_PERMISSIONS: PermissionDef[] = [
  ...["project", "task", "tag", "role"].flatMap(resource =>
    ["read", "create", "update", "delete"].map(action => ({ resource, action, label: `${action} ${resource}` }))),
  { resource: "session", action: "read", label: "View Sessions" },
  { resource: "session", action: "revoke", label: "Revoke Sessions" },
  { resource: "asset", action: "read", label: "View Media" },
  { resource: "asset", action: "create", label: "Upload Media" },
  { resource: "asset", action: "delete", label: "Delete Media" },
  { resource: "queue", action: "admin", label: "Manage Queues" },
  { resource: "organization", action: "create", label: "Create Organizations" },
  { resource: "organization", action: "admin", label: "Administer All Organizations" },
  // Pages
  { resource: "page", action: "read",   label: "View Pages",      description: "Access published CMS pages" },
  { resource: "page", action: "create", label: "Create Pages",    description: "Create new CMS pages" },
  { resource: "page", action: "update", label: "Edit Pages",      description: "Edit existing CMS pages" },
  { resource: "page", action: "delete", label: "Delete Pages",    description: "Delete / archive CMS pages" },
  // Users
  { resource: "user", action: "read",   label: "View Users",      description: "List and view user accounts" },
  { resource: "user", action: "create", label: "Create Users",    description: "Create new user accounts" },
  { resource: "user", action: "update", label: "Edit Users",      description: "Edit user accounts" },
  { resource: "user", action: "delete", label: "Delete Users",    description: "Soft-delete user accounts" },
  // Roles
  // Routes
  { resource: "route", action: "read",   label: "View Routes",    description: "View dynamic routes" },
  { resource: "route", action: "create", label: "Create Routes",  description: "Create new dynamic routes" },
  { resource: "route", action: "update", label: "Edit Routes",    description: "Edit dynamic routes" },
  { resource: "route", action: "delete", label: "Delete Routes",  description: "Delete dynamic routes" },
  // Navigation
  { resource: "navigationItem", action: "read",   label: "View Nav Links",    description: "List and view navigation links" },
  { resource: "navigationItem", action: "create", label: "Create Nav Links",  description: "Create new navigation links" },
  { resource: "navigationItem", action: "update", label: "Edit Nav Links",    description: "Edit navigation links" },
  { resource: "navigationItem", action: "delete", label: "Delete Nav Links",  description: "Delete navigation links" },
  // Admin access
  { resource: "admin", action: "access", label: "Admin Access",   description: "Access the admin area at all" },
  { resource: "admin", action: "logs",   label: "View Logs",      description: "View audit logs and diagnostics" },
  { resource: "admin", action: "settings", label: "Site Settings", description: "Edit global site settings" },
  // Workflows
  { resource: "workflow", action: "read", label: "View Workflows", description: "View enabled workflow catalog entries" },
  { resource: "workflow", action: "start", label: "Start Workflows", description: "Start permitted workflows" },
  { resource: "workflow", action: "act", label: "Act on Workflows", description: "Submit permitted workflow actions" },
  { resource: "workflow", action: "cancel", label: "Cancel Workflows", description: "Cancel permitted workflow executions" },
  { resource: "workflow", action: "admin", label: "Admin Workflows", description: "Configure workflow definitions and role policy" },
  // Integrations
  { resource: "integration", action: "admin", label: "Admin Integrations", description: "Manage organization integration connections and workflow bindings" },
] as const;

export const ADMIN_PERMISSIONS = DEFINED_PERMISSIONS.map(p => `${p.resource}:${p.action}`);
