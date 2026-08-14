-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT,
    "businessKey" TEXT,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "inputSummary" JSONB NOT NULL DEFAULT '{}',
    "stateSummary" JSONB NOT NULL DEFAULT '{}',
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExecution_workflowId_key" ON "WorkflowExecution"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_orgId_status_idx" ON "WorkflowExecution"("orgId", "status");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowDefinitionId_idx" ON "WorkflowExecution"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_startedById_idx" ON "WorkflowExecution"("startedById");

-- CreateIndex
CREATE INDEX "WorkflowExecution_startedAt_idx" ON "WorkflowExecution"("startedAt");

-- CreateIndex
CREATE INDEX "WorkflowExecution_businessKey_idx" ON "WorkflowExecution"("businessKey");

-- CreateIndex
CREATE INDEX "WorkflowExecution_deletedAt_idx" ON "WorkflowExecution"("deletedAt");

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
