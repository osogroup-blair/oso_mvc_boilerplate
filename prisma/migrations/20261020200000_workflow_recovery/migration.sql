-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityIdempotencyStatus" ADD VALUE 'RETRYABLE';
ALTER TYPE "ActivityIdempotencyStatus" ADD VALUE 'UNCERTAIN';

-- AlterTable
ALTER TABLE "ActivityIdempotency" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "providerReceiptId" TEXT;

-- AlterTable
ALTER TABLE "WorkflowExecution" ADD COLUMN     "actionProtocol" TEXT NOT NULL DEFAULT 'signal-v1',
ADD COLUMN     "businessOutcome" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "syncErrorCode" TEXT;

-- AlterTable
ALTER TABLE "WorkflowHumanTask" ADD COLUMN     "deliveryReceiptId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "WorkflowStartIntent" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowStartIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStartIntent_workflowId_key" ON "WorkflowStartIntent"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowStartIntent_orgId_state_idx" ON "WorkflowStartIntent"("orgId", "state");

-- CreateIndex
CREATE INDEX "WorkflowStartIntent_deletedAt_idx" ON "WorkflowStartIntent"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowHumanTask_deliveryReceiptId_key" ON "WorkflowHumanTask"("deliveryReceiptId");

