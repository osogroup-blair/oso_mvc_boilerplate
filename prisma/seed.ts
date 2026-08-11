// Seed realistic dev data. Idempotent via upsert.
import { PrismaClient } from "@prisma/client";
import { authService } from "../src/services/auth.service.js";

const prisma = new PrismaClient();

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {
      permissions: [
        "page:read", "page:create", "page:update", "page:delete",
        "user:read", "user:create", "user:update", "user:delete",
        "role:read", "role:update",
        "route:read", "route:create", "route:update", "route:delete",
        "navigationItem:read", "navigationItem:create", "navigationItem:update", "navigationItem:delete",
        "admin:access", "admin:logs", "admin:settings",
      ],
    },
    create: {
      name: "ADMIN",
      description: "Super Administrator with full permissions",
      permissions: [
        "page:read", "page:create", "page:update", "page:delete",
        "user:read", "user:create", "user:update", "user:delete",
        "role:read", "role:update",
        "route:read", "route:create", "route:update", "route:delete",
        "navigationItem:read", "navigationItem:create", "navigationItem:update", "navigationItem:delete",
        "admin:access", "admin:logs", "admin:settings",
      ],
    },
  });

  const editorRole = await prisma.role.upsert({
    where: { name: "EDITOR" },
    update: {
      permissions: ["page:read", "page:create", "page:update", "admin:access"],
    },
    create: {
      name: "EDITOR",
      description: "Editor who can create and update content",
      permissions: ["page:read", "page:create", "page:update", "admin:access"],
    },
  });

  const userRole = await prisma.role.upsert({
    where: { name: "USER" },
    update: {
      permissions: ["page:read"],
    },
    create: {
      name: "USER",
      description: "Standard user with read-only access",
      permissions: ["page:read"],
    },
  });

  const defaultPasswordHash = authService.hashPassword("password123");

  const alice = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {
      passwordHash: defaultPasswordHash,
    },
    create: {
      email: "alice@example.com",
      name: "Alice Admin",
      roleId: adminRole.id,
      bio: "Runs the show.",
      isActive: true,
      passwordHash: defaultPasswordHash,
      address: { street: "1 Main St", city: "Springfield", zip: "00001" },
      tags: ["founder", "ops"],
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {
      passwordHash: defaultPasswordHash,
    },
    create: {
      email: "bob@example.com",
      name: "Bob Editor",
      roleId: editorRole.id,
      passwordHash: defaultPasswordHash,
      tags: ["writer"],
    },
  });

  await prisma.post.upsert({
    where: { id: "seed-post-1" },
    update: {},
    create: {
      id: "seed-post-1",
      title: "Hello world",
      body: "First post.",
      published: true,
      authorId: alice.id,
    },
  });

  await prisma.post.upsert({
    where: { id: "seed-post-2" },
    update: {},
    create: {
      id: "seed-post-2",
      title: "Draft thoughts",
      body: "Work in progress.",
      published: false,
      authorId: bob.id,
    },
  });

  // A published CMS page. Visit http://localhost:3000/pages/welcome to see the
  // public renderer turn these JSON blocks into HTML.
  await prisma.page.upsert({
    where: { slug: "welcome" },
    update: {},
    create: {
      slug: "welcome",
      title: "Welcome to the boilerplate",
      status: "PUBLISHED",
      publishedAt: new Date(),
      seo: {
        description: "A schema-driven MVC boilerplate with a CMS.",
        ogImage: "https://example.com/og.png",
      },
      blocks: [
        { type: "heading", level: 1, text: "Built to be extended" },
        { type: "paragraph", text: "This page is stored entirely as JSON content blocks. The controller fetches it and hands the blocks array to the view, which renders each block by its type." },
        { type: "heading", level: 2, text: "How it works" },
        { type: "list", style: "bullet", items: [
          "Each block is an object with a type and its own fields.",
          "The view selects a partial per block type.",
          "Editors manage blocks in the admin at /admin/page.",
        ]},
        { type: "quote", text: "Data-driven views mean the same JSON can render as HTML, or feed an API, or drive a mobile app.", cite: "The pattern" },
        { type: "cta", label: "Open the admin", href: "/admin/page" },
      ],
    },
  });

  // ─── Demo: Project / Task / Tag seed ──────────────────────────────────────
  // 5 tag vocabulary entries
  const tagBug = await prisma.tag.upsert({
    where: { name: "bug" },
    update: {},
    create: { id: "seed-tag-bug", name: "bug", color: "#ef4444" },
  });
  const tagFeature = await prisma.tag.upsert({
    where: { name: "feature" },
    update: {},
    create: { id: "seed-tag-feature", name: "feature", color: "#6366f1" },
  });
  const tagDocs = await prisma.tag.upsert({
    where: { name: "docs" },
    update: {},
    create: { id: "seed-tag-docs", name: "docs", color: "#10b981" },
  });
  const tagChore = await prisma.tag.upsert({
    where: { name: "chore" },
    update: {},
    create: { id: "seed-tag-chore", name: "chore", color: "#f59e0b" },
  });
  const tagSecurity = await prisma.tag.upsert({
    where: { name: "security" },
    update: {},
    create: { id: "seed-tag-security", name: "security", color: "#8b5cf6" },
  });

  // 3 projects
  await prisma.project.upsert({
    where: { id: "seed-project-alpha" },
    update: {},
    create: {
      id: "seed-project-alpha",
      name: "Alpha Platform",
      description: "Core infrastructure for the Alpha product line. Demonstrates an active project with tasks in various states.",
      status: "ACTIVE",
      ownerId: alice.id,
    },
  });
  await prisma.project.upsert({
    where: { id: "seed-project-beta" },
    update: {},
    create: {
      id: "seed-project-beta",
      name: "Beta Redesign",
      description: "Full visual overhaul of the Beta product. Currently on hold pending stakeholder review.",
      status: "ON_HOLD",
      ownerId: bob.id,
    },
  });
  await prisma.project.upsert({
    where: { id: "seed-project-gamma" },
    update: {},
    create: {
      id: "seed-project-gamma",
      name: "Gamma Analytics",
      description: "Analytics pipeline project. All milestones completed — demonstrates a COMPLETED project.",
      status: "COMPLETED",
      ownerId: alice.id,
    },
  });

  // 9 tasks — ~3 per project, varied status and priority
  const taskDefs = [
    // Alpha
    {
      id: "seed-task-1",
      title: "Set up CI pipeline",
      description: "Configure GitHub Actions for automated tests and deploys.",
      status: "DONE" as const,
      priority: "HIGH" as const,
      projectId: "seed-project-alpha",
      meta: { estimatedHours: 4, storyPoints: 3 },
      tags: [tagChore.id, tagSecurity.id],
    },
    {
      id: "seed-task-2",
      title: "User authentication flow",
      description: "Implement login, session management, and role-based access.",
      status: "IN_PROGRESS" as const,
      priority: "CRITICAL" as const,
      projectId: "seed-project-alpha",
      meta: { estimatedHours: 12, storyPoints: 8 },
      tags: [tagFeature.id, tagSecurity.id],
    },
    {
      id: "seed-task-3",
      title: "Write API documentation",
      description: "Document all REST endpoints using OpenAPI / Swagger.",
      status: "TODO" as const,
      priority: "MEDIUM" as const,
      projectId: "seed-project-alpha",
      meta: { estimatedHours: 6, storyPoints: 5 },
      tags: [tagDocs.id],
    },
    // Beta
    {
      id: "seed-task-4",
      title: "Redesign landing page",
      description: "New hero section, updated typography, and improved CTA placement.",
      status: "IN_PROGRESS" as const,
      priority: "HIGH" as const,
      projectId: "seed-project-beta",
      meta: { estimatedHours: 8, storyPoints: 5 },
      tags: [tagFeature.id],
    },
    {
      id: "seed-task-5",
      title: "Audit accessibility issues",
      description: "Full WCAG 2.1 AA audit; fix all critical and major findings.",
      status: "TODO" as const,
      priority: "MEDIUM" as const,
      projectId: "seed-project-beta",
      meta: { estimatedHours: 5, storyPoints: 3 },
      tags: [tagBug.id, tagDocs.id],
    },
    {
      id: "seed-task-6",
      title: "Remove legacy CSS",
      description: "Delete the old Bootstrap bundle and replace with Tailwind utilities.",
      status: "TODO" as const,
      priority: "LOW" as const,
      projectId: "seed-project-beta",
      meta: { estimatedHours: 3, storyPoints: 2 },
      tags: [tagChore.id],
    },
    // Gamma
    {
      id: "seed-task-7",
      title: "Build event ingestion API",
      description: "High-throughput endpoint to ingest analytics events from the SDK.",
      status: "DONE" as const,
      priority: "HIGH" as const,
      projectId: "seed-project-gamma",
      meta: { estimatedHours: 16, storyPoints: 13 },
      tags: [tagFeature.id],
    },
    {
      id: "seed-task-8",
      title: "Fix dashboard query N+1",
      description: "Profile and rewrite the dashboard aggregation queries to eliminate N+1 issues.",
      status: "DONE" as const,
      priority: "HIGH" as const,
      projectId: "seed-project-gamma",
      meta: { estimatedHours: 4, storyPoints: 3 },
      tags: [tagBug.id],
    },
    {
      id: "seed-task-9",
      title: "Archive completed reports",
      description: "Move old report files to cold storage and update the retention policy docs.",
      status: "DONE" as const,
      priority: "LOW" as const,
      projectId: "seed-project-gamma",
      meta: { estimatedHours: 2, storyPoints: 1 },
      tags: [tagChore.id],
    },
  ];

  for (const def of taskDefs) {
    const { tags, ...taskData } = def;
    const task = await prisma.task.upsert({
      where: { id: taskData.id },
      update: {},
      create: taskData,
    });
    // Upsert M2M tag associations
    for (const tagId of tags) {
      await prisma.taskTag.upsert({
        where: { taskId_tagId: { taskId: task.id, tagId } },
        update: {},
        create: { taskId: task.id, tagId },
      });
    }
  }

  // Navigation link so the header shows "Projects" automatically
  await prisma.navigationItem.upsert({
    where: { id: "seed-nav-projects" },
    update: {},
    create: {
      id: "seed-nav-projects",
      label: "Projects",
      url: "/projects",
      order: 10,
    },
  });

  // Global settings
  const defaultSettings = [
    { key: "HOME_PAGE_SLUG", value: "welcome" },
    { key: "SITE_NAME", value: "My App" },
    { key: "SITE_DESCRIPTION", value: "A schema-driven MVC boilerplate application." },
    { key: "DEFAULT_PAGE_STATUS", value: "DRAFT" },
    { key: "MAX_BLOCKS_PER_PAGE", value: "20" },
    { key: "CONTACT_EMAIL", value: "contact@example.com" },
    { key: "SUPPORT_URL", value: "https://support.example.com" },
    { key: "MAX_LOGIN_ATTEMPTS", value: "10" },
    { key: "SESSION_TTL_HOURS", value: "24" },
    { key: "MAINTENANCE_MODE", value: "false" },
    { key: "MAINTENANCE_MESSAGE", value: "We are currently performing scheduled maintenance. Please check back shortly." },
    { key: "FOOTER_TEXT", value: "© 2026 My App. All rights reserved." },
    { key: "ACCENT_COLOR", value: "#6366f1" },
    { key: "LOGO_URL", value: "" },
  ];

  for (const setting of defaultSettings) {
    await prisma.siteSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  console.log("✓ Seeded users, posts, a CMS page, 3 projects, 9 tasks, 5 tags, and nav link");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());


