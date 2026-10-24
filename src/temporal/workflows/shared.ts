import { defineQuery, defineSignal, patched, proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { HumanTaskActivities, IntegrationActivities, PlatformWorkflowContext, ProjectionActivities, ShowcaseActivities, WorkflowHumanActionInput } from "../contracts.js";

export interface PlatformTestWorkflowInput {
  message: string;
  durationSeconds: number;
  businessKey?: string;
}

export interface PlatformTestWorkflowState {
  message: string;
  phase: "running" | "completed" | "cancelled";
  durationSeconds: number;
  businessKey?: string;
  integration?: {
    providerKey: string;
    connectionId: string;
    replayed: boolean;
  };
}

export const platformTestStateQuery = defineQuery<PlatformTestWorkflowState>("platformTestState");

export const platformApprovalStateQuery = defineQuery<PlatformApprovalWorkflowState>("platformApprovalState");

export const platformApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("platformApprovalAction");

export const customerOnboardingStateQuery = defineQuery<CustomerOnboardingState>("customerOnboardingState");

export const customerOnboardingActionSignal = defineSignal<[WorkflowHumanActionInput]>("customerOnboardingAction");

export const humanApprovalStateQuery = defineQuery<HumanApprovalState>("humanApprovalState");

export const humanApprovalReviewActionSignal = defineSignal<[WorkflowHumanActionInput]>("humanApprovalReviewAction");

export const humanApprovalResubmitActionSignal = defineSignal<[WorkflowHumanActionInput]>("humanApprovalResubmitAction");

export const orderFulfillmentSagaStateQuery = defineQuery<OrderFulfillmentSagaState>("orderFulfillmentSagaState");

export const dataSynchronizationStateQuery = defineQuery<DataSynchronizationState>("dataSynchronizationState");

export const employeeLifecycleStateQuery = defineQuery<EmployeeLifecycleState>("employeeLifecycleState");

export const employeeLifecycleChecklistActionSignal = defineSignal<[WorkflowHumanActionInput]>("employeeLifecycleChecklistAction");

export const clientEngagementStateQuery = defineQuery<ClientEngagementState>("clientEngagementState");

export const clientEngagementApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("clientEngagementApprovalAction");

export const aiDocumentProcessingStateQuery = defineQuery<AiDocumentProcessingState>("aiDocumentProcessingState");

export const aiDocumentReviewActionSignal = defineSignal<[WorkflowHumanActionInput]>("aiDocumentReviewAction");

export const aiSupportAgentStateQuery = defineQuery<AiSupportAgentState>("aiSupportAgentState");

export const aiSupportAgentApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("aiSupportAgentApprovalAction");

export const complianceReviewStateQuery = defineQuery<ComplianceReviewState>("complianceReviewState");

export const complianceReviewControlActionSignal = defineSignal<[WorkflowHumanActionInput]>("complianceReviewControlAction");

export const underwritingCapstoneStateQuery = defineQuery<UnderwritingCapstoneState>("underwritingCapstoneState");

export const underwritingCapstoneActionSignal = defineSignal<[WorkflowHumanActionInput]>("underwritingCapstoneAction");

const humanTaskActivities = proxyActivities<HumanTaskActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 20,
  },
});

export const integrations = proxyActivities<IntegrationActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

export const showcaseActivities = proxyActivities<ShowcaseActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
});

export const projections = proxyActivities<ProjectionActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 10,
  },
});

export async function ensureWorkflowExecutionProjection(input: unknown, context?: PlatformWorkflowContext) {
  if (!patched("workflow-execution-projection-ingestion-v1")) return;
  if (!context?.orgId || !context.startedById || !context.workflowDefinitionKey) return;
  const info = workflowInfo();
  await projections.ensureWorkflowExecutionProjection({
    orgId: context.orgId,
    workflowDefinitionKey: context.workflowDefinitionKey,
    startedById: context.startedById,
    workflowId: info.workflowId,
    runId: info.runId,
    scheduleId: context.scheduleId,
    actionProtocol: context.actionProtocol,
    input,
  });
}

export interface PlatformApprovalWorkflowInput {
  title: string;
  instructions: string;
  assignedUserEmail?: string;
  businessKey?: string;
}

