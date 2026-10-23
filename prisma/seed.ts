// Seed realistic dev data. Idempotent via upsert.
import { PrismaClient } from "@prisma/client";
import { authService } from "../src/services/auth.service.js";
import { credentialEncryptionService } from "../src/services/credential-encryption.service.js";

const prisma = new PrismaClient();

async function main() {
  const adminPermissions = [
    "page:read", "page:create", "page:update", "page:delete",
    "user:read", "user:create", "user:update", "user:delete",
    "role:read", "role:update",
    "route:read", "route:create", "route:update", "route:delete",
    "navigationItem:read", "navigationItem:create", "navigationItem:update", "navigationItem:delete",
    "admin:access", "admin:logs", "admin:settings",
    "workflow:read", "workflow:start", "workflow:act", "workflow:cancel", "workflow:admin",
    "integration:admin",
  ];
  const editorPermissions = ["page:read", "page:create", "page:update", "admin:access", "workflow:read"];
  const userPermissions = ["page:read", "workflow:read"];

  const adminRole = await prisma.role.upsert({
    where: { name: "ADMIN" },
    update: {
      permissions: adminPermissions,
    },
    create: {
      name: "ADMIN",
      description: "Super Administrator with full permissions",
      permissions: adminPermissions,
    },
  });

  const editorRole = await prisma.role.upsert({
    where: { name: "EDITOR" },
    update: {
      permissions: editorPermissions,
    },
    create: {
      name: "EDITOR",
      description: "Editor who can create and update content",
      permissions: editorPermissions,
    },
  });

  const userRole = await prisma.role.upsert({
    where: { name: "USER" },
    update: {
      permissions: userPermissions,
    },
    create: {
      name: "USER",
      description: "Standard user with read-only access",
      permissions: userPermissions,
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

  const defaultOrg = await prisma.organization.upsert({
    where: { slug: "acme-demo" },
    update: { deletedAt: null },
    create: {
      id: "seed-org-acme",
      name: "Acme Demo",
      slug: "acme-demo",
    },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: defaultOrg.id, userId: alice.id } },
    update: { role: "OWNER", deletedAt: null },
    create: { orgId: defaultOrg.id, userId: alice.id, role: "OWNER" },
  });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: defaultOrg.id, userId: bob.id } },
    update: { role: "ADMIN", deletedAt: null },
    create: { orgId: defaultOrg.id, userId: bob.id, role: "ADMIN" },
  });

  const heartbeatDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "platform.heartbeat" },
    update: {
      slug: "platform-heartbeat",
      workflowType: "temporalPlatformHeartbeatWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Heartbeat",
      description: "Internal workflow registration used to verify the Temporal platform catalog.",
      category: "System",
      icon: "activity",
      deletedAt: null,
    },
    create: {
      key: "platform.heartbeat",
      slug: "platform-heartbeat",
      workflowType: "temporalPlatformHeartbeatWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Heartbeat",
      description: "Internal workflow registration used to verify the Temporal platform catalog.",
      category: "System",
      icon: "activity",
    },
  });

  const platformTestDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "platform.test" },
    update: {
      slug: "platform-test",
      workflowType: "platformTestWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Test Workflow",
      description: "Internal long-running workflow used to validate generic execution, query, and cancel paths.",
      category: "System",
      icon: "activity",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "platform.test",
      slug: "platform-test",
      workflowType: "platformTestWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Test Workflow",
      description: "Internal long-running workflow used to validate generic execution, query, and cancel paths.",
      category: "System",
      icon: "activity",
      isEnabled: true,
    },
  });

  const platformApprovalDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "platform.approval" },
    update: {
      slug: "platform-approval",
      workflowType: "platformApprovalWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Approval Workflow",
      description: "Internal workflow used to validate durable human tasks, email links, and generic action submission.",
      category: "System",
      icon: "check-circle",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "platform.approval",
      slug: "platform-approval",
      workflowType: "platformApprovalWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Platform Approval Workflow",
      description: "Internal workflow used to validate durable human tasks, email links, and generic action submission.",
      category: "System",
      icon: "check-circle",
      isEnabled: true,
    },
  });

  const customerOnboardingDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.customerOnboarding" },
    update: {
      slug: "showcase-customer-onboarding",
      workflowType: "customerOnboardingWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Customer Onboarding",
      description: "Migrated showcase workflow for customer workspace, user, integration, validation, approval, and activation orchestration.",
      category: "Showcase",
      icon: "building",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.customerOnboarding",
      slug: "showcase-customer-onboarding",
      workflowType: "customerOnboardingWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Customer Onboarding",
      description: "Migrated showcase workflow for customer workspace, user, integration, validation, approval, and activation orchestration.",
      category: "Showcase",
      icon: "building",
      isEnabled: true,
    },
  });

  const humanApprovalDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.humanApproval" },
    update: {
      slug: "showcase-human-approval",
      workflowType: "humanApprovalWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Human Approval",
      description: "Migrated showcase workflow for automatic approval, manager review, request changes, resubmission, and escalation.",
      category: "Showcase",
      icon: "check-circle",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.humanApproval",
      slug: "showcase-human-approval",
      workflowType: "humanApprovalWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Human Approval",
      description: "Migrated showcase workflow for automatic approval, manager review, request changes, resubmission, and escalation.",
      category: "Showcase",
      icon: "check-circle",
      isEnabled: true,
    },
  });

  const orderFulfillmentDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.orderFulfillmentSaga" },
    update: {
      slug: "showcase-order-fulfillment-saga",
      workflowType: "orderFulfillmentSagaWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Order Fulfillment Saga",
      description: "Migrated showcase workflow for retry-safe external side effects, reverse compensation, payment, inventory, shipment, and confirmation orchestration.",
      category: "Showcase",
      icon: "shopping-cart",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.orderFulfillmentSaga",
      slug: "showcase-order-fulfillment-saga",
      workflowType: "orderFulfillmentSagaWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Order Fulfillment Saga",
      description: "Migrated showcase workflow for retry-safe external side effects, reverse compensation, payment, inventory, shipment, and confirmation orchestration.",
      category: "Showcase",
      icon: "shopping-cart",
      isEnabled: true,
    },
  });

  const dataSynchronizationDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.dataSynchronization" },
    update: {
      slug: "showcase-data-synchronization",
      workflowType: "dataSynchronizationWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Data Synchronization",
      description: "Migrated showcase workflow for source fetch, canonical transform, parallel CRM/ERP/Billing sync, validation, and targeted reconciliation.",
      category: "Showcase",
      icon: "refresh-cw",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.dataSynchronization",
      slug: "showcase-data-synchronization",
      workflowType: "dataSynchronizationWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Data Synchronization",
      description: "Migrated showcase workflow for source fetch, canonical transform, parallel CRM/ERP/Billing sync, validation, and targeted reconciliation.",
      category: "Showcase",
      icon: "refresh-cw",
      isEnabled: true,
    },
  });

  const employeeLifecycleDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.employeeLifecycle" },
    update: {
      slug: "showcase-employee-lifecycle",
      workflowType: "employeeLifecycleWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Employee Lifecycle",
      description: "Migrated showcase workflow for scheduled onboarding, identity creation, access provisioning, manager checklist input, post-start review, verification, and cancellation cleanup.",
      category: "Showcase",
      icon: "user-plus",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.employeeLifecycle",
      slug: "showcase-employee-lifecycle",
      workflowType: "employeeLifecycleWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Employee Lifecycle",
      description: "Migrated showcase workflow for scheduled onboarding, identity creation, access provisioning, manager checklist input, post-start review, verification, and cancellation cleanup.",
      category: "Showcase",
      icon: "user-plus",
      isEnabled: true,
    },
  });

  const clientEngagementDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.clientEngagement" },
    update: {
      slug: "showcase-client-engagement",
      workflowType: "clientEngagementWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Client Engagement",
      description: "Migrated showcase workflow for phased delivery, child workstreams, client approval, go-live, post-launch review, and blocker tracking.",
      category: "Showcase",
      icon: "briefcase",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.clientEngagement",
      slug: "showcase-client-engagement",
      workflowType: "clientEngagementWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Client Engagement",
      description: "Migrated showcase workflow for phased delivery, child workstreams, client approval, go-live, post-launch review, and blocker tracking.",
      category: "Showcase",
      icon: "briefcase",
      isEnabled: true,
    },
  });

  const aiDocumentProcessingDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.aiDocumentProcessing" },
    update: {
      slug: "showcase-ai-document-processing",
      workflowType: "aiDocumentProcessingWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "AI Document Processing",
      description: "Migrated showcase workflow for document-reference parsing, AI classification/extraction, enrichment, confidence gates, human correction, and result storage.",
      category: "Showcase",
      icon: "file-search",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.aiDocumentProcessing",
      slug: "showcase-ai-document-processing",
      workflowType: "aiDocumentProcessingWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "AI Document Processing",
      description: "Migrated showcase workflow for document-reference parsing, AI classification/extraction, enrichment, confidence gates, human correction, and result storage.",
      category: "Showcase",
      icon: "file-search",
      isEnabled: true,
    },
  });

  const aiSupportAgentDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.aiSupportAgent" },
    update: {
      slug: "showcase-ai-support-agent",
      workflowType: "aiSupportAgentWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "AI Support Agent",
      description: "Migrated showcase workflow for AI-assisted case triage, context retrieval, approval-gated tool execution, outcome validation, and customer response.",
      category: "Showcase",
      icon: "bot",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.aiSupportAgent",
      slug: "showcase-ai-support-agent",
      workflowType: "aiSupportAgentWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "AI Support Agent",
      description: "Migrated showcase workflow for AI-assisted case triage, context retrieval, approval-gated tool execution, outcome validation, and customer response.",
      category: "Showcase",
      icon: "bot",
      isEnabled: true,
    },
  });

  const complianceReviewDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.complianceReview" },
    update: {
      slug: "showcase-compliance-review",
      workflowType: "complianceReviewWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Compliance Review",
      description: "Migrated showcase workflow for schedule-compatible compliance reviews, automated checks, evidence tasks, reminders, escalations, and final report generation.",
      category: "Showcase",
      icon: "clipboard-check",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.complianceReview",
      slug: "showcase-compliance-review",
      workflowType: "complianceReviewWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Compliance Review",
      description: "Migrated showcase workflow for schedule-compatible compliance reviews, automated checks, evidence tasks, reminders, escalations, and final report generation.",
      category: "Showcase",
      icon: "clipboard-check",
      isEnabled: true,
    },
  });

  const underwritingCapstoneDefinition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.underwritingCapstone" },
    update: {
      slug: "showcase-underwriting-capstone",
      workflowType: "underwritingCapstoneWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Underwriting Capstone",
      description: "Migrated showcase workflow for parent-child risk checks, missing-information loops, analyst decisions, cancellation cleanup, and decision history.",
      category: "Showcase",
      icon: "scale",
      isEnabled: true,
      deletedAt: null,
    },
    create: {
      key: "showcase.underwritingCapstone",
      slug: "showcase-underwriting-capstone",
      workflowType: "underwritingCapstoneWorkflow",
      contractVersion: 1,
      defaultTaskQueue: "oso-workflows",
      name: "Underwriting Capstone",
      description: "Migrated showcase workflow for parent-child risk checks, missing-information loops, analyst decisions, cancellation cleanup, and decision history.",
      category: "Showcase",
      icon: "scale",
      isEnabled: true,
    },
  });

  const syntheticRequirementDefinitions = [
    platformTestDefinition,
    customerOnboardingDefinition,
    humanApprovalDefinition,
    orderFulfillmentDefinition,
    dataSynchronizationDefinition,
    employeeLifecycleDefinition,
    clientEngagementDefinition,
    aiDocumentProcessingDefinition,
    aiSupportAgentDefinition,
    complianceReviewDefinition,
    underwritingCapstoneDefinition,
  ];

  for (const definition of syntheticRequirementDefinitions) {
    const label = definition.key === "platform.test"
      ? "Synthetic Echo Connection"
      : definition.key === "showcase.customerOnboarding"
        ? "Synthetic Provisioning Connection"
        : definition.key === "showcase.humanApproval"
          ? "Synthetic Approval Operations Connection"
          : definition.key === "showcase.orderFulfillmentSaga"
            ? "Synthetic Fulfillment Connection"
            : definition.key === "showcase.dataSynchronization"
              ? "Synthetic Data Sync Connection"
              : definition.key === "showcase.employeeLifecycle"
                ? "Synthetic Employee Provisioning Connection"
                : definition.key === "showcase.clientEngagement"
                  ? "Synthetic Engagement Delivery Connection"
                  : definition.key === "showcase.aiDocumentProcessing"
                    ? "Synthetic AI Document Connection"
                    : definition.key === "showcase.aiSupportAgent"
                      ? "Synthetic AI Support Agent Connection"
                      : definition.key === "showcase.complianceReview"
                        ? "Synthetic Compliance Operations Connection"
                        : "Synthetic Underwriting Decisioning Connection";
    const description = definition.key === "platform.test"
      ? "Development-only connection used to prove encrypted Activity-side integration resolution."
      : definition.key === "showcase.customerOnboarding"
        ? "Development-only adapter used for customer workspace, user, integration, validation, and activation steps."
        : definition.key === "showcase.humanApproval"
          ? "Development-only adapter used for approval checks, escalation, notification, and decision recording."
          : definition.key === "showcase.orderFulfillmentSaga"
            ? "Development-only adapter used for order, inventory, payment, shipment, confirmation, and compensation side effects."
            : definition.key === "showcase.dataSynchronization"
              ? "Development-only adapter used for source fetch, target sync, validation, and reconciliation side effects."
              : definition.key === "showcase.employeeLifecycle"
                ? "Development-only adapter used for identity, access provisioning, verification, and deprovisioning side effects."
                : definition.key === "showcase.clientEngagement"
                  ? "Development-only adapter used for phased delivery, child workstreams, status summaries, go-live, and review side effects."
                  : definition.key === "showcase.aiDocumentProcessing"
                    ? "Development-only adapter used for document-reference parsing, classification, extraction, enrichment, validation, and storage side effects."
                    : definition.key === "showcase.aiSupportAgent"
                      ? "Development-only adapter used for safe-message understanding, context lookup, proposal generation, approval-gated tool execution, validation, and response side effects."
                      : definition.key === "showcase.complianceReview"
                        ? "Development-only adapter used for compliance evidence collection, automated checks, reminders, escalations, and report generation side effects."
                        : "Development-only adapter used for underwriting data gathering, child risk checks, notifications, decision recording, and cancellation cleanup side effects.";

    await prisma.workflowIntegrationRequirement.upsert({
      where: {
        workflowDefinitionId_key: {
          workflowDefinitionId: definition.id,
          key: "syntheticEcho",
        },
      },
      update: {
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label,
        description,
        isRequired: true,
        deletedAt: null,
      },
      create: {
        workflowDefinitionId: definition.id,
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label,
        description,
        isRequired: true,
      },
    });
  }

  const syntheticCredentials = credentialEncryptionService.encrypt({ apiToken: "seed-synthetic-token" });
  const syntheticConnection = await prisma.integrationConnection.upsert({
    where: {
      orgId_name: {
        orgId: defaultOrg.id,
        name: "Seed Synthetic Echo",
      },
    },
    update: {
      providerKey: "synthetic.echo",
      status: "ACTIVE",
      config: { endpointLabel: "Seed local synthetic endpoint" },
      ...syntheticCredentials,
      deletedAt: null,
      disabledAt: null,
      lastTestStatus: "SUCCEEDED",
      lastTestMessage: "Seeded synthetic connection",
      lastTestedAt: new Date(),
    },
    create: {
      orgId: defaultOrg.id,
      name: "Seed Synthetic Echo",
      providerKey: "synthetic.echo",
      status: "ACTIVE",
      config: { endpointLabel: "Seed local synthetic endpoint" },
      ...syntheticCredentials,
      lastTestStatus: "SUCCEEDED",
      lastTestMessage: "Seeded synthetic connection",
      lastTestedAt: new Date(),
    },
  });

  for (const definition of syntheticRequirementDefinitions) {
    await prisma.workflowIntegrationBinding.upsert({
      where: {
        orgId_workflowDefinitionId_requirementKey: {
          orgId: defaultOrg.id,
          workflowDefinitionId: definition.id,
          requirementKey: "syntheticEcho",
        },
      },
      update: {
        connectionId: syntheticConnection.id,
        isEnabled: true,
        deletedAt: null,
        lastValidationStatus: "SUCCEEDED",
        lastValidationMessage: "Seeded binding",
        lastValidatedAt: new Date(),
      },
      create: {
        orgId: defaultOrg.id,
        workflowDefinitionId: definition.id,
        requirementKey: "syntheticEcho",
        connectionId: syntheticConnection.id,
        isEnabled: true,
        lastValidationStatus: "SUCCEEDED",
        lastValidationMessage: "Seeded binding",
        lastValidatedAt: new Date(),
      },
    });
  }

  for (const capability of ["START", "VIEW", "ACT", "CANCEL", "ADMIN"] as const) {
    for (const definition of [
      heartbeatDefinition,
      platformTestDefinition,
      platformApprovalDefinition,
      customerOnboardingDefinition,
      humanApprovalDefinition,
      orderFulfillmentDefinition,
      dataSynchronizationDefinition,
      employeeLifecycleDefinition,
      clientEngagementDefinition,
      aiDocumentProcessingDefinition,
      aiSupportAgentDefinition,
      complianceReviewDefinition,
      underwritingCapstoneDefinition,
    ]) {
      await prisma.workflowDefinitionRole.upsert({
        where: {
          workflowDefinitionId_roleId_capability: {
            workflowDefinitionId: definition.id,
            roleId: adminRole.id,
            capability,
          },
        },
        update: { deletedAt: null },
        create: {
          workflowDefinitionId: definition.id,
          roleId: adminRole.id,
          capability,
        },
      });
    }
  }

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

  await prisma.navigationItem.upsert({
    where: { id: "seed-nav-workflows" },
    update: {},
    create: {
      id: "seed-nav-workflows",
      label: "Workflows",
      url: "/workflows",
      order: 20,
    },
  });

  await prisma.navigationItem.upsert({
    where: { id: "seed-nav-workflow-tasks" },
    update: {},
    create: {
      id: "seed-nav-workflow-tasks",
      label: "Workflow Tasks",
      url: "/workflow-tasks",
      order: 30,
    },
  });

  // Global settings
  const defaultSettings = [
    { key: "HOME_PAGE_SLUG", value: "getting-started" },
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

  console.log("✓ Seeded users, organizations, workflow catalog/tasks, integrations, posts, a CMS page, 3 projects, 9 tasks, 5 tags, and nav links");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());


