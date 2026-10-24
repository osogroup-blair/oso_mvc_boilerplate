import { describe, it, expect } from "vitest";
import {
  getWorkflowRegistration,
  validateWorkflowRegistry,
  workflowRegistrations,
  type WorkflowTypeRegistration,
} from "../../src/temporal/workflow-registry.js";
import { emptyForm } from "../../src/temporal/forms.js";

function registration(overrides: Partial<WorkflowTypeRegistration> = {}): WorkflowTypeRegistration {
  return {
    key: "workflow.one",
    slug: "workflow-one",
    workflowType: "workflowOne",
    taskQueue: "oso-workflows",
    contractVersion: 1,
    name: "Workflow One",
    startForm: emptyForm,
    validateStart: (input) => input,
    actions: {},
    integrationRequirements: [],
    summarizeState: () => ({}),
    ...overrides,
  };
}

function action() {
  return {
    key: "complete",
    label: "Complete",
    signalName: "workflowAction",
    inputForm: emptyForm,
    validateInput: (input: unknown) => input as Record<string, unknown>,
  };
}

describe("workflow registry", () => {
  it("accepts unique workflow registrations", () => {
    const rows = [
      registration(),
      registration({ key: "workflow.two", slug: "workflow-two", workflowType: "workflowTwo" }),
    ];

    expect(validateWorkflowRegistry(rows)).toEqual(rows);
  });

  it("rejects duplicate keys", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration(),
        registration({ slug: "workflow-two", workflowType: "workflowTwo" }),
      ])
    ).toThrow("Duplicate workflow registration key");
  });

  it("rejects duplicate slugs", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration(),
        registration({ key: "workflow.two", workflowType: "workflowTwo" }),
      ])
    ).toThrow("Duplicate workflow registration slug");
  });

  it("rejects duplicate workflow types", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration(),
        registration({ key: "workflow.two", slug: "workflow-two" }),
      ])
    ).toThrow("Duplicate workflow type");
  });

  it("rejects duplicate integration requirements inside one registration", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration({
          integrationRequirements: [
            { key: "crm", providerKey: "hubspot", label: "CRM" },
            { key: "crm", providerKey: "salesforce", label: "CRM" },
          ],
        }),
      ])
    ).toThrow("Duplicate integration requirement");
  });

  it("rejects requirements for unregistered providers or undeclared capabilities", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration({ integrationRequirements: [{ key: "crm", providerKey: "hubspot" as never, label: "CRM" }] }),
      ])
    ).toThrow('Unknown integration provider "hubspot"');
    expect(() =>
      validateWorkflowRegistry([
        registration({ integrationRequirements: [{ key: "echo", providerKey: "synthetic.echo", capabilityKey: "payment", label: "Echo" }] }),
      ])
    ).toThrow('does not declare capability "payment"');
  });

  it("rejects duplicate action signal names inside one registration", () => {
    expect(() =>
      validateWorkflowRegistry([
        registration({
          actions: {
            complete: action(),
            approve: { ...action(), key: "approve" },
          },
        }),
      ])
    ).toThrow("Duplicate action signal");
  });

  it("registers migrated Phase 6A showcase workflows with generic actions and integration requirements", () => {
    expect(validateWorkflowRegistry(workflowRegistrations)).toBe(workflowRegistrations);

    const onboarding = getWorkflowRegistration("showcase.customerOnboarding");
    const approval = getWorkflowRegistration("showcase.humanApproval");

    expect(onboarding).toMatchObject({
      slug: "showcase-customer-onboarding",
      workflowType: "customerOnboardingWorkflow",
      stateQuery: "customerOnboardingState",
    });
    expect(onboarding?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);
    expect(onboarding?.actions.customerDecision.signalName).toBe("customerOnboardingAction");

    expect(approval).toMatchObject({
      slug: "showcase-human-approval",
      workflowType: "humanApprovalWorkflow",
      stateQuery: "humanApprovalState",
    });
    expect(approval?.actions.managerReview.signalName).toBe("humanApprovalReviewAction");
    expect(approval?.actions.resubmit.signalName).toBe("humanApprovalResubmitAction");
  });

  it("registers migrated Phase 6B showcase workflows without bespoke actions", () => {
    const order = getWorkflowRegistration("showcase.orderFulfillmentSaga");
    const sync = getWorkflowRegistration("showcase.dataSynchronization");

    expect(order).toMatchObject({
      slug: "showcase-order-fulfillment-saga",
      workflowType: "orderFulfillmentSagaWorkflow",
      stateQuery: "orderFulfillmentSagaState",
      actions: {},
    });
    expect(order?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);

    expect(sync).toMatchObject({
      slug: "showcase-data-synchronization",
      workflowType: "dataSynchronizationWorkflow",
      stateQuery: "dataSynchronizationState",
      actions: {},
    });
    expect(sync?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
      expect.objectContaining({ key: "billingWebhook", providerKey: "webhook.outbound", capabilityKey: "deliver", isRequired: false }),
    ]);
  });

  it("registers migrated Phase 6C showcase workflows with generic human actions and integration requirements", () => {
    const employee = getWorkflowRegistration("showcase.employeeLifecycle");
    const engagement = getWorkflowRegistration("showcase.clientEngagement");

    expect(employee).toMatchObject({
      slug: "showcase-employee-lifecycle",
      workflowType: "employeeLifecycleWorkflow",
      stateQuery: "employeeLifecycleState",
    });
    expect(employee?.actions.managerChecklist.signalName).toBe("employeeLifecycleChecklistAction");
    expect(employee?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);

    expect(engagement).toMatchObject({
      slug: "showcase-client-engagement",
      workflowType: "clientEngagementWorkflow",
      stateQuery: "clientEngagementState",
    });
    expect(engagement?.actions.clientPhaseApproval.signalName).toBe("clientEngagementApprovalAction");
    expect(engagement?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);
  });

  it("registers migrated Phase 6D showcase workflows with safe AI action surfaces", () => {
    const document = getWorkflowRegistration("showcase.aiDocumentProcessing");
    const support = getWorkflowRegistration("showcase.aiSupportAgent");

    expect(document).toMatchObject({
      slug: "showcase-ai-document-processing",
      workflowType: "aiDocumentProcessingWorkflow",
      stateQuery: "aiDocumentProcessingState",
    });
    expect(document?.actions.documentReview.signalName).toBe("aiDocumentReviewAction");
    expect(document?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);

    expect(support).toMatchObject({
      slug: "showcase-ai-support-agent",
      workflowType: "aiSupportAgentWorkflow",
      stateQuery: "aiSupportAgentState",
    });
    expect(support?.actions.agentApproval.signalName).toBe("aiSupportAgentApprovalAction");
    expect(support?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);
  });

  it("registers migrated Phase 6E schedule and complex case workflows", () => {
    const compliance = getWorkflowRegistration("showcase.complianceReview");
    const underwriting = getWorkflowRegistration("showcase.underwritingCapstone");

    expect(compliance).toMatchObject({
      slug: "showcase-compliance-review",
      workflowType: "complianceReviewWorkflow",
      stateQuery: "complianceReviewState",
    });
    expect(compliance?.actions.complianceControlAction.signalName).toBe("complianceReviewControlAction");
    expect(compliance?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);

    expect(underwriting).toMatchObject({
      slug: "showcase-underwriting-capstone",
      workflowType: "underwritingCapstoneWorkflow",
      stateQuery: "underwritingCapstoneState",
    });
    expect(underwriting?.actions.underwritingAction.signalName).toBe("underwritingCapstoneAction");
    expect(underwriting?.integrationRequirements).toEqual([
      expect.objectContaining({ key: "syntheticEcho", providerKey: "synthetic.echo", isRequired: true }),
    ]);
  });

  it("parses Customer Onboarding start input from generic form fields", () => {
    const registration = getWorkflowRegistration("showcase.customerOnboarding");

    const parsed = registration?.validateStart({
      customerId: "cust-001",
      companyName: "Acme Manufacturing",
      primaryContactName: "Jordan Lee",
      primaryContactEmail: "jordan@example.com",
      requestedUsers: "one@example.com\ntwo@example.com",
      requestedIntegrations: "CRM, Billing",
      planTier: "enterprise",
    });

    expect(parsed).toMatchObject({
      customerId: "cust-001",
      companyName: "Acme Manufacturing",
      primaryContact: { name: "Jordan Lee", email: "jordan@example.com" },
      requestedUsers: ["one@example.com", "two@example.com"],
      requestedIntegrations: ["CRM", "Billing"],
      planTier: "enterprise",
      businessKey: "cust-001",
    });
  });

  it("validates Human Approval manager and resubmission actions", () => {
    const registration = getWorkflowRegistration("showcase.humanApproval");

    expect(registration?.actions.managerReview.validateInput({
      decision: "changes_requested",
      comment: "Please lower the amount.",
    })).toEqual({
      decision: "changes_requested",
      comment: "Please lower the amount.",
    });

    expect(registration?.actions.resubmit.validateInput({
      newAmount: "900",
      newDescription: "Reduced purchase request",
    })).toEqual({
      decision: "resubmit",
      newAmount: 900,
      newDescription: "Reduced purchase request",
      comment: undefined,
    });
  });

  it("parses Order Fulfillment Saga start input from generic textarea rows", () => {
    const registration = getWorkflowRegistration("showcase.orderFulfillmentSaga");

    const parsed = registration?.validateStart({
      orderId: "ord-001",
      customerId: "cust-001",
      items: "sku-a,2,199\nsku-b,1,499",
      paymentTokenRef: "tok_ref_only",
      shippingAddress: "123 Innovation Way",
      email: "buyer@example.com",
      fulfillmentScenario: "shipment_rejected",
    });

    expect(parsed).toMatchObject({
      orderId: "ord-001",
      customerId: "cust-001",
      items: [
        { id: "sku-a", quantity: 2, price: 199 },
        { id: "sku-b", quantity: 1, price: 499 },
      ],
      paymentTokenRef: "tok_ref_only",
      fulfillmentScenario: "shipment_rejected",
      businessKey: "ord-001",
    });
  });

  it("parses Data Synchronization start input and defaults targets to all systems", () => {
    const registration = getWorkflowRegistration("showcase.dataSynchronization");

    const parsed = registration?.validateStart({
      sourceRecordId: "src-001",
      eventId: "evt-001",
      sourceSystem: "customer-directory",
      changedFields: "primaryContact,status",
      targetSystems: "",
      validationScenario: "reconcile_first_target",
    });

    expect(parsed).toMatchObject({
      sourceRecordId: "src-001",
      eventId: "evt-001",
      sourceSystem: "customer-directory",
      changedFields: ["primaryContact", "status"],
      targetSystems: ["crm", "erp", "billing"],
      validationScenario: "reconcile_first_target",
      businessKey: "evt-001",
    });
  });

  it("parses Employee Lifecycle start input and manager checklist action", () => {
    const registration = getWorkflowRegistration("showcase.employeeLifecycle");

    const parsed = registration?.validateStart({
      employeeId: "emp-001",
      name: "Jordan Lee",
      manager: "Casey Manager",
      managerEmail: "",
      department: "Operations",
      startDate: "2026-08-14T09:00",
      requestedSystems: "email\ngithub",
      accessProfile: "standard-employee",
      provisioningLeadTimeSeconds: "0",
      postStartReviewSeconds: "5",
    });

    expect(parsed).toMatchObject({
      employeeId: "emp-001",
      name: "Jordan Lee",
      manager: "Casey Manager",
      department: "Operations",
      requestedSystems: ["email", "github"],
      accessProfile: "standard-employee",
      provisioningLeadTimeSeconds: 0,
      postStartReviewSeconds: 5,
      businessKey: "emp-001",
    });
    expect((parsed as { managerEmail?: string } | undefined)?.managerEmail).toBeUndefined();

    expect(registration?.actions.managerChecklist.validateInput({
      decision: "complete",
      completedSystems: "email,github",
      notes: "Laptop issued and accounts verified.",
    })).toEqual({
      decision: "complete",
      completedSystems: ["email", "github"],
      notes: "Laptop issued and accounts verified.",
    });
  });

  it("parses Client Engagement start input and phase approval action", () => {
    const registration = getWorkflowRegistration("showcase.clientEngagement");

    const parsed = registration?.validateStart({
      engagementId: "eng-001",
      clientName: "Acme Corp",
      sponsorEmail: "sponsor@example.com",
      projectManager: "Riley PM",
      targetGoLiveDate: "2026-09-01T12:00",
      scopeSummary: "Implement the core workflow platform.",
      workstreams: "data\napplication\nintegrations",
      phaseDelaySeconds: "0",
      postLaunchReviewSeconds: "10",
    });

    expect(parsed).toMatchObject({
      engagementId: "eng-001",
      clientName: "Acme Corp",
      sponsorEmail: "sponsor@example.com",
      projectManager: "Riley PM",
      workstreams: ["data", "application", "integrations"],
      phaseDelaySeconds: 0,
      postLaunchReviewSeconds: 10,
      businessKey: "eng-001",
    });

    expect(registration?.actions.clientPhaseApproval.validateInput({
      decision: "approved",
      comment: "UAT is accepted.",
    })).toEqual({
      decision: "approved",
      comment: "UAT is accepted.",
    });
  });

  it("parses AI Document Processing start input and correction action", () => {
    const registration = getWorkflowRegistration("showcase.aiDocumentProcessing");

    const parsed = registration?.validateStart({
      documentId: "doc-001",
      documentTypeHint: "invoice",
      documentRef: "asset://invoice-demo-001",
      confidenceThreshold: "0.95",
      reviewScenario: "low_confidence",
    });

    expect(parsed).toMatchObject({
      documentId: "doc-001",
      documentTypeHint: "invoice",
      documentRef: "asset://invoice-demo-001",
      confidenceThreshold: 0.95,
      reviewScenario: "low_confidence",
      businessKey: "doc-001",
    });

    expect(registration?.actions.documentReview.validateInput({
      decision: "correct",
      documentNumber: "INV-001",
      companyName: "Acme Corp",
      amount: "199.5",
      currency: "USD",
      obligations: "pay by due date\nretain records",
      requestedServices: "billing reconciliation",
      comment: "Corrected from source system.",
    })).toEqual({
      decision: "correct",
      documentNumber: "INV-001",
      companyName: "Acme Corp",
      effectiveDate: undefined,
      dueDate: undefined,
      amount: 199.5,
      currency: "USD",
      obligations: ["pay by due date", "retain records"],
      requestedServices: ["billing reconciliation"],
      issueSummary: undefined,
      rejectionReason: undefined,
      comment: "Corrected from source system.",
    });
  });

  it("parses AI Support Agent start input and approval action", () => {
    const registration = getWorkflowRegistration("showcase.aiSupportAgent");

    const parsed = registration?.validateStart({
      caseId: "case-001",
      customerId: "cust-001",
      customerMessageSummary: "Customer reports a duplicate invoice charge.",
      planTier: "enterprise",
      accountStatus: "active",
      recentInvoiceId: "inv-1042",
      duplicateChargeSuspected: "true",
      approvalThresholdAmount: "25",
      demoScenario: "credit_requires_approval",
    });

    expect(parsed).toMatchObject({
      caseId: "case-001",
      customerId: "cust-001",
      customerMessageSummary: "Customer reports a duplicate invoice charge.",
      planTier: "enterprise",
      accountStatus: "active",
      recentInvoiceId: "inv-1042",
      duplicateChargeSuspected: true,
      approvalThresholdAmount: 25,
      demoScenario: "credit_requires_approval",
      accountContext: {
        planTier: "enterprise",
        accountStatus: "active",
        recentInvoiceId: "inv-1042",
        duplicateChargeSuspected: true,
      },
      businessKey: "case-001",
    });

    expect(registration?.actions.agentApproval.validateInput({
      decision: "modified",
      replacementAction: "send_instructions",
      reason: "Explain next steps instead of issuing credit.",
      comment: "Modified for policy reasons.",
    })).toEqual({
      decision: "modified",
      replacementAction: "send_instructions",
      amount: undefined,
      reason: "Explain next steps instead of issuing credit.",
      comment: "Modified for policy reasons.",
    });
  });

  it("parses Compliance Review start input and control evidence action", () => {
    const registration = getWorkflowRegistration("showcase.complianceReview");

    const parsed = registration?.validateStart({
      reviewId: "rev-001",
      reviewPeriod: "2026-Q3",
      controls: "CTRL-A|Backup policy|Security|Backup report|automated\nCTRL-M|Access review|IT Owner|Signed evidence|manual",
      evidenceDeadlineSeconds: "0",
      escalationIntervalSeconds: "30",
      scheduleNote: "Run quarterly.",
    });

    expect(parsed).toMatchObject({
      reviewId: "rev-001",
      reviewPeriod: "2026-Q3",
      controls: [
        {
          controlId: "CTRL-A",
          title: "Backup policy",
          owner: "Security",
          evidenceRequired: "Backup report",
          classification: "automated",
        },
        {
          controlId: "CTRL-M",
          title: "Access review",
          owner: "IT Owner",
          evidenceRequired: "Signed evidence",
          classification: "manual",
        },
      ],
      evidenceDeadlineSeconds: 0,
      escalationIntervalSeconds: 30,
      scheduleNote: "Run quarterly.",
      businessKey: "rev-001",
    });

    expect(registration?.actions.complianceControlAction.validateInput({
      decision: "submit_accept",
      controlId: "CTRL-M",
      evidenceReference: "asset://access-review.pdf",
      submittedBy: "owner@example.com",
      notes: "Evidence attached.",
    })).toEqual({
      decision: "submit_accept",
      controlId: "CTRL-M",
      evidenceReference: "asset://access-review.pdf",
      submittedBy: "owner@example.com",
      notes: "Evidence attached.",
      reason: undefined,
      comment: undefined,
    });
  });

  it("parses Underwriting Capstone start input and case actions", () => {
    const registration = getWorkflowRegistration("showcase.underwritingCapstone");

    const parsed = registration?.validateStart({
      applicationId: "uw-001",
      applicantName: "Acme Capital",
      applicationType: "business_loan",
      submittedData: "identityDocument=synthetic-passport\nbusinessRegistration=verified\nrequestedAmount=75000",
      autoApproveMaxRiskScore: "35",
      manualReviewMinRiskScore: "36",
      autoRejectMinRiskScore: "80",
      requireAnalystForMissingInformation: "true",
      informationReminderSeconds: "5",
      demoScenario: "missing_information",
    });

    expect(parsed).toMatchObject({
      applicationId: "uw-001",
      applicantName: "Acme Capital",
      applicationType: "business_loan",
      submittedData: {
        identityDocument: "synthetic-passport",
        businessRegistration: "verified",
        requestedAmount: 75000,
      },
      decisionPolicy: {
        autoApproveMaxRiskScore: 35,
        manualReviewMinRiskScore: 36,
        autoRejectMinRiskScore: 80,
        requireAnalystForMissingInformation: true,
      },
      demoTiming: { informationReminderSeconds: 5 },
      demoScenario: "missing_information",
      businessKey: "uw-001",
    });

    expect(registration?.actions.underwritingAction.validateInput({
      decision: "submit_information",
      submittedFields: "bankStatements=asset://bank-statements.pdf\nfinancialRisk=medium",
      submittedBy: "applicant@example.com",
      notes: "Uploaded requested package.",
    })).toEqual({
      decision: "submit_information",
      reason: undefined,
      requestedFields: undefined,
      submittedFields: {
        bankStatements: "asset://bank-statements.pdf",
        financialRisk: "medium",
      },
      submissionId: undefined,
      submittedBy: "applicant@example.com",
      notes: "Uploaded requested package.",
    });

    expect(registration?.actions.underwritingAction.validateInput({
      decision: "request_information",
      requestedFields: "taxReturns\nownershipChart",
      reason: "Need ownership verification.",
    })).toMatchObject({
      decision: "request_information",
      requestedFields: ["taxReturns", "ownershipChart"],
      reason: "Need ownership verification.",
    });
  });
});