export interface PlatformApprovalWorkflowState {
  phase: "waiting" | "approved" | "rejected" | "changes_requested" | "cancelled";
  title: string;
  taskId?: string;
  decision?: string;
  comment?: string;
  submittedBy?: string;
}

export interface CustomerOnboardingWorkflowInput {
  customerId: string;
  companyName: string;
  primaryContact: {
    name: string;
    email: string;
  };
  requestedUsers: string[];
  requestedIntegrations: string[];
  planTier: "growth" | "enterprise";
  businessKey?: string;
}

export type CustomerOnboardingStatus =
  | "created"
  | "provisioning_workspace"
  | "provisioning_users"
  | "configuring_integrations"
  | "running_validation"
  | "waiting_for_customer_approval"
  | "activating_account"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

export interface CustomerOnboardingState {
  customerId: string;
  companyName: string;
  currentStep: string;
  status: CustomerOnboardingStatus;
  completedSteps: string[];
  pendingSteps: string[];
  customerApprovalStatus: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  lastError?: string;
  workspaceUrl?: string;
  provisionedUsers: string[];
  configuredIntegrations: string[];
}

export interface HumanApprovalWorkflowInput {
  requestId: string;
  requestType: string;
  requester: string;
  requesterEmail?: string;
  amount: number;
  description: string;
  threshold: number;
  escalationSeconds: number;
  businessKey?: string;
}

export type HumanApprovalStatus =
  | "submitted"
  | "checking"
  | "waiting_for_approval"
  | "approval_overdue"
  | "waiting_for_resubmission"
  | "approved"
  | "rejected"
  | "cancelled"
  | "failed";

export interface HumanApprovalDecisionRecord {
  timestamp: string;
  status: "approved" | "rejected" | "changes_requested" | "resubmitted";
  approver?: string;
  reason?: string;
  notes?: string;
}

export interface HumanApprovalState {
  requestId: string;
  requestType: string;
  requester: string;
  amount: number;
  description: string;
  threshold: number;
  status: HumanApprovalStatus;
  currentApprover?: string;
  decisionHistory: HumanApprovalDecisionRecord[];
  outstandingChangesRequest?: string;
  escalated: boolean;
  riskScore?: number;
  taskId?: string;
  resubmissionTaskId?: string;
}

export interface OrderFulfillmentItem {
  id: string;
  quantity: number;
  price: number;
}

export interface OrderFulfillmentSagaWorkflowInput {
  orderId: string;
  customerId: string;
  items: OrderFulfillmentItem[];
  paymentTokenRef: string;
  shippingAddress: string;
  email: string;
  fulfillmentScenario: "happy_path" | "shipment_rejected";
  businessKey?: string;
}

export type OrderFulfillmentSagaStatus =
  | "created"
  | "reserving_inventory"
  | "charging_payment"
  | "creating_shipment"
  | "sending_confirmation"
  | "completed"
  | "compensating"
  | "compensated"
  | "cancelled"
  | "failed";

export interface OrderFulfillmentSagaState {
  orderId: string;
  customerId: string;
  status: OrderFulfillmentSagaStatus;
  totalAmount: number;
  completedSideEffects: string[];
  compensationHistory: string[];
  lastError?: string;
  inventoryState: "idle" | "reserved" | "released";
  paymentState: "idle" | "charged" | "refunded";
  shipmentState: "idle" | "created" | "cancelled";
  orderRecordState: "idle" | "created" | "cancelled";
  trackingNumber?: string;
  transactionId?: string;
}

export type DataSyncTarget = "crm" | "erp" | "billing";

export interface DataSynchronizationWorkflowInput {
  sourceRecordId: string;
  eventId: string;
  sourceSystem: string;
  changedFields: string[];
  targetSystems: DataSyncTarget[];
  validationScenario: "all_match" | "reconcile_first_target";
  businessKey?: string;
}

export type DataSynchronizationStatus =
  | "created"
  | "fetching_source"
  | "transforming"
  | "syncing_targets"
  | "validating"
  | "reconciling"
  | "completed"
  | "failed";

