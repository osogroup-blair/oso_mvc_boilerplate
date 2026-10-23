// These static surfaces explicitly compose enforcePagePermissions(). All other
// hardcoded Page rows are inventory; CMS pages retain their normal role policy.
export const STATIC_PAGE_POLICIES = new Set(["projects", "workflows", "workflow-tasks"]);
