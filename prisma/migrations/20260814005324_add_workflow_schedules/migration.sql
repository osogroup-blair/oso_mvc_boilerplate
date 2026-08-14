-- CreateEnum
CREATE TYPE "WorkflowScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED', 'ERROR');

-- CreateEnum
CREATE TYPE "WorkflowScheduleOverlapPolicy" AS ENUM ('SKIP', 'BUFFER_ONE', 'BUFFER_ALL', 'CANCEL_OTHER', 'TERMINATE_OTHER', 'ALLOW_ALL');

-- CreateTable
CREATE TABLE "WorkflowSchedule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "input" JSONB NOT NULL DEFAULT '{}',
    "inputSummary" JSONB NOT NULL DEFAULT '{}',
    "status" "WorkflowScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "overlapPolicy" "WorkflowScheduleOverlapPolicy" NOT NULL DEFAULT 'SKIP',
    "catchupWindowSeconds" INTEGER NOT NULL DEFAULT 60,
    "pauseOnFailure" BOOLEAN NOT NULL DEFAULT true,
    "lastTemporalStatus" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowSchedule_scheduleId_key" ON "WorkflowSchedule"("scheduleId");

-- CreateIndex
CREATE INDEX "WorkflowSchedule_orgId_status_idx" ON "WorkflowSchedule"("orgId", "status");

-- CreateIndex
CREATE INDEX "WorkflowSchedule_workflowDefinitionId_idx" ON "WorkflowSchedule"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "WorkflowSchedule_createdById_idx" ON "WorkflowSchedule"("createdById");

-- CreateIndex
CREATE INDEX "WorkflowSchedule_scheduleId_idx" ON "WorkflowSchedule"("scheduleId");

-- CreateIndex
CREATE INDEX "WorkflowSchedule_deletedAt_idx" ON "WorkflowSchedule"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowSchedule_orgId_name_key" ON "WorkflowSchedule"("orgId", "name");

-- AddForeignKey
ALTER TABLE "WorkflowSchedule" ADD CONSTRAINT "WorkflowSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSchedule" ADD CONSTRAINT "WorkflowSchedule_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowSchedule" ADD CONSTRAINT "WorkflowSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
