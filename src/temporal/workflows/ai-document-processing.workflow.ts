import { condition, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { aiDocumentProcessingStateQuery, aiDocumentReviewActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type AiDocumentProcessingWorkflowInput, type AiDocumentProcessingState, defaultAiDocumentSummary, correctedAiDocumentSummary } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function aiDocumentProcessingWorkflow(
  input: AiDocumentProcessingWorkflowInput,
  context: PlatformWorkflowContext
): Promise<AiDocumentProcessingState> {
 return runVersionedWorkflow(context, async()=>{
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  let reviewAction: WorkflowHumanActionInput | undefined;
  const state: AiDocumentProcessingState = {
    documentId: input.documentId,
    documentTypeHint: input.documentTypeHint,
    documentRef: input.documentRef,
    stage: "uploaded",
    confidenceThreshold: input.confidenceThreshold,
    humanReviewStatus: "not_required",
    completedSteps: [],
    timeline: [],
  };
  const timestamp = () => new Date().toISOString();
  const remember = (message: string) => {
    state.timeline.push({ timestamp: timestamp(), message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.documentId ?? "document")}`,
      payload,
    });

  setHandler(aiDocumentProcessingStateQuery, () => state);
  setHumanActionHandler(aiDocumentReviewActionSignal, (submitted) => {
    if (!reviewAction && state.stage === "waiting_for_human_review" && state.humanReviewStatus === "pending") {
      reviewAction = submitted; return true;
    }
   return false; });

  try {
    remember(`Document reference ${input.documentId} submitted`);

    state.stage = "parsing";
    await runStep("aiDocument.parseReference", {
      documentId: input.documentId,
      documentRef: input.documentRef,
    });
    state.completedSteps.push("Parse Document Reference");

    state.stage = "classifying";
    await runStep("aiDocument.classify", {
      documentId: input.documentId,
      documentTypeHint: input.documentTypeHint ?? "unknown",
      reviewScenario: input.reviewScenario,
    });
    state.classification = input.documentTypeHint && input.documentTypeHint !== "unknown" ? input.documentTypeHint : "invoice";
    const classificationConfidence = input.reviewScenario === "low_confidence" ? 0.72 : 0.94;
    state.completedSteps.push("Classify Document");

    state.stage = "extracting";
    await runStep("aiDocument.extractStructuredData", {
      documentId: input.documentId,
      classification: state.classification,
    });
    const extractionConfidence = input.reviewScenario === "validation_error" ? 0.88 : 0.92;
    state.confidenceScore = Math.min(classificationConfidence, extractionConfidence);
    state.extractedDataSummary = defaultAiDocumentSummary(input.documentId, state.classification);
    state.completedSteps.push("AI Structured Extraction");

    state.stage = "enriching";
    await Promise.all([
      runStep("aiDocument.lookupCompany", {
        documentId: input.documentId,
        companyName: state.extractedDataSummary.companyName ?? "unknown",
      }),
      runStep("aiDocument.analyzeRisk", {
        documentId: input.documentId,
        classification: state.classification,
        amount: state.extractedDataSummary.amount ?? null,
      }),
      runStep("aiDocument.generateSummary", {
        documentId: input.documentId,
        classification: state.classification,
      }),
      runStep("aiDocument.validateExtractedData", {
        documentId: input.documentId,
        classification: state.classification,
      }),
    ]);
    state.enrichment = {
      companyLookup: {
        companyName: state.extractedDataSummary.companyName ?? "Unknown Company",
        industry: "Manufacturing",
        accountTier: "enterprise",
      },
      riskAnalysis: {
        riskLevel: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000 ? "medium" : "low",
        reasons: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000
          ? ["High-value document requires confidence-aware review"]
          : ["No high-risk terms detected in structured summary"],
      },
      summary: `${state.classification} ${state.extractedDataSummary.documentNumber ?? input.documentId} for ${state.extractedDataSummary.companyName ?? "unknown company"}`,
      dataValidation: {
        valid: true,
        warnings: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000
          ? ["High-value amount should be reviewed when confidence is low"]
          : [],
      },
    };
    state.completedSteps.push("Parallel Enrichment");

    state.stage = "validating";
    await runStep("aiDocument.validateExtraction", {
      documentId: input.documentId,
      classification: state.classification,
      reviewScenario: input.reviewScenario,
    });
    state.validation = input.reviewScenario === "validation_error"
      ? { valid: false, errors: ["Due date is missing or inconsistent"], warnings: ["Human correction required"] }
      : { valid: true, errors: [], warnings: state.enrichment.dataValidation?.warnings ?? [] };
    state.completedSteps.push("Validate Structured Output");

    const needsReview = !state.validation.valid || (state.confidenceScore ?? 0) < input.confidenceThreshold;
    if (needsReview) {
      state.stage = "waiting_for_human_review";
      state.humanReviewStatus = "pending";
      remember(!state.validation.valid
        ? `Validation failed: ${state.validation.errors.join(", ")}`
        : `Confidence ${(state.confidenceScore ?? 0).toFixed(2)} below threshold ${input.confidenceThreshold.toFixed(2)}`);
      const reviewTask = await humanTasks.createHumanTask({
        orgId: context.orgId,
        workflowId: info.workflowId,
        runId: info.runId,
        taskKey: "document-review",
        taskType: "ai_document_review",
        title: `Review AI extraction for ${input.documentId}`,
        description: "Review the structured extraction summary. Raw document content and prompts are intentionally not included.",
        roleRequirements: [{ roleName: "ADMIN" }],
        actionKey: "documentReview",
        actionForm: { fields: [] },
        context: {
          workflowDefinitionKey: context.workflowDefinitionKey,
          documentId: input.documentId,
          documentRef: input.documentRef,
          classification: state.classification,
          validation: state.validation,
        },
        tokenTtlHours: 72,
      });
      state.reviewTaskId = reviewTask.taskId;
      await condition(() => reviewAction !== undefined);

      state.reviewer = reviewAction?.submittedBy;
      state.reviewNotes = reviewAction?.comment ?? (typeof reviewAction?.payload?.comment === "string" ? reviewAction.payload.comment : undefined);
      if (reviewAction?.decision === "reject") {
        state.humanReviewStatus = "rejected";
        state.stage = "rejected";
        state.lastError = typeof reviewAction.payload?.rejectionReason === "string"
          ? reviewAction.payload.rejectionReason
          : reviewAction.comment ?? "Document rejected by reviewer";
        await humanTasks.closeHumanTask({
          taskId: reviewTask.taskId,
          result: {
            decision: "reject",
            reason: state.lastError,
            submittedBy: reviewAction.submittedBy ?? null,
            channel: reviewAction.channel,
          },
        });
        return state;
      }

      if (reviewAction?.decision === "correct") {
        state.extractedDataSummary = correctedAiDocumentSummary(reviewAction.payload, state.extractedDataSummary ?? {});
        state.humanReviewStatus = "corrected";
        state.validation = { valid: true, errors: [], warnings: ["Human correction applied"] };
        state.confidenceScore = Math.max(state.confidenceScore ?? 0, input.confidenceThreshold);
        state.completedSteps.push("Human Correction Applied");
      } else {
        state.humanReviewStatus = "approved";
      }

      await humanTasks.closeHumanTask({
        taskId: reviewTask.taskId,
        result: {
          decision: reviewAction?.decision ?? "approve",
          comment: state.reviewNotes ?? null,
          submittedBy: reviewAction?.submittedBy ?? null,
          channel: reviewAction?.channel ?? "AUTHENTICATED",
        },
      });
    }

    state.stage = "storing";
    await runStep("aiDocument.storeResult", {
      documentId: input.documentId,
      classification: state.classification,
      humanReviewed: state.humanReviewStatus !== "not_required",
    });
    state.storedResultId = `stored_${input.documentId}`;
    state.completedSteps.push("Store Result");
    state.stage = "completed";
    remember(`Stored AI document result ${state.storedResultId}`);
    return state;
  } catch (err) {
    state.stage = "failed";
    state.lastError = err instanceof Error ? err.message : "AI document processing failed";
    remember(state.lastError);
    return state;
  }

 });
}
