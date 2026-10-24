import { z } from "zod";
import { config } from "../config/index.js";
import { emptyForm, FormDefinition } from "./forms.js";
import { getIntegrationProvider, type IntegrationProviderKey } from "../integrations/index.js";

export interface IntegrationRequirementRegistration<TKey extends string = string> {
  key: TKey;
  /** Must name a provider in src/integrations/index.ts; checked by tsc and validateWorkflowRegistry. */
  providerKey: IntegrationProviderKey;
  capabilityKey?: string;
  label: string;
  description?: string;
  isRequired?: boolean;
}

export interface WorkflowActionRegistration {
  key: string;
  label: string;
  signalName: string;
  inputForm: FormDefinition;
  validateInput: (input: unknown) => Record<string, unknown>;
}

export interface WorkflowTypeRegistration<TInput = unknown, TState = unknown> {
  key: string;
  slug: string;
  workflowType: string;
  taskQueue: string;
  contractVersion: number;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  startForm: FormDefinition;
  validateStart: (input: unknown) => TInput;
  stateQuery?: string;
  summarizeInput?: (input: TInput) => Record<string, unknown>;
  actions: Record<string, WorkflowActionRegistration>;
  integrationRequirements: readonly IntegrationRequirementRegistration[];
  summarizeState: (state: TState) => Record<string, unknown>;
}

/**
 * Identity helper that keeps a registration's key and requirement keys as
 * literal types, so Workflow code can type-check `requirementKey` against the
 * declaration (see RequirementKeyFor). A registration with no requirements
 * accepts no requirement keys.
 */
export function defineWorkflow<const TKey extends string, const TRequirementKey extends string = never>(
  registration: Omit<WorkflowTypeRegistration, "key" | "integrationRequirements"> & {
    key: TKey;
    integrationRequirements: readonly IntegrationRequirementRegistration<TRequirementKey>[];
  }
) {
  return registration;
}