export interface DataSynchronizationTargetState {
  target: DataSyncTarget;
  status: "pending" | "running" | "succeeded" | "failed" | "validated";
  attempts: number;
  idempotencyKey: string;
  lastError?: string;
  externalRecordId?: string;
  lastSyncedAt?: string;
  validationMessage?: string;
  reconciled?: boolean;
  /** Optional signed webhook notification (billing target only); skipped when not bound. */
  webhook?: {
    status: "delivered" | "skipped";
    reason?: string;
    deliveryId?: string | null;
    duplicate?: boolean;
    replayed?: boolean;
  };
}

export interface DataSynchronizationState {
  sourceRecordId: string;
  eventId: string;
  sourceSystem: string;
  status: DataSynchronizationStatus;
  currentStep: string;
  changedFields: string[];
  requiredTargets: DataSyncTarget[];
  sourceRecord?: Record<string, unknown>;
  canonicalCustomer?: Record<string, unknown>;
  targets: Record<DataSyncTarget, DataSynchronizationTargetState>;
  validation?: {
    valid: boolean;
    checkedTargets: DataSyncTarget[];
    mismatchedTargets: DataSyncTarget[];
    messages: Record<string, string>;
  };
  completedSteps: string[];
  lastError?: string;
}

export const createDataSyncTargetState = (
  target: DataSyncTarget,
  eventId: string,
  sourceRecordId: string
): DataSynchronizationTargetState => ({
  target,
  status: "pending",
  attempts: 0,
  idempotencyKey: `${eventId}:${target}:ext_${sourceRecordId}`,
});

export type EmployeeSystem = "email" | "github" | "saas";

export type EmployeeLifecycleStatus =
  | "hired"
  | "waiting_for_provisioning_window"
  | "creating_identity"
  | "provisioning_access"
  | "waiting_for_manager_checklist"
  | "waiting_for_post_start_review"
  | "verifying_access"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export interface EmployeeLifecycleWorkflowInput {
  employeeId: string;
  name: string;
  manager: string;
  managerEmail?: string;
  department: string;
  startDate: string;
  requestedSystems: EmployeeSystem[];
  accessProfile: string;
  provisioningLeadTimeSeconds: number;
  postStartReviewSeconds: number;
  businessKey?: string;
}

export interface EmployeeSystemState {
  system: EmployeeSystem;
  status: "pending" | "running" | "provisioned" | "failed" | "deprovisioned" | "verified";
  externalAccountId?: string;
  attempts: number;
  idempotencyKey: string;
  lastError?: string;
}

export interface EmployeeLifecycleState {
  employeeId: string;
  name: string;
  manager: string;
  department: string;
  accessProfile: string;
  startDate: string;
  status: EmployeeLifecycleStatus;
  currentStep: string;
  requestedSystems: EmployeeSystem[];
  systems: Record<EmployeeSystem, EmployeeSystemState>;
  identityState: "pending" | "running" | "created" | "deprovisioned" | "failed";
  identityId?: string;
  managerChecklistStatus: "pending" | "waiting" | "completed";
  managerChecklistCompletedBy?: string;
  managerChecklistNotes?: string;
  managerChecklistTaskId?: string;
  nextScheduledAction?: {
    label: string;
    at: string;
  };
  timeline: Array<{
    timestamp: string;
    status: EmployeeLifecycleStatus;
    message: string;
  }>;
  failedSystems: EmployeeSystem[];
  lastError?: string;
}

export const allEmployeeSystems: EmployeeSystem[] = ["email", "github", "saas"];

export const createEmployeeSystemState = (system: EmployeeSystem, employeeId: string): EmployeeSystemState => ({
  system,
  status: "pending",
  attempts: 0,
  idempotencyKey: `${employeeId}:${system}`,
});

export type EngagementPhase =
  | "discovery"
  | "solution_design"
  | "implementation"
  | "uat"
  | "go_live"
  | "post_launch_review";

export type ImplementationWorkstream = "data" | "application" | "integrations";

export type ClientEngagementStatus = "started" | "running" | "waiting_for_approval" | "blocked" | "completed" | "cancelled" | "failed";