const platformHeartbeatInputSchema = z.object({}).passthrough();
const platformTestInputSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(160),
  durationSeconds: z.coerce.number().int().min(1).max(300).default(10),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const platformApprovalInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  instructions: z.string().trim().min(1, "Instructions are required").max(2000),
  assignedUserEmail: z.string().trim().email().optional().or(z.literal("")),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const platformApprovalActionSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const listFromText = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
};
const customerOnboardingInputSchema = z.object({
  customerId: z.string().trim().min(1, "Customer ID is required").max(120),
  companyName: z.string().trim().min(1, "Company name is required").max(160),
  primaryContactName: z.string().trim().min(1, "Primary contact name is required").max(160),
  primaryContactEmail: z.string().trim().email("Primary contact email must be valid"),
  requestedUsers: z
    .unknown()
    .transform(listFromText)
    .pipe(z.array(z.string().email("Requested users must be email addresses")).min(1, "At least one user is required")),
  requestedIntegrations: z.unknown().optional().transform(listFromText),
  planTier: z.enum(["growth", "enterprise"]).default("growth"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const customerOnboardingActionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const humanApprovalInputSchema = z.object({
  requestId: z.string().trim().min(1, "Request ID is required").max(120),
  requestType: z.string().trim().min(1, "Request type is required").max(120),
  requester: z.string().trim().min(1, "Requester is required").max(160),
  requesterEmail: z.string().trim().email().optional().or(z.literal("")),
  amount: z.coerce.number().nonnegative("Amount must be non-negative"),
  description: z.string().trim().min(1, "Description is required").max(2000),
  threshold: z.coerce.number().nonnegative("Threshold must be non-negative").default(1000),
  escalationSeconds: z.coerce.number().int().min(1).max(86_400).default(120),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const humanApprovalReviewActionSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const humanApprovalResubmitActionSchema = z.object({
  decision: z.literal("resubmit").default("resubmit"),
  newAmount: z.coerce.number().nonnegative("New amount must be non-negative"),
  newDescription: z.string().trim().min(1, "Updated description is required").max(2000),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const orderItemListFromText = (value: unknown) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, quantity, price] = line.split(",").map((part) => part.trim());
      return { id, quantity, price };
    });
};
const orderFulfillmentInputSchema = z.object({
  orderId: z.string().trim().min(1, "Order ID is required").max(120),
  customerId: z.string().trim().min(1, "Customer ID is required").max(120),
  items: z
    .unknown()
    .transform(orderItemListFromText)
    .pipe(z.array(z.object({
      id: z.string().trim().min(1, "Item ID is required"),
      quantity: z.coerce.number().positive("Quantity must be positive"),
      price: z.coerce.number().positive("Price must be positive"),
    })).min(1, "At least one order item is required")),
  paymentTokenRef: z.string().trim().min(1, "Payment token reference is required").max(160),
  shippingAddress: z.string().trim().min(1, "Shipping address is required").max(500),
  email: z.string().trim().email("Email must be valid"),
  fulfillmentScenario: z.enum(["happy_path", "shipment_rejected"]).default("happy_path"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const dataSyncTargetSchema = z.enum(["crm", "erp", "billing"]);
const dataSyncInputSchema = z.object({
  sourceRecordId: z.string().trim().min(1, "Source record ID is required").max(120),
  eventId: z.string().trim().min(1, "Event ID is required").max(120),
  sourceSystem: z.string().trim().min(1, "Source system is required").max(120),
  changedFields: z.unknown().transform(listFromText).pipe(z.array(z.string().min(1)).min(1, "At least one changed field is required")),
  targetSystems: z
    .unknown()
    .optional()
    .transform((value) => {
      const values = listFromText(value);
      return values.length > 0 ? values : undefined;
    })
    .pipe(z.array(dataSyncTargetSchema).min(1).optional()),
  validationScenario: z.enum(["all_match", "reconcile_first_target"]).default("all_match"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const employeeSystemSchema = z.enum(["email", "github", "saas"]);
const employeeLifecycleInputSchema = z.object({
  employeeId: z.string().trim().min(1, "Employee ID is required").max(120),
  name: z.string().trim().min(1, "Employee name is required").max(160),
  manager: z.string().trim().min(1, "Manager is required").max(160),
  managerEmail: z.string().trim().email().optional().or(z.literal("")),
  department: z.string().trim().min(1, "Department is required").max(120),
  startDate: z.string().trim().min(1, "Start date is required"),
  requestedSystems: z
    .unknown()
    .transform(listFromText)
    .pipe(z.array(employeeSystemSchema).min(1, "At least one system is required")),
  accessProfile: z.string().trim().min(1, "Access profile is required").max(160),
  provisioningLeadTimeSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
  postStartReviewSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const employeeLifecycleChecklistActionSchema = z.object({
  decision: z.literal("complete").default("complete"),
  completedSystems: z.unknown().optional().transform(listFromText).pipe(z.array(employeeSystemSchema).optional()),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});
const implementationWorkstreamSchema = z.enum(["data", "application", "integrations"]);
const clientEngagementInputSchema = z.object({
  engagementId: z.string().trim().min(1, "Engagement ID is required").max(120),
  clientName: z.string().trim().min(1, "Client name is required").max(160),
  sponsorEmail: z.string().trim().email("Sponsor email must be valid"),
  projectManager: z.string().trim().min(1, "Project manager is required").max(160),
  targetGoLiveDate: z.string().trim().min(1, "Target go-live date is required"),
  scopeSummary: z.string().trim().min(1, "Scope summary is required").max(2000),
  workstreams: z
    .unknown()
    .transform(listFromText)
    .pipe(z.array(implementationWorkstreamSchema).min(1, "At least one workstream is required")),
  phaseDelaySeconds: z.coerce.number().int().min(0).max(86_400).default(0),
  postLaunchReviewSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const clientEngagementApprovalActionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const optionalNumberFromForm = z.preprocess(
  (value) => value === "" || value === undefined || value === null ? undefined : value,
  z.coerce.number().optional()
);
const aiDocumentTypeSchema = z.enum(["invoice", "contract", "rfp", "support_case", "unknown"]);
const aiDocumentProcessingInputSchema = z.object({
  documentId: z.string().trim().min(1, "Document ID is required").max(120),
  documentTypeHint: aiDocumentTypeSchema.optional().or(z.literal("")),
  documentRef: z.string().trim().min(1, "Document reference is required").max(500),
  confidenceThreshold: z.coerce.number().min(0).max(1).default(0.85),
  reviewScenario: z.enum(["auto_accept", "low_confidence", "validation_error"]).default("auto_accept"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const aiDocumentReviewActionSchema = z.object({
  decision: z.enum(["approve", "correct", "reject"]),
  documentNumber: z.string().trim().max(120).optional().or(z.literal("")),
  companyName: z.string().trim().max(160).optional().or(z.literal("")),
  effectiveDate: z.string().trim().max(80).optional().or(z.literal("")),
  dueDate: z.string().trim().max(80).optional().or(z.literal("")),
  amount: optionalNumberFromForm,
  currency: z.string().trim().max(12).optional().or(z.literal("")),
  obligations: z.unknown().optional().transform(listFromText),
  requestedServices: z.unknown().optional().transform(listFromText),
  issueSummary: z.string().trim().max(1000).optional().or(z.literal("")),
  rejectionReason: z.string().trim().max(1000).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const supportAgentActionSchema = z.enum(["issue_credit", "update_case", "send_instructions", "escalate"]);
const aiSupportAgentInputSchema = z.object({
  caseId: z.string().trim().min(1, "Case ID is required").max(120),
  customerId: z.string().trim().min(1, "Customer ID is required").max(120),
  customerMessageSummary: z.string().trim().min(1, "Safe customer message summary is required").max(2000),
  planTier: z.string().trim().min(1, "Plan tier is required").max(120),
  accountStatus: z.string().trim().min(1, "Account status is required").max(120),
  recentInvoiceId: z.string().trim().min(1, "Recent invoice ID is required").max(120),
  duplicateChargeSuspected: z
    .preprocess((value) => typeof value === "boolean" ? String(value) : value, z.enum(["true", "false"]).default("true"))
    .transform((value) => value === "true"),
  approvalThresholdAmount: z.coerce.number().nonnegative().default(25),
  demoScenario: z.enum(["credit_requires_approval", "send_instructions"]).default("credit_requires_approval"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const aiSupportAgentApprovalActionSchema = z.object({
  decision: z.enum(["approved", "modified", "rejected"]),
  replacementAction: supportAgentActionSchema.optional().or(z.literal("")),
  amount: optionalNumberFromForm,
  reason: z.string().trim().max(1000).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
});
const keyValueRecordFromText = (value: unknown) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, unknown>>((acc, line) => {
      const separator = line.includes("=") ? "=" : ":";
      const [rawKey, ...rawValue] = line.split(separator);
      const key = rawKey?.trim();
      const valueText = rawValue.join(separator).trim();
      if (!key) return acc;
      const numeric = Number(valueText);
      acc[key] = valueText !== "" && Number.isFinite(numeric) ? numeric : valueText;
      return acc;
    }, {});
};
const complianceControlRowsFromText = (value: unknown) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [controlId, title, owner, evidenceRequired, classification] = line.split("|").map((part) => part.trim());
      return { controlId, title, owner, evidenceRequired, classification };
    });
};
const complianceControlClassificationSchema = z.enum(["automated", "manual"]);
const complianceReviewInputSchema = z.object({
  reviewId: z.string().trim().min(1, "Review ID is required").max(120),
  reviewPeriod: z.string().trim().min(1, "Review period is required").max(120),
  controls: z
    .unknown()
    .transform(complianceControlRowsFromText)
    .pipe(z.array(z.object({
      controlId: z.string().trim().min(1, "Control ID is required"),
      title: z.string().trim().min(1, "Control title is required"),
      owner: z.string().trim().min(1, "Control owner is required"),
      evidenceRequired: z.string().trim().min(1, "Evidence requirement is required"),
      classification: complianceControlClassificationSchema,
    })).min(1, "At least one control is required")),
  evidenceDeadlineSeconds: z.coerce.number().int().min(0).max(86_400).default(60),
  escalationIntervalSeconds: z.coerce.number().int().min(0).max(86_400).default(120),
  scheduleNote: z.string().trim().max(500).optional().or(z.literal("")),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const complianceControlActionSchema = z.object({
  decision: z.enum(["submit_accept", "reject", "waive"]),
  controlId: z.string().trim().min(1, "Control ID is required").max(120),
  evidenceReference: z.string().trim().max(500).optional().or(z.literal("")),
  submittedBy: z.string().trim().max(160).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  reason: z.string().trim().max(1000).optional().or(z.literal("")),
});
const underwritingApplicationTypeSchema = z.enum(["business_loan", "vendor_risk", "account_opening", "eligibility"]);
const underwritingInputSchema = z.object({
  applicationId: z.string().trim().min(1, "Application ID is required").max(120),
  applicantName: z.string().trim().min(1, "Applicant name is required").max(160),
  applicationType: underwritingApplicationTypeSchema,
  submittedData: z.unknown().optional().transform(keyValueRecordFromText),
  autoApproveMaxRiskScore: z.coerce.number().int().min(0).max(100).default(35),
  manualReviewMinRiskScore: z.coerce.number().int().min(0).max(100).default(36),
  autoRejectMinRiskScore: z.coerce.number().int().min(0).max(100).default(80),
  requireAnalystForMissingInformation: z
    .preprocess((value) => typeof value === "boolean" ? String(value) : value, z.enum(["true", "false"]).default("true"))
    .transform((value) => value === "true"),
  informationReminderSeconds: z.coerce.number().int().min(0).max(86_400).default(0),
  demoScenario: z.enum(["auto_approve", "manual_review", "missing_information", "auto_reject"]).default("manual_review"),
  businessKey: z.string().trim().max(80).optional().or(z.literal("")),
});
const underwritingActionSchema = z.object({
  decision: z.enum(["approved", "rejected", "request_information", "submit_information", "cancel"]),
  reason: z.string().trim().max(1000).optional().or(z.literal("")),
  requestedFields: z.unknown().optional().transform(listFromText),
  submittedFields: z.unknown().optional().transform(keyValueRecordFromText),
  submissionId: z.string().trim().max(120).optional().or(z.literal("")),
  submittedBy: z.string().trim().max(160).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

const registeredWorkflows = [
  defineWorkflow({
    key: "platform.heartbeat",
    slug: "platform-heartbeat",
    workflowType: "temporalPlatformHeartbeatWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Platform Heartbeat",
    description: "Internal workflow registration used to verify the Temporal platform catalog.",
    category: "System",
    icon: "activity",
    startForm: emptyForm,
    validateStart: (input) => platformHeartbeatInputSchema.parse(input),
    actions: {},
    integrationRequirements: [],
    summarizeState: () => ({ status: "ready" }),
  }),
  defineWorkflow({
    key: "platform.test",
    slug: "platform-test",
    workflowType: "platformTestWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Platform Test Workflow",
    description: "Internal long-running workflow used to validate generic execution, query, and cancel paths.",
    category: "System",
    icon: "activity",
    startForm: {
      fields: [
        {
          key: "message",
          label: "Message",
          type: "text",
          required: true,
          placeholder: "Hello from the workflow platform",
        },
        {
          key: "durationSeconds",
          label: "Duration Seconds",
          type: "number",
          required: true,
          defaultValue: 10,
          helpText: "Use a short value for local validation.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional idempotency key. Reusing it while an execution exists causes a conflict.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = platformTestInputSchema.parse(input);
      return {
        ...parsed,
        businessKey: parsed.businessKey || undefined,
      };
    },
    stateQuery: "platformTestState",
    summarizeInput: (input) => ({
      message: String((input as { message?: unknown }).message ?? ""),
      durationSeconds: Number((input as { durationSeconds?: unknown }).durationSeconds ?? 0),
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {},
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Echo Connection",
        description: "Development-only connection used to prove encrypted Activity-side integration resolution.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      phase: (state as { phase?: unknown }).phase ?? "unknown",
      message: (state as { message?: unknown }).message ?? "",
      durationSeconds: (state as { durationSeconds?: unknown }).durationSeconds ?? null,
      businessKey: (state as { businessKey?: unknown }).businessKey ?? null,
      integration: (state as { integration?: unknown }).integration ?? null,
    }),
  }),
  defineWorkflow({
    key: "platform.approval",
    slug: "platform-approval",
    workflowType: "platformApprovalWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Platform Approval Workflow",
    description: "Internal workflow used to validate durable human tasks, email links, and generic action submission.",
    category: "System",
    icon: "check-circle",
    startForm: {
      fields: [
        {
          key: "title",
          label: "Title",
          type: "text",
          required: true,
          placeholder: "Approve vendor onboarding",
        },
        {
          key: "instructions",
          label: "Instructions",
          type: "textarea",
          required: true,
          placeholder: "Describe what the reviewer should decide.",
        },
        {
          key: "assignedUserEmail",
          label: "Assigned User Email",
          type: "email",
          helpText: "Optional. If this matches an active user, the task appears in their inbox and receives an email link.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional idempotency key for local validation.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = platformApprovalInputSchema.parse(input);
      return {
        ...parsed,
        assignedUserEmail: parsed.assignedUserEmail || undefined,
        businessKey: parsed.businessKey || undefined,
      };
    },
    stateQuery: "platformApprovalState",
    summarizeInput: (input) => ({
      title: String((input as { title?: unknown }).title ?? ""),
      assignedUserEmail: (input as { assignedUserEmail?: unknown }).assignedUserEmail ?? null,
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      complete: {
        key: "complete",
        label: "Complete review",
        signalName: "platformApprovalAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve", value: "approved" },
                { label: "Reject", value: "rejected" },
                { label: "Request changes", value: "changes_requested" },
              ],
            },
            {
              key: "comment",
              label: "Comment",
              type: "textarea",
              helpText: "Optional context for the requester.",
            },
          ],
        },
        validateInput: (input) => {
          const parsed = platformApprovalActionSchema.parse(input);
          return {
            ...parsed,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [],
    summarizeState: (state) => ({
      phase: (state as { phase?: unknown }).phase ?? "unknown",
      title: (state as { title?: unknown }).title ?? "",
      taskId: (state as { taskId?: unknown }).taskId ?? null,
      decision: (state as { decision?: unknown }).decision ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.customerOnboarding",
    slug: "showcase-customer-onboarding",
    workflowType: "customerOnboardingWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Customer Onboarding",
    description: "Migrated showcase workflow for provisioning a customer workspace, users, integrations, validation, approval, and activation.",
    category: "Showcase",
    icon: "building",
    startForm: {
      fields: [
        { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "cust-acme-001" },
        { key: "companyName", label: "Company Name", type: "text", required: true, placeholder: "Acme Manufacturing" },
        { key: "primaryContactName", label: "Primary Contact Name", type: "text", required: true, placeholder: "Jordan Lee" },
        { key: "primaryContactEmail", label: "Primary Contact Email", type: "email", required: true, placeholder: "jordan@example.com" },
        {
          key: "requestedUsers",
          label: "Requested Users",
          type: "textarea",
          required: true,
          placeholder: "one@example.com\ntwo@example.com",
          helpText: "Enter one email per line or comma-separated.",
        },
        {
          key: "requestedIntegrations",
          label: "Requested Integration Names",
          type: "textarea",
          placeholder: "CRM\nBilling",
          helpText: "Optional labels for synthetic integration setup steps.",
        },
        {
          key: "planTier",
          label: "Plan Tier",
          type: "select",
          required: true,
          options: [
            { label: "Growth", value: "growth" },
            { label: "Enterprise", value: "enterprise" },
          ],
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the customer ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = customerOnboardingInputSchema.parse(input);
      return {
        customerId: parsed.customerId,
        companyName: parsed.companyName,
        primaryContact: {
          name: parsed.primaryContactName,
          email: parsed.primaryContactEmail,
        },
        requestedUsers: parsed.requestedUsers,
        requestedIntegrations: parsed.requestedIntegrations,
        planTier: parsed.planTier,
        businessKey: parsed.businessKey || parsed.customerId,
      };
    },
    stateQuery: "customerOnboardingState",
    summarizeInput: (input) => ({
      customerId: (input as { customerId?: unknown }).customerId ?? "",
      companyName: (input as { companyName?: unknown }).companyName ?? "",
      planTier: (input as { planTier?: unknown }).planTier ?? "",
      requestedUsers: Array.isArray((input as { requestedUsers?: unknown }).requestedUsers)
        ? (input as { requestedUsers: unknown[] }).requestedUsers.length
        : 0,
      requestedIntegrations: (input as { requestedIntegrations?: unknown }).requestedIntegrations ?? [],
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      customerDecision: {
        key: "customerDecision",
        label: "Submit onboarding decision",
        signalName: "customerOnboardingAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve activation", value: "approved" },
                { label: "Reject onboarding", value: "rejected" },
              ],
            },
            {
              key: "comment",
              label: "Reason or comment",
              type: "textarea",
              helpText: "Required by policy when rejecting, optional when approving.",
            },
          ],
        },
        validateInput: (input) => {
          const parsed = customerOnboardingActionSchema.parse(input);
          return {
            decision: parsed.decision,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Provisioning Connection",
        description: "Development-only adapter used for customer workspace, user, integration, validation, and activation steps.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      customerId: (state as { customerId?: unknown }).customerId ?? "",
      companyName: (state as { companyName?: unknown }).companyName ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentStep: (state as { currentStep?: unknown }).currentStep ?? "",
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      pendingSteps: (state as { pendingSteps?: unknown }).pendingSteps ?? [],
      customerApprovalStatus: (state as { customerApprovalStatus?: unknown }).customerApprovalStatus ?? "pending",
      rejectionReason: (state as { rejectionReason?: unknown }).rejectionReason ?? null,
      workspaceUrl: (state as { workspaceUrl?: unknown }).workspaceUrl ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.humanApproval",
    slug: "showcase-human-approval",
    workflowType: "humanApprovalWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Human Approval",
    description: "Migrated showcase workflow for auto-approval, manager review, request changes, resubmission, and escalation timers.",
    category: "Showcase",
    icon: "check-circle",
    startForm: {
      fields: [
        { key: "requestId", label: "Request ID", type: "text", required: true, placeholder: "REQ-1001" },
        { key: "requestType", label: "Request Type", type: "text", required: true, placeholder: "Procurement" },
        { key: "requester", label: "Requester", type: "text", required: true, placeholder: "Maya Chen" },
        { key: "requesterEmail", label: "Requester Email", type: "email", placeholder: "maya@example.com" },
        { key: "amount", label: "Amount", type: "number", required: true, defaultValue: 2500 },
        { key: "threshold", label: "Auto-Approval Threshold", type: "number", required: true, defaultValue: 1000 },
        { key: "description", label: "Description", type: "textarea", required: true, placeholder: "Describe the approval request." },
        {
          key: "escalationSeconds",
          label: "Escalation Seconds",
          type: "number",
          required: true,
          defaultValue: 120,
          helpText: "Use a short value for local demos.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the request ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = humanApprovalInputSchema.parse(input);
      return {
        ...parsed,
        requesterEmail: parsed.requesterEmail || undefined,
        businessKey: parsed.businessKey || parsed.requestId,
      };
    },
    stateQuery: "humanApprovalState",
    summarizeInput: (input) => ({
      requestId: (input as { requestId?: unknown }).requestId ?? "",
      requestType: (input as { requestType?: unknown }).requestType ?? "",
      amount: (input as { amount?: unknown }).amount ?? 0,
      threshold: (input as { threshold?: unknown }).threshold ?? 0,
      requester: (input as { requester?: unknown }).requester ?? "",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      managerReview: {
        key: "managerReview",
        label: "Submit manager decision",
        signalName: "humanApprovalReviewAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve", value: "approved" },
                { label: "Reject", value: "rejected" },
                { label: "Request changes", value: "changes_requested" },
              ],
            },
            {
              key: "comment",
              label: "Comment / reason / requested changes",
              type: "textarea",
            },
          ],
        },
        validateInput: (input) => {
          const parsed = humanApprovalReviewActionSchema.parse(input);
          return {
            decision: parsed.decision,
            comment: parsed.comment || undefined,
          };
        },
      },
      resubmit: {
        key: "resubmit",
        label: "Resubmit approval request",
        signalName: "humanApprovalResubmitAction",
        inputForm: {
          fields: [
            { key: "decision", label: "Decision", type: "hidden", defaultValue: "resubmit" },
            { key: "newAmount", label: "Updated Amount", type: "number", required: true },
            { key: "newDescription", label: "Updated Description", type: "textarea", required: true },
            { key: "comment", label: "Requester note", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = humanApprovalResubmitActionSchema.parse(input);
          return {
            decision: parsed.decision,
            newAmount: parsed.newAmount,
            newDescription: parsed.newDescription,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Approval Operations Connection",
        description: "Development-only adapter used for approval checks, escalation, notification, and decision recording.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      requestId: (state as { requestId?: unknown }).requestId ?? "",
      requestType: (state as { requestType?: unknown }).requestType ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      amount: (state as { amount?: unknown }).amount ?? null,
      threshold: (state as { threshold?: unknown }).threshold ?? null,
      currentApprover: (state as { currentApprover?: unknown }).currentApprover ?? null,
      outstandingChangesRequest: (state as { outstandingChangesRequest?: unknown }).outstandingChangesRequest ?? null,
      escalated: (state as { escalated?: unknown }).escalated ?? false,
      decisionHistory: (state as { decisionHistory?: unknown }).decisionHistory ?? [],
    }),
  }),
  defineWorkflow({
    key: "showcase.orderFulfillmentSaga",
    slug: "showcase-order-fulfillment-saga",
    workflowType: "orderFulfillmentSagaWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Order Fulfillment Saga",
    description: "Migrated showcase workflow for retry-safe external side effects, reverse compensation, payment, inventory, shipment, and confirmation orchestration.",
    category: "Showcase",
    icon: "shopping-cart",
    startForm: {
      fields: [
        { key: "orderId", label: "Order ID", type: "text", required: true, placeholder: "ord-1001" },
        { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "cust-acme-001" },
        {
          key: "items",
          label: "Order Items",
          type: "textarea",
          required: true,
          defaultValue: "sku-workflow-seat,2,199\nsku-integration-pack,1,499",
          helpText: "One item per line: item id, quantity, unit price.",
        },
        {
          key: "paymentTokenRef",
          label: "Payment Token Reference",
          type: "text",
          required: true,
          placeholder: "tok_admin_configured_or_vault_ref",
          helpText: "Reference only. Do not paste real card data or secrets.",
        },
        { key: "shippingAddress", label: "Shipping Address", type: "textarea", required: true },
        { key: "email", label: "Confirmation Email", type: "email", required: true },
        {
          key: "fulfillmentScenario",
          label: "Demo Fulfillment Scenario",
          type: "select",
          required: true,
          options: [
            { label: "Happy path", value: "happy_path" },
            { label: "Shipment rejected; compensate prior side effects", value: "shipment_rejected" },
          ],
          helpText: "Showcase-only control proving compensation without exposing provider secrets.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the order ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = orderFulfillmentInputSchema.parse(input);
      return {
        ...parsed,
        businessKey: parsed.businessKey || parsed.orderId,
      };
    },
    stateQuery: "orderFulfillmentSagaState",
    summarizeInput: (input) => ({
      orderId: (input as { orderId?: unknown }).orderId ?? "",
      customerId: (input as { customerId?: unknown }).customerId ?? "",
      itemCount: Array.isArray((input as { items?: unknown }).items) ? (input as { items: unknown[] }).items.length : 0,
      fulfillmentScenario: (input as { fulfillmentScenario?: unknown }).fulfillmentScenario ?? "happy_path",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {},
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Fulfillment Connection",
        description: "Development-only adapter used for order, inventory, payment, shipment, confirmation, and compensation side effects.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      orderId: (state as { orderId?: unknown }).orderId ?? "",
      customerId: (state as { customerId?: unknown }).customerId ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      totalAmount: (state as { totalAmount?: unknown }).totalAmount ?? null,
      completedSideEffects: (state as { completedSideEffects?: unknown }).completedSideEffects ?? [],
      compensationHistory: (state as { compensationHistory?: unknown }).compensationHistory ?? [],
      inventoryState: (state as { inventoryState?: unknown }).inventoryState ?? "idle",
      paymentState: (state as { paymentState?: unknown }).paymentState ?? "idle",
      shipmentState: (state as { shipmentState?: unknown }).shipmentState ?? "idle",
      orderRecordState: (state as { orderRecordState?: unknown }).orderRecordState ?? "idle",
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.dataSynchronization",
    slug: "showcase-data-synchronization",
    workflowType: "dataSynchronizationWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Data Synchronization",
    description: "Migrated showcase workflow for source fetch, canonical transform, parallel CRM/ERP/Billing fan-out, validation, and targeted reconciliation.",
    category: "Showcase",
    icon: "refresh-cw",
    startForm: {
      fields: [
        { key: "sourceRecordId", label: "Source Record ID", type: "text", required: true, placeholder: "src-1001" },
        { key: "eventId", label: "Event ID", type: "text", required: true, placeholder: "evt-customer-update-1001" },
        { key: "sourceSystem", label: "Source System", type: "text", required: true, defaultValue: "customer-directory" },
        {
          key: "changedFields",
          label: "Changed Fields",
          type: "textarea",
          required: true,
          defaultValue: "primaryContact\nstatus",
          helpText: "One field per line or comma-separated.",
        },
        {
          key: "targetSystems",
          label: "Target Systems",
          type: "textarea",
          defaultValue: "crm\nerp\nbilling",
          helpText: "Optional subset: crm, erp, billing. Leave blank to sync all.",
        },
        {
          key: "validationScenario",
          label: "Demo Validation Scenario",
          type: "select",
          required: true,
          options: [
            { label: "All targets match", value: "all_match" },
            { label: "First target mismatches; reconcile it", value: "reconcile_first_target" },
          ],
          helpText: "Showcase-only control proving targeted reconciliation.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the event ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = dataSyncInputSchema.parse(input);
      return {
        ...parsed,
        targetSystems: parsed.targetSystems?.length ? parsed.targetSystems : ["crm", "erp", "billing"],
        businessKey: parsed.businessKey || parsed.eventId,
      };
    },
    stateQuery: "dataSynchronizationState",
    summarizeInput: (input) => ({
      sourceRecordId: (input as { sourceRecordId?: unknown }).sourceRecordId ?? "",
      eventId: (input as { eventId?: unknown }).eventId ?? "",
      sourceSystem: (input as { sourceSystem?: unknown }).sourceSystem ?? "",
      changedFields: (input as { changedFields?: unknown }).changedFields ?? [],
      targetSystems: (input as { targetSystems?: unknown }).targetSystems ?? [],
      validationScenario: (input as { validationScenario?: unknown }).validationScenario ?? "all_match",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {},
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Data Sync Connection",
        description: "Development-only adapter used for source fetch, target sync, validation, and reconciliation side effects.",
        isRequired: true,
      },
      {
        key: "billingWebhook",
        providerKey: "webhook.outbound",
        capabilityKey: "deliver",
        label: "Billing Webhook",
        description: "Optional signed webhook notified after the billing target syncs. Skipped while unbound or disabled.",
        isRequired: false,
      },
    ],
    summarizeState: (state) => ({
      sourceRecordId: (state as { sourceRecordId?: unknown }).sourceRecordId ?? "",
      eventId: (state as { eventId?: unknown }).eventId ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentStep: (state as { currentStep?: unknown }).currentStep ?? "",
      requiredTargets: (state as { requiredTargets?: unknown }).requiredTargets ?? [],
      targets: (state as { targets?: unknown }).targets ?? {},
      validation: (state as { validation?: unknown }).validation ?? null,
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.employeeLifecycle",
    slug: "showcase-employee-lifecycle",
    workflowType: "employeeLifecycleWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Employee Lifecycle",
    description: "Migrated showcase workflow for scheduled onboarding, identity creation, parallel access provisioning, manager checklist input, post-start review, verification, and cancellation cleanup.",
    category: "Showcase",
    icon: "user-plus",
    startForm: {
      fields: [
        { key: "employeeId", label: "Employee ID", type: "text", required: true, placeholder: "emp-1001" },
        { key: "name", label: "Employee Name", type: "text", required: true, placeholder: "Jordan Lee" },
        { key: "manager", label: "Manager", type: "text", required: true, placeholder: "Casey Manager" },
        {
          key: "managerEmail",
          label: "Manager Email",
          type: "email",
          helpText: "Optional. When present, the manager checklist task is assigned directly to this user email.",
        },
        { key: "department", label: "Department", type: "text", required: true, defaultValue: "Operations" },
        { key: "startDate", label: "Start Date", type: "datetime", required: true },
        {
          key: "requestedSystems",
          label: "Requested Systems",
          type: "textarea",
          required: true,
          defaultValue: "email\ngithub\nsaas",
          helpText: "One system per line: email, github, saas.",
        },
        { key: "accessProfile", label: "Access Profile", type: "text", required: true, defaultValue: "standard-employee" },
        {
          key: "provisioningLeadTimeSeconds",
          label: "Provisioning Lead Time (seconds)",
          type: "number",
          defaultValue: 0,
          helpText: "Demo timer before provisioning begins. Use 0 for smoke tests.",
        },
        {
          key: "postStartReviewSeconds",
          label: "Post-start Review Delay (seconds)",
          type: "number",
          defaultValue: 0,
          helpText: "Demo timer after manager checklist completion. Use 0 for smoke tests.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the employee ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = employeeLifecycleInputSchema.parse(input);
      return {
        ...parsed,
        managerEmail: parsed.managerEmail || undefined,
        businessKey: parsed.businessKey || parsed.employeeId,
      };
    },
    stateQuery: "employeeLifecycleState",
    summarizeInput: (input) => ({
      employeeId: (input as { employeeId?: unknown }).employeeId ?? "",
      name: (input as { name?: unknown }).name ?? "",
      manager: (input as { manager?: unknown }).manager ?? "",
      department: (input as { department?: unknown }).department ?? "",
      requestedSystems: (input as { requestedSystems?: unknown }).requestedSystems ?? [],
      accessProfile: (input as { accessProfile?: unknown }).accessProfile ?? "",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      managerChecklist: {
        key: "managerChecklist",
        label: "Complete Manager Checklist",
        signalName: "employeeLifecycleChecklistAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              defaultValue: "complete",
              options: [{ label: "Complete checklist", value: "complete" }],
            },
            {
              key: "completedSystems",
              label: "Completed Systems",
              type: "textarea",
              defaultValue: "email\ngithub\nsaas",
              helpText: "Optional checklist confirmation: email, github, saas.",
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = employeeLifecycleChecklistActionSchema.parse(input);
          return {
            decision: parsed.decision,
            completedSystems: parsed.completedSystems?.length ? parsed.completedSystems : undefined,
            notes: parsed.notes || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Employee Provisioning Connection",
        description: "Development-only adapter used for identity, access provisioning, verification, and deprovisioning side effects.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      employeeId: (state as { employeeId?: unknown }).employeeId ?? "",
      name: (state as { name?: unknown }).name ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentStep: (state as { currentStep?: unknown }).currentStep ?? "",
      requestedSystems: (state as { requestedSystems?: unknown }).requestedSystems ?? [],
      systems: (state as { systems?: unknown }).systems ?? {},
      identityState: (state as { identityState?: unknown }).identityState ?? "pending",
      managerChecklistStatus: (state as { managerChecklistStatus?: unknown }).managerChecklistStatus ?? "pending",
      failedSystems: (state as { failedSystems?: unknown }).failedSystems ?? [],
      nextScheduledAction: (state as { nextScheduledAction?: unknown }).nextScheduledAction ?? null,
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.clientEngagement",
    slug: "showcase-client-engagement",
    workflowType: "clientEngagementWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Client Engagement",
    description: "Migrated showcase workflow for phased delivery, real child workstreams, client approval, go-live, post-launch review, and blocker tracking.",
    category: "Showcase",
    icon: "briefcase",
    startForm: {
      fields: [
        { key: "engagementId", label: "Engagement ID", type: "text", required: true, placeholder: "eng-1001" },
        { key: "clientName", label: "Client Name", type: "text", required: true, placeholder: "Acme Corp" },
        { key: "sponsorEmail", label: "Sponsor Email", type: "email", required: true },
        { key: "projectManager", label: "Project Manager", type: "text", required: true, placeholder: "Riley PM" },
        { key: "targetGoLiveDate", label: "Target Go-live Date", type: "datetime", required: true },
        { key: "scopeSummary", label: "Scope Summary", type: "textarea", required: true },
        {
          key: "workstreams",
          label: "Implementation Workstreams",
          type: "textarea",
          required: true,
          defaultValue: "data\napplication\nintegrations",
          helpText: "One workstream per line: data, application, integrations.",
        },
        {
          key: "phaseDelaySeconds",
          label: "Phase Delay (seconds)",
          type: "number",
          defaultValue: 0,
          helpText: "Demo timer between delivery phases. Use 0 for smoke tests.",
        },
        {
          key: "postLaunchReviewSeconds",
          label: "Post-launch Review Delay (seconds)",
          type: "number",
          defaultValue: 0,
          helpText: "Demo timer before the post-launch review. Use 0 for smoke tests.",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the engagement ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = clientEngagementInputSchema.parse(input);
      return {
        ...parsed,
        businessKey: parsed.businessKey || parsed.engagementId,
      };
    },
    stateQuery: "clientEngagementState",
    summarizeInput: (input) => ({
      engagementId: (input as { engagementId?: unknown }).engagementId ?? "",
      clientName: (input as { clientName?: unknown }).clientName ?? "",
      sponsorEmail: (input as { sponsorEmail?: unknown }).sponsorEmail ?? "",
      projectManager: (input as { projectManager?: unknown }).projectManager ?? "",
      workstreams: (input as { workstreams?: unknown }).workstreams ?? [],
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      clientPhaseApproval: {
        key: "clientPhaseApproval",
        label: "Submit Client Phase Approval",
        signalName: "clientEngagementApprovalAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve", value: "approved" },
                { label: "Reject / Block", value: "rejected" },
              ],
            },
            { key: "comment", label: "Comment", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = clientEngagementApprovalActionSchema.parse(input);
          return {
            decision: parsed.decision,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Engagement Delivery Connection",
        description: "Development-only adapter used for phased delivery, child workstreams, status summaries, go-live, and review side effects.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      engagementId: (state as { engagementId?: unknown }).engagementId ?? "",
      clientName: (state as { clientName?: unknown }).clientName ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentPhase: (state as { currentPhase?: unknown }).currentPhase ?? "",
      currentStep: (state as { currentStep?: unknown }).currentStep ?? "",
      completedPhases: (state as { completedPhases?: unknown }).completedPhases ?? [],
      implementationWorkstreams: (state as { implementationWorkstreams?: unknown }).implementationWorkstreams ?? {},
      activeChildWorkflows: (state as { activeChildWorkflows?: unknown }).activeChildWorkflows ?? [],
      blockers: (state as { blockers?: unknown }).blockers ?? [],
      clientApproval: (state as { clientApproval?: unknown }).clientApproval ?? null,
      milestones: (state as { milestones?: unknown }).milestones ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.aiDocumentProcessing",
    slug: "showcase-ai-document-processing",
    workflowType: "aiDocumentProcessingWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "AI Document Processing",
    description: "Migrated showcase workflow for document-reference parsing, AI classification/extraction, enrichment, confidence and policy gates, human correction, and result storage without putting raw files or prompts in Workflow history.",
    category: "Showcase",
    icon: "file-search",
    startForm: {
      fields: [
        { key: "documentId", label: "Document ID", type: "text", required: true, placeholder: "doc-1001" },
        {
          key: "documentTypeHint",
          label: "Document Type Hint",
          type: "select",
          options: [
            { label: "Unknown", value: "unknown" },
            { label: "Invoice", value: "invoice" },
            { label: "Contract", value: "contract" },
            { label: "RFP", value: "rfp" },
            { label: "Support case", value: "support_case" },
          ],
          defaultValue: "invoice",
        },
        {
          key: "documentRef",
          label: "Document Reference",
          type: "text",
          required: true,
          placeholder: "asset://invoice-demo-1001",
          helpText: "Reference only. Do not paste raw document text or secrets into this form.",
        },
        {
          key: "confidenceThreshold",
          label: "Confidence Threshold",
          type: "number",
          required: true,
          defaultValue: 0.85,
          helpText: "0.00-1.00 threshold. Low confidence creates a generic review task.",
        },
        {
          key: "reviewScenario",
          label: "Demo Review Scenario",
          type: "select",
          required: true,
          options: [
            { label: "Auto accept", value: "auto_accept" },
            { label: "Low confidence; request review", value: "low_confidence" },
            { label: "Validation error; request correction", value: "validation_error" },
          ],
          defaultValue: "auto_accept",
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the document ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = aiDocumentProcessingInputSchema.parse(input);
      return {
        ...parsed,
        documentTypeHint: parsed.documentTypeHint || undefined,
        businessKey: parsed.businessKey || parsed.documentId,
      };
    },
    stateQuery: "aiDocumentProcessingState",
    summarizeInput: (input) => ({
      documentId: (input as { documentId?: unknown }).documentId ?? "",
      documentTypeHint: (input as { documentTypeHint?: unknown }).documentTypeHint ?? null,
      documentRef: (input as { documentRef?: unknown }).documentRef ?? "",
      confidenceThreshold: (input as { confidenceThreshold?: unknown }).confidenceThreshold ?? null,
      reviewScenario: (input as { reviewScenario?: unknown }).reviewScenario ?? "auto_accept",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      documentReview: {
        key: "documentReview",
        label: "Review AI Extraction",
        signalName: "aiDocumentReviewAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve extraction", value: "approve" },
                { label: "Correct extraction", value: "correct" },
                { label: "Reject document", value: "reject" },
              ],
            },
            { key: "documentNumber", label: "Document Number", type: "text" },
            { key: "companyName", label: "Company Name", type: "text" },
            { key: "effectiveDate", label: "Effective Date", type: "date" },
            { key: "dueDate", label: "Due Date", type: "date" },
            { key: "amount", label: "Amount", type: "number" },
            { key: "currency", label: "Currency", type: "text", defaultValue: "USD" },
            { key: "obligations", label: "Obligations", type: "textarea", helpText: "One obligation per line." },
            { key: "requestedServices", label: "Requested Services", type: "textarea", helpText: "One service per line." },
            { key: "issueSummary", label: "Issue Summary", type: "textarea" },
            { key: "rejectionReason", label: "Rejection Reason", type: "textarea" },
            { key: "comment", label: "Reviewer Comment", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = aiDocumentReviewActionSchema.parse(input);
          return {
            decision: parsed.decision,
            documentNumber: parsed.documentNumber || undefined,
            companyName: parsed.companyName || undefined,
            effectiveDate: parsed.effectiveDate || undefined,
            dueDate: parsed.dueDate || undefined,
            amount: parsed.amount,
            currency: parsed.currency || undefined,
            obligations: parsed.obligations.length > 0 ? parsed.obligations : undefined,
            requestedServices: parsed.requestedServices.length > 0 ? parsed.requestedServices : undefined,
            issueSummary: parsed.issueSummary || undefined,
            rejectionReason: parsed.rejectionReason || undefined,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic AI Document Connection",
        description: "Development-only adapter used for document-reference parsing, classification, extraction, enrichment, validation, and storage side effects.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      documentId: (state as { documentId?: unknown }).documentId ?? "",
      documentRef: (state as { documentRef?: unknown }).documentRef ?? "",
      stage: (state as { stage?: unknown }).stage ?? "unknown",
      classification: (state as { classification?: unknown }).classification ?? null,
      confidenceScore: (state as { confidenceScore?: unknown }).confidenceScore ?? null,
      confidenceThreshold: (state as { confidenceThreshold?: unknown }).confidenceThreshold ?? null,
      humanReviewStatus: (state as { humanReviewStatus?: unknown }).humanReviewStatus ?? "not_required",
      extractedDataSummary: (state as { extractedDataSummary?: unknown }).extractedDataSummary ?? null,
      enrichment: (state as { enrichment?: unknown }).enrichment ?? null,
      validation: (state as { validation?: unknown }).validation ?? null,
      storedResultId: (state as { storedResultId?: unknown }).storedResultId ?? null,
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.aiSupportAgent",
    slug: "showcase-ai-support-agent",
    workflowType: "aiSupportAgentWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "AI Support Agent",
    description: "Migrated showcase workflow for AI-assisted case triage, context retrieval, approval-gated tool execution, outcome validation, and customer response without storing raw prompts or credentials in Workflow history.",
    category: "Showcase",
    icon: "bot",
    startForm: {
      fields: [
        { key: "caseId", label: "Case ID", type: "text", required: true, placeholder: "case-1001" },
        { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "cust-1001" },
        {
          key: "customerMessageSummary",
          label: "Safe Customer Message Summary",
          type: "textarea",
          required: true,
          helpText: "Summarized/non-sensitive case text only. Do not paste full transcripts or secrets.",
        },
        { key: "planTier", label: "Plan Tier", type: "text", required: true, defaultValue: "enterprise" },
        { key: "accountStatus", label: "Account Status", type: "text", required: true, defaultValue: "active" },
        { key: "recentInvoiceId", label: "Recent Invoice ID", type: "text", required: true, placeholder: "inv-1042" },
        {
          key: "duplicateChargeSuspected",
          label: "Duplicate Charge Suspected",
          type: "select",
          required: true,
          defaultValue: "true",
          options: [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ],
        },
        {
          key: "approvalThresholdAmount",
          label: "Approval Threshold Amount",
          type: "number",
          required: true,
          defaultValue: 25,
          helpText: "Issue-credit proposals above this amount create a generic approval task.",
        },
        {
          key: "demoScenario",
          label: "Demo Scenario",
          type: "select",
          required: true,
          defaultValue: "credit_requires_approval",
          options: [
            { label: "Credit requires approval", value: "credit_requires_approval" },
            { label: "Send instructions only", value: "send_instructions" },
          ],
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the case ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = aiSupportAgentInputSchema.parse(input);
      return {
        ...parsed,
        accountContext: {
          planTier: parsed.planTier,
          accountStatus: parsed.accountStatus,
          recentInvoiceId: parsed.recentInvoiceId,
          duplicateChargeSuspected: parsed.duplicateChargeSuspected,
        },
        businessKey: parsed.businessKey || parsed.caseId,
      };
    },
    stateQuery: "aiSupportAgentState",
    summarizeInput: (input) => ({
      caseId: (input as { caseId?: unknown }).caseId ?? "",
      customerId: (input as { customerId?: unknown }).customerId ?? "",
      planTier: (input as { planTier?: unknown }).planTier ?? "",
      accountStatus: (input as { accountStatus?: unknown }).accountStatus ?? "",
      recentInvoiceId: (input as { recentInvoiceId?: unknown }).recentInvoiceId ?? "",
      duplicateChargeSuspected: (input as { duplicateChargeSuspected?: unknown }).duplicateChargeSuspected ?? null,
      demoScenario: (input as { demoScenario?: unknown }).demoScenario ?? "credit_requires_approval",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      agentApproval: {
        key: "agentApproval",
        label: "Review Agent Action",
        signalName: "aiSupportAgentApprovalAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve proposed action", value: "approved" },
                { label: "Modify action", value: "modified" },
                { label: "Reject action", value: "rejected" },
              ],
            },
            {
              key: "replacementAction",
              label: "Replacement Action",
              type: "select",
              options: [
                { label: "Issue credit", value: "issue_credit" },
                { label: "Update case", value: "update_case" },
                { label: "Send instructions", value: "send_instructions" },
                { label: "Escalate", value: "escalate" },
              ],
            },
            { key: "amount", label: "Amount", type: "number" },
            { key: "reason", label: "Reason", type: "textarea" },
            { key: "comment", label: "Approver Comment", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = aiSupportAgentApprovalActionSchema.parse(input);
          return {
            decision: parsed.decision,
            replacementAction: parsed.replacementAction || undefined,
            amount: parsed.amount,
            reason: parsed.reason || undefined,
            comment: parsed.comment || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic AI Support Agent Connection",
        description: "Development-only adapter used for safe-message understanding, context lookup, proposal generation, approval-gated tool execution, validation, and response side effects.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      caseId: (state as { caseId?: unknown }).caseId ?? "",
      customerId: (state as { customerId?: unknown }).customerId ?? "",
      stage: (state as { stage?: unknown }).stage ?? "unknown",
      proposal: (state as { proposal?: unknown }).proposal ?? null,
      pendingApproval: (state as { pendingApproval?: unknown }).pendingApproval ?? false,
      approvalStatus: (state as { approvalStatus?: unknown }).approvalStatus ?? "not_required",
      toolCalls: (state as { toolCalls?: unknown }).toolCalls ?? [],
      validation: (state as { validation?: unknown }).validation ?? null,
      finalResponseSummary: (state as { finalResponseSummary?: unknown }).finalResponseSummary ?? null,
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.complianceReview",
    slug: "showcase-compliance-review",
    workflowType: "complianceReviewWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Compliance Review",
    description: "Migrated showcase workflow for scheduled/manual compliance reviews, automated checks, parallel evidence tasks, reminders/escalations, waivers, report generation, and audit-safe findings.",
    category: "Showcase",
    icon: "shield-check",
    startForm: {
      fields: [
        { key: "reviewId", label: "Review ID", type: "text", required: true, placeholder: "review-2026-q3" },
        { key: "reviewPeriod", label: "Review Period", type: "text", required: true, placeholder: "2026 Q3" },
        {
          key: "controls",
          label: "Controls",
          type: "textarea",
          required: true,
          defaultValue: "CTRL-AUTO-1|Backup policy enabled|Security Ops|System backup policy evidence|automated\nCTRL-MANUAL-1|Quarterly access review|IT Owner|Signed access review evidence|manual",
          helpText: "One control per line: id|title|owner|evidence required|automated/manual.",
        },
        {
          key: "evidenceDeadlineSeconds",
          label: "Evidence Deadline Seconds",
          type: "number",
          defaultValue: 60,
          helpText: "Demo timer before reminder. Use 0 in smoke tests.",
        },
        {
          key: "escalationIntervalSeconds",
          label: "Escalation Interval Seconds",
          type: "number",
          defaultValue: 120,
          helpText: "Demo timer before escalation. Use 0 in smoke tests.",
        },
        { key: "scheduleNote", label: "Schedule Note", type: "textarea" },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the review ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = complianceReviewInputSchema.parse(input);
      return {
        ...parsed,
        scheduleNote: parsed.scheduleNote || undefined,
        businessKey: parsed.businessKey || parsed.reviewId,
      };
    },
    stateQuery: "complianceReviewState",
    summarizeInput: (input) => ({
      reviewId: (input as { reviewId?: unknown }).reviewId ?? "",
      reviewPeriod: (input as { reviewPeriod?: unknown }).reviewPeriod ?? "",
      controlCount: Array.isArray((input as { controls?: unknown }).controls) ? (input as { controls: unknown[] }).controls.length : 0,
      evidenceDeadlineSeconds: (input as { evidenceDeadlineSeconds?: unknown }).evidenceDeadlineSeconds ?? null,
      escalationIntervalSeconds: (input as { escalationIntervalSeconds?: unknown }).escalationIntervalSeconds ?? null,
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      complianceControlAction: {
        key: "complianceControlAction",
        label: "Submit Compliance Control Action",
        signalName: "complianceReviewControlAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Submit and accept evidence", value: "submit_accept" },
                { label: "Reject evidence", value: "reject" },
                { label: "Waive control", value: "waive" },
              ],
            },
            { key: "controlId", label: "Control ID", type: "text", required: true },
            { key: "evidenceReference", label: "Evidence Reference", type: "text", helpText: "Reference only; do not paste evidence files." },
            { key: "submittedBy", label: "Submitted By", type: "text" },
            { key: "notes", label: "Notes", type: "textarea" },
            { key: "reason", label: "Reason", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = complianceControlActionSchema.parse(input);
          return {
            decision: parsed.decision,
            controlId: parsed.controlId,
            evidenceReference: parsed.evidenceReference || undefined,
            submittedBy: parsed.submittedBy || undefined,
            notes: parsed.notes || undefined,
            reason: parsed.reason || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Compliance Operations Connection",
        description: "Development-only adapter used for evidence collection, automated checks, reminders, escalations, and report generation.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      reviewId: (state as { reviewId?: unknown }).reviewId ?? "",
      reviewPeriod: (state as { reviewPeriod?: unknown }).reviewPeriod ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentStep: (state as { currentStep?: unknown }).currentStep ?? "",
      statusBreakdown: (state as { statusBreakdown?: unknown }).statusBreakdown ?? {},
      missingEvidence: (state as { missingEvidence?: unknown }).missingEvidence ?? [],
      overdueControls: (state as { overdueControls?: unknown }).overdueControls ?? [],
      findings: (state as { findings?: unknown }).findings ?? [],
      completionPercentage: (state as { completionPercentage?: unknown }).completionPercentage ?? 0,
      report: (state as { report?: unknown }).report ?? null,
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
  defineWorkflow({
    key: "showcase.underwritingCapstone",
    slug: "showcase-underwriting-capstone",
    workflowType: "underwritingCapstoneWorkflow",
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    contractVersion: 1,
    name: "Underwriting Capstone",
    description: "Migrated showcase workflow for decisioning case management, parallel child risk checks, missing-information loops, analyst review, cancellation cleanup, and decision audit history.",
    category: "Showcase",
    icon: "scale",
    startForm: {
      fields: [
        { key: "applicationId", label: "Application ID", type: "text", required: true, placeholder: "app-1001" },
        { key: "applicantName", label: "Applicant Name", type: "text", required: true, placeholder: "Northstar Manufacturing Group" },
        {
          key: "applicationType",
          label: "Application Type",
          type: "select",
          required: true,
          defaultValue: "business_loan",
          options: [
            { label: "Business loan", value: "business_loan" },
            { label: "Vendor risk", value: "vendor_risk" },
            { label: "Account opening", value: "account_opening" },
            { label: "Eligibility", value: "eligibility" },
          ],
        },
        {
          key: "submittedData",
          label: "Submitted Data",
          type: "textarea",
          defaultValue: "identityDocument=synthetic-passport-verified\nbusinessRegistration=synthetic-registration-verified\nbankStatements=synthetic-bank-statements\nrequestedAmount=75000",
          helpText: "One key=value per line. References only; do not paste sensitive documents.",
        },
        { key: "autoApproveMaxRiskScore", label: "Auto-approve Max Risk Score", type: "number", defaultValue: 35 },
        { key: "manualReviewMinRiskScore", label: "Manual Review Min Risk Score", type: "number", defaultValue: 36 },
        { key: "autoRejectMinRiskScore", label: "Auto-reject Min Risk Score", type: "number", defaultValue: 80 },
        {
          key: "requireAnalystForMissingInformation",
          label: "Require Analyst For Missing Information",
          type: "select",
          required: true,
          defaultValue: "true",
          options: [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ],
        },
        { key: "informationReminderSeconds", label: "Information Reminder Seconds", type: "number", defaultValue: 0 },
        {
          key: "demoScenario",
          label: "Demo Scenario",
          type: "select",
          required: true,
          defaultValue: "manual_review",
          options: [
            { label: "Auto approve", value: "auto_approve" },
            { label: "Manual review", value: "manual_review" },
            { label: "Missing information loop", value: "missing_information" },
            { label: "Auto reject", value: "auto_reject" },
          ],
        },
        {
          key: "businessKey",
          label: "Business Key",
          type: "text",
          helpText: "Optional. Defaults to the application ID for idempotent local starts.",
        },
      ],
    },
    validateStart: (input) => {
      const parsed = underwritingInputSchema.parse(input);
      return {
        ...parsed,
        decisionPolicy: {
          autoApproveMaxRiskScore: parsed.autoApproveMaxRiskScore,
          manualReviewMinRiskScore: parsed.manualReviewMinRiskScore,
          autoRejectMinRiskScore: parsed.autoRejectMinRiskScore,
          requireAnalystForMissingInformation: parsed.requireAnalystForMissingInformation,
        },
        demoTiming: {
          informationReminderSeconds: parsed.informationReminderSeconds,
        },
        businessKey: parsed.businessKey || parsed.applicationId,
      };
    },
    stateQuery: "underwritingCapstoneState",
    summarizeInput: (input) => ({
      applicationId: (input as { applicationId?: unknown }).applicationId ?? "",
      applicantName: (input as { applicantName?: unknown }).applicantName ?? "",
      applicationType: (input as { applicationType?: unknown }).applicationType ?? "",
      demoScenario: (input as { demoScenario?: unknown }).demoScenario ?? "manual_review",
      businessKey: (input as { businessKey?: unknown }).businessKey ?? null,
    }),
    actions: {
      underwritingAction: {
        key: "underwritingAction",
        label: "Submit Underwriting Action",
        signalName: "underwritingCapstoneAction",
        inputForm: {
          fields: [
            {
              key: "decision",
              label: "Decision",
              type: "select",
              required: true,
              options: [
                { label: "Approve", value: "approved" },
                { label: "Reject", value: "rejected" },
                { label: "Request information", value: "request_information" },
                { label: "Submit information", value: "submit_information" },
                { label: "Cancel application", value: "cancel" },
              ],
            },
            { key: "reason", label: "Reason", type: "textarea" },
            { key: "requestedFields", label: "Requested Fields", type: "textarea", helpText: "One field per line." },
            { key: "submittedFields", label: "Submitted Fields", type: "textarea", helpText: "One key=value per line." },
            { key: "submissionId", label: "Submission ID", type: "text" },
            { key: "submittedBy", label: "Submitted By", type: "text" },
            { key: "notes", label: "Notes", type: "textarea" },
          ],
        },
        validateInput: (input) => {
          const parsed = underwritingActionSchema.parse(input);
          return {
            decision: parsed.decision,
            reason: parsed.reason || undefined,
            requestedFields: parsed.requestedFields.length > 0 ? parsed.requestedFields : undefined,
            submittedFields: Object.keys(parsed.submittedFields).length > 0 ? parsed.submittedFields : undefined,
            submissionId: parsed.submissionId || undefined,
            submittedBy: parsed.submittedBy || undefined,
            notes: parsed.notes || undefined,
          };
        },
      },
    },
    integrationRequirements: [
      {
        key: "syntheticEcho",
        providerKey: "synthetic.echo",
        capabilityKey: "echo",
        label: "Synthetic Underwriting Decisioning Connection",
        description: "Development-only adapter used for data gathering, child risk checks, notifications, decisions, and cancellation cleanup.",
        isRequired: true,
      },
    ],
    summarizeState: (state) => ({
      applicationId: (state as { applicationId?: unknown }).applicationId ?? "",
      applicantName: (state as { applicantName?: unknown }).applicantName ?? "",
      applicationType: (state as { applicationType?: unknown }).applicationType ?? "",
      status: (state as { status?: unknown }).status ?? "unknown",
      currentStage: (state as { currentStage?: unknown }).currentStage ?? "",
      nextAction: (state as { nextAction?: unknown }).nextAction ?? "",
      missingInformation: (state as { missingInformation?: unknown }).missingInformation ?? [],
      analystReviewStatus: (state as { analystReviewStatus?: unknown }).analystReviewStatus ?? "not_required",
      finalDecision: (state as { finalDecision?: unknown }).finalDecision ?? null,
      riskScore: (state as { riskScore?: unknown }).riskScore ?? null,
      riskSummary: (state as { riskSummary?: unknown }).riskSummary ?? null,
      decisionHistory: (state as { decisionHistory?: unknown }).decisionHistory ?? [],
      childWorkflowIds: (state as { childWorkflowIds?: unknown }).childWorkflowIds ?? [],
      completedSteps: (state as { completedSteps?: unknown }).completedSteps ?? [],
      lastError: (state as { lastError?: unknown }).lastError ?? null,
    }),
  }),
] as const;

/** Runtime list of every code-registered workflow. */
export const workflowRegistrations: WorkflowTypeRegistration[] = [...registeredWorkflows];

type RegisteredWorkflow = (typeof registeredWorkflows)[number];
/** Literal union of registered workflow keys, e.g. "platform.test". */
export type RegisteredWorkflowKey = RegisteredWorkflow["key"];
/** Integration requirement keys declared by one workflow; use with `satisfies` in Workflow code. */
export type RequirementKeyFor<K extends RegisteredWorkflowKey> =
  Extract<RegisteredWorkflow, { key: K }>["integrationRequirements"][number]["key"];
/** Every integration requirement key declared by any registered workflow. */
export type IntegrationRequirementKey = RegisteredWorkflow["integrationRequirements"][number]["key"];

export function getWorkflowRegistration(key: string) {
  return workflowRegistrations.find((registration) => registration.key === key) ?? null;
}

export function getWorkflowRegistrationBySlug(slug: string) {
  return workflowRegistrations.find((registration) => registration.slug === slug) ?? null;
}

export function validateWorkflowRegistry(registrations = workflowRegistrations) {
  const keys = new Set<string>();
  const slugs = new Set<string>();
  const workflowTypes = new Set<string>();

  for (const registration of registrations) {
    if (keys.has(registration.key)) {
      throw new Error(`Duplicate workflow registration key: ${registration.key}`);
    }
    if (slugs.has(registration.slug)) {
      throw new Error(`Duplicate workflow registration slug: ${registration.slug}`);
    }
    if (workflowTypes.has(registration.workflowType)) {
      throw new Error(`Duplicate workflow type: ${registration.workflowType}`);
    }

    keys.add(registration.key);
    slugs.add(registration.slug);
    workflowTypes.add(registration.workflowType);

    const actionKeys = new Set<string>();
    const signalNames = new Set<string>();
    for (const [actionKey, action] of Object.entries(registration.actions)) {
      if (actionKeys.has(actionKey)) {
        throw new Error(`Duplicate action "${actionKey}" in workflow registration: ${registration.key}`);
      }
      if (signalNames.has(action.signalName)) {
        throw new Error(`Duplicate action signal "${action.signalName}" in workflow registration: ${registration.key}`);
      }
      actionKeys.add(actionKey);
      signalNames.add(action.signalName);
    }

    const requirementKeys = new Set<string>();
    for (const requirement of registration.integrationRequirements) {
      if (requirementKeys.has(requirement.key)) {
        throw new Error(`Duplicate integration requirement "${requirement.key}" in workflow registration: ${registration.key}`);
      }
      requirementKeys.add(requirement.key);
    }
    for (const requirement of registration.integrationRequirements) {
      const provider = getIntegrationProvider(requirement.providerKey);
      if (!provider) {
        throw new Error(`Unknown integration provider "${requirement.providerKey}" for requirement "${requirement.key}" in workflow registration: ${registration.key}`);
      }
      if (requirement.capabilityKey && !provider.capabilities.includes(requirement.capabilityKey)) {
        throw new Error(`Integration provider "${requirement.providerKey}" does not declare capability "${requirement.capabilityKey}" (requirement "${requirement.key}" in workflow registration: ${registration.key})`);
      }
    }
  }

  return registrations;
}