export type EngagementPhaseStatus = "pending" | "running" | "waiting_for_approval" | "approved" | "rejected" | "completed" | "blocked" | "failed" | "cancelled";

export type EngagementWorkstreamStatus = "pending" | "running" | "completed" | "failed";

export interface ClientEngagementWorkflowInput {
  engagementId: string;
  clientName: string;
  sponsorEmail: string;
  projectManager: string;
  targetGoLiveDate: string;
  scopeSummary: string;
  workstreams: ImplementationWorkstream[];
  phaseDelaySeconds: number;
  postLaunchReviewSeconds: number;
  businessKey?: string;
}

export interface EngagementPhaseState {
  phase: EngagementPhase;
  status: EngagementPhaseStatus;
  startedAt?: string;
  completedAt?: string;
  milestonesCompleted: string[];
  approvalTaskId?: string;
}

export interface EngagementWorkstreamState {
  workstream: ImplementationWorkstream;
  status: EngagementWorkstreamStatus;
  childWorkflowId?: string;
  completedMilestones: string[];
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface ClientEngagementState {
  engagementId: string;
  clientName: string;
  sponsorEmail: string;
  projectManager: string;
  targetGoLiveDate: string;
  scopeSummary: string;
  status: ClientEngagementStatus;
  currentPhase: EngagementPhase;
  currentStep: string;
  completedPhases: EngagementPhase[];
  phases: Record<EngagementPhase, EngagementPhaseState>;
  implementationWorkstreams: Record<ImplementationWorkstream, EngagementWorkstreamState>;
  blockers: Array<{
    phase: EngagementPhase;
    reason: string;
    raisedAt: string;
    raisedBy?: string;
  }>;
  clientApproval?: {
    phase: EngagementPhase;
    decision: "approved" | "rejected";
    comment?: string;
    submittedBy?: string;
    submittedAt: string;
  };
  milestones: string[];
  activeChildWorkflows: string[];
  timeline: Array<{
    timestamp: string;
    status: ClientEngagementStatus;
    message: string;
  }>;
  lastError?: string;
}

export interface ClientEngagementChildInput {
  parentWorkflowId: string;
  orgId: string;
  workflowDefinitionKey: string;
  engagementId: string;
  clientName: string;
  workstream: ImplementationWorkstream;
}

export interface ClientEngagementWorkstreamResult {
  workstream: ImplementationWorkstream;
  childWorkflowId: string;
  completedMilestones: string[];
  completedAt: string;
}

export const engagementPhases: EngagementPhase[] = [
  "discovery",
  "solution_design",
  "implementation",
  "uat",
  "go_live",
  "post_launch_review",
];

export const allImplementationWorkstreams: ImplementationWorkstream[] = ["data", "application", "integrations"];

export const engagementPhaseMilestones: Record<EngagementPhase, string[]> = {
  discovery: ["stakeholders mapped", "current state documented"],
  solution_design: ["future state approved", "integration plan drafted"],
  implementation: ["workstreams delivered"],
  uat: ["test plan executed", "defects triaged"],
  go_live: ["production launch completed"],
  post_launch_review: ["success metrics reviewed", "handoff completed"],
};

export const createEngagementPhaseState = (phase: EngagementPhase): EngagementPhaseState => ({
  phase,
  status: "pending",
  milestonesCompleted: [],
});

export const createEngagementWorkstreamState = (
  workstream: ImplementationWorkstream,
  engagementId: string
): EngagementWorkstreamState => ({
  workstream,
  status: "pending",
  childWorkflowId: `${engagementId}.workstream.${workstream}`,
  completedMilestones: [],
});

export type AiDocumentType = "invoice" | "contract" | "rfp" | "support_case" | "unknown";

export type AiDocumentStage =
  | "uploaded"
  | "parsing"
  | "classifying"
  | "extracting"
  | "enriching"
  | "validating"
  | "waiting_for_human_review"
  | "storing"
  | "completed"
  | "rejected"
  | "failed";

export interface AiDocumentProcessingWorkflowInput {
  documentId: string;
  documentTypeHint?: AiDocumentType;
  documentRef: string;
  confidenceThreshold: number;
  reviewScenario: "auto_accept" | "low_confidence" | "validation_error";
  businessKey?: string;
}

export interface AiExtractedDataSummary {
  documentNumber?: string;
  companyName?: string;
  effectiveDate?: string;
  dueDate?: string;
  amount?: number;
  currency?: string;
  obligations?: string[];
  requestedServices?: string[];
  issueSummary?: string;
}

export interface AiDocumentProcessingState {
  documentId: string;
  documentTypeHint?: AiDocumentType;
  documentRef: string;
  stage: AiDocumentStage;
  classification?: AiDocumentType;
  extractedDataSummary?: AiExtractedDataSummary;
  enrichment?: {
    companyLookup?: {
      companyName: string;
      industry: string;
      accountTier: string;
    };
    riskAnalysis?: {
      riskLevel: "low" | "medium" | "high";
      reasons: string[];
    };
    summary?: string;
    dataValidation?: {
      valid: boolean;
      warnings: string[];
    };
  };
  validation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  confidenceScore?: number;
  confidenceThreshold: number;
  humanReviewStatus: "not_required" | "pending" | "approved" | "corrected" | "rejected";
  reviewer?: string;
  reviewNotes?: string;
  reviewTaskId?: string;
  storedResultId?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

export const defaultAiDocumentSummary = (
  documentId: string,
  classification: AiDocumentType
): AiExtractedDataSummary => {
  if (classification === "support_case") {
    return {
      documentNumber: `CASE-DOC-${documentId}`,
      companyName: "Northstar Manufacturing Group",
      issueSummary: "Recurring billing synchronization failures with delayed invoices.",
      requestedServices: ["billing reconciliation", "support escalation"],
    };
  }
  if (classification === "contract") {
    return {
      documentNumber: `MSA-${documentId}`,
      companyName: "Northstar Manufacturing Group",
      effectiveDate: "2026-08-14",
      obligations: ["mutual confidentiality", "standard support terms"],
      currency: "USD",
    };
  }
  return {
    documentNumber: `INV-${documentId}`,
    companyName: "Northstar Manufacturing Group",
    dueDate: "2026-09-15",
    amount: 42000,
    currency: "USD",
    obligations: ["pay invoice by due date"],
  };
};

export const correctedAiDocumentSummary = (
  payload: Record<string, unknown> | undefined,
  fallback: AiExtractedDataSummary
): AiExtractedDataSummary => ({
  documentNumber: typeof payload?.documentNumber === "string" && payload.documentNumber ? payload.documentNumber : fallback.documentNumber,
  companyName: typeof payload?.companyName === "string" && payload.companyName ? payload.companyName : fallback.companyName,
  effectiveDate: typeof payload?.effectiveDate === "string" && payload.effectiveDate ? payload.effectiveDate : fallback.effectiveDate,
  dueDate: typeof payload?.dueDate === "string" && payload.dueDate ? payload.dueDate : fallback.dueDate,
  amount: typeof payload?.amount === "number" ? payload.amount : fallback.amount,
  currency: typeof payload?.currency === "string" && payload.currency ? payload.currency : fallback.currency,
  obligations: Array.isArray(payload?.obligations) ? payload.obligations.map(String) : fallback.obligations,
  requestedServices: Array.isArray(payload?.requestedServices) ? payload.requestedServices.map(String) : fallback.requestedServices,
  issueSummary: typeof payload?.issueSummary === "string" && payload.issueSummary ? payload.issueSummary : fallback.issueSummary,
});

export type AiSupportAgentStage =
  | "received"
  | "understanding"
  | "retrieving_context"
  | "deciding"
  | "waiting_for_approval"
  | "executing_tools"
  | "validating_result"
  | "responding"
  | "completed"
  | "rejected"
  | "failed";

export type AiSupportAgentToolName = "lookupCustomer" | "lookupInvoice" | "issueCredit" | "updateCase" | "sendCustomerResponse";

export type AiSupportAgentAction = "issue_credit" | "update_case" | "send_instructions" | "escalate";

export interface AiSupportAgentWorkflowInput {
  caseId: string;
  customerId: string;
  customerMessageSummary: string;
  planTier: string;
  accountStatus: string;
  recentInvoiceId: string;
  duplicateChargeSuspected: boolean;
  approvalThresholdAmount: number;
  demoScenario: "credit_requires_approval" | "send_instructions";
  accountContext: {
    planTier: string;
    accountStatus: string;
    recentInvoiceId: string;
    duplicateChargeSuspected: boolean;
  };
  businessKey?: string;
}

export interface AiSupportAgentProposal {
  intent: "billing_adjustment" | "technical_support" | "account_update" | "unknown";
  proposedAction: AiSupportAgentAction;
  amount?: number;
  requiresApproval: boolean;
  reason: string;
  rationaleSummary: string;
}

export interface AiSupportAgentToolCall {
  toolName: AiSupportAgentToolName;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  idempotencyKey: string;
  startedAt?: string;
  completedAt?: string;
  resultSummary?: string;
  lastError?: string;
}

export interface AiSupportAgentState {
  caseId: string;
  customerId: string;
  customerMessageSummary: string;
  accountContext: AiSupportAgentWorkflowInput["accountContext"];
  stage: AiSupportAgentStage;
  proposal?: AiSupportAgentProposal;
  pendingApproval: boolean;
  approvalStatus: "not_required" | "pending" | "approved" | "modified" | "rejected";
  approver?: string;
  approvalNotes?: string;
  toolCalls: AiSupportAgentToolCall[];
  customerContext?: {
    customerName: string;
    planTier: string;
    accountStatus: string;
  };
  invoiceContext?: {
    invoiceId: string;
    amount: number;
    duplicateCharge: boolean;
  };
  validation?: {
    valid: boolean;
    message: string;
  };
  finalResponseSummary?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

export type ComplianceControlClassification = "automated" | "manual";

export type ComplianceReviewStatus =
  | "scheduled"
  | "collecting_evidence"
  | "running_checks"
  | "waiting_for_evidence"
  | "overdue"
  | "escalated"
  | "generating_report"
  | "completed"
  | "failed";

export type ComplianceControlStatus =
  | "pending"
  | "collecting"
  | "checking"
  | "waiting_for_evidence"
  | "evidence_submitted"
  | "accepted"
  | "rejected"
  | "waived"
  | "overdue"
  | "escalated"
  | "passed"
  | "failed";

export interface ComplianceControlInput {
  controlId: string;
  title: string;
  owner: string;
  evidenceRequired: string;
  classification: ComplianceControlClassification;
}

export interface ComplianceReviewWorkflowInput {
  reviewId: string;
  reviewPeriod: string;
  controls: ComplianceControlInput[];
  evidenceDeadlineSeconds: number;
  escalationIntervalSeconds: number;
  scheduleNote?: string;
  businessKey?: string;
}

export interface ComplianceEvidenceRecord {
  submittedBy: string;
  submittedAt: string;
  reference: string;
  notes?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  rejectionReason?: string;
}

export interface ComplianceFinding {
  controlId: string;
  severity: "info" | "low" | "medium" | "high";
  message: string;
}

export interface ComplianceControlState extends ComplianceControlInput {
  status: ComplianceControlStatus;
  findings: ComplianceFinding[];
  evidence?: ComplianceEvidenceRecord;
  requestedAt?: string;
  remindedAt?: string;
  overdueAt?: string;
  escalatedAt?: string;
  waivedBy?: string;
  waiverReason?: string;
  completedAt?: string;
  lastError?: string;
}

export interface ComplianceReviewState {
  reviewId: string;
  reviewPeriod: string;
  status: ComplianceReviewStatus;
  currentStep: string;
  evidenceDeadlineSeconds: number;
  escalationIntervalSeconds: number;
  controls: Record<string, ComplianceControlState>;
  statusBreakdown: Partial<Record<ComplianceControlStatus, number>>;
  missingEvidence: string[];
  overdueControls: string[];
  findings: ComplianceFinding[];
  completionPercentage: number;
  report?: {
    reportId: string;
    generatedAt: string;
    summary: string;
  };
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

export const complianceTerminal = (status: ComplianceControlStatus) =>
  ["accepted", "waived", "passed", "failed"].includes(status);

export type UnderwritingApplicationType = "business_loan" | "vendor_risk" | "account_opening" | "eligibility";

export type UnderwritingCheckType = "identity" | "financial" | "fraud";

export type UnderwritingStatus =
  | "received"
  | "gathering_data"
  | "running_checks"
  | "evaluating_risk"
  | "waiting_for_information"
  | "waiting_for_analyst"
  | "approved"
  | "rejected"
  | "cancelled"
  | "failed";

export type UnderwritingCheckStatus = "pending" | "running" | "passed" | "failed" | "insufficient_information" | "cancelled";

export interface UnderwritingCapstoneWorkflowInput {
  applicationId: string;
  applicantName: string;
  applicationType: UnderwritingApplicationType;
  submittedData: Record<string, unknown>;
  decisionPolicy: {
    autoApproveMaxRiskScore: number;
    manualReviewMinRiskScore: number;
    autoRejectMinRiskScore: number;
    requireAnalystForMissingInformation: boolean;
  };
  demoTiming: {
    informationReminderSeconds: number;
  };
  demoScenario: "auto_approve" | "manual_review" | "missing_information" | "auto_reject";
  businessKey?: string;
}

export interface UnderwritingRiskFinding {
  checkType: UnderwritingCheckType;
  severity: "info" | "low" | "medium" | "high";
  message: string;
}

export interface UnderwritingCheckResult {
  checkType: UnderwritingCheckType;
  status: UnderwritingCheckStatus;
  riskScore: number;
  findings: UnderwritingRiskFinding[];
  missingFields: string[];
  affectedByFields: string[];
  checkedAt: string;
  summary: string;
}

export interface UnderwritingCheckState extends UnderwritingCheckResult {
  childWorkflowId: string;
  attempts: number;
  lastError?: string;
}

export interface UnderwritingDecisionRecord {
  timestamp: string;
  decision: "approved" | "rejected" | "manual_review_required" | "information_requested" | "cancelled";
  actor: "system" | "analyst" | "applicant";
  reason: string;
  riskScore?: number;
}

export interface UnderwritingCapstoneState {
  applicationId: string;
  applicantName: string;
  applicationType: UnderwritingApplicationType;
  status: UnderwritingStatus;
  currentStage: string;
  submittedData: Record<string, unknown>;
  checkResults: Record<UnderwritingCheckType, UnderwritingCheckState>;
  missingInformation: string[];
  riskFindings: UnderwritingRiskFinding[];
  analystReviewStatus: "not_required" | "pending" | "approved" | "rejected" | "requested_information";
  decisionHistory: UnderwritingDecisionRecord[];
  nextAction: string;
  childWorkflowIds: string[];
  parentWorkflowId: string;
  finalDecision?: "approved" | "rejected";
  riskScore?: number;
  riskSummary?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

export interface UnderwritingRiskCheckChildInput {
  orgId: string;
  workflowDefinitionKey: string;
  parentWorkflowId: string;
  applicationId: string;
  checkType: UnderwritingCheckType;
  data: Record<string, unknown>;
  demoScenario: UnderwritingCapstoneWorkflowInput["demoScenario"];
  attempt: number;
}

export const underwritingCheckTypes: UnderwritingCheckType[] = ["identity", "financial", "fraud"];

export const createUnderwritingCheckState = (
  applicationId: string,
  checkType: UnderwritingCheckType
): UnderwritingCheckState => ({
  checkType,
  status: "pending",
  riskScore: 0,
  findings: [],
  missingFields: [],
  affectedByFields: [],
  checkedAt: "",
  summary: "",
  childWorkflowId: `underwriting.${applicationId}.check.${checkType}`,
  attempts: 0,
});
export const openHumanTasks=new Map<string,{actionKey:string}>();
export const humanTasks={
 async createHumanTask(input: Parameters<HumanTaskActivities['createHumanTask']>[0]) {
  const task=await humanTaskActivities.createHumanTask(input);openHumanTasks.set(task.taskId,{actionKey:input.actionKey});return task;
 },
 async closeHumanTask(input: Parameters<HumanTaskActivities['closeHumanTask']>[0]) {
  await humanTaskActivities.closeHumanTask(input);openHumanTasks.delete(input.taskId);
 }
};
