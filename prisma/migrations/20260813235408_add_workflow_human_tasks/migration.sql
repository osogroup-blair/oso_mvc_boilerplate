-- CreateEnum
CREATE TYPE "WorkflowHumanTaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkflowActionChannel" AS ENUM ('AUTHENTICATED', 'TOKEN');

-- CreateEnum
CREATE TYPE "WorkflowActionReceiptStatus" AS ENUM ('RECEIVED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "WorkflowHumanTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT,
    "taskKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkflowHumanTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignedUserId" TEXT,
    "actionForm" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "dueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowHumanTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowHumanTaskRole" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowHumanTaskRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTaskToken" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowTaskToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowActionReceipt" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workflowExecutionId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "channel" "WorkflowActionChannel" NOT NULL,
    "status" "WorkflowActionReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
    "actorUserId" TEXT,
    "tokenId" TEXT,
    "requestHash" TEXT NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_orgId_status_idx" ON "WorkflowHumanTask"("orgId", "status");

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_workflowExecutionId_idx" ON "WorkflowHumanTask"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_workflowId_idx" ON "WorkflowHumanTask"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_assignedUserId_idx" ON "WorkflowHumanTask"("assignedUserId");

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_dueAt_idx" ON "WorkflowHumanTask"("dueAt");

-- CreateIndex
CREATE INDEX "WorkflowHumanTask_deletedAt_idx" ON "WorkflowHumanTask"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowHumanTask_workflowExecutionId_taskKey_key" ON "WorkflowHumanTask"("workflowExecutionId", "taskKey");

-- CreateIndex
CREATE INDEX "WorkflowHumanTaskRole_taskId_idx" ON "WorkflowHumanTaskRole"("taskId");

-- CreateIndex
CREATE INDEX "WorkflowHumanTaskRole_roleId_idx" ON "WorkflowHumanTaskRole"("roleId");

-- CreateIndex
CREATE INDEX "WorkflowHumanTaskRole_deletedAt_idx" ON "WorkflowHumanTaskRole"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowHumanTaskRole_taskId_roleId_key" ON "WorkflowHumanTaskRole"("taskId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTaskToken_tokenHash_key" ON "WorkflowTaskToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkflowTaskToken_taskId_idx" ON "WorkflowTaskToken"("taskId");

-- CreateIndex
CREATE INDEX "WorkflowTaskToken_expiresAt_idx" ON "WorkflowTaskToken"("expiresAt");

-- CreateIndex
CREATE INDEX "WorkflowTaskToken_consumedAt_idx" ON "WorkflowTaskToken"("consumedAt");

-- CreateIndex
CREATE INDEX "WorkflowTaskToken_revokedAt_idx" ON "WorkflowTaskToken"("revokedAt");

-- CreateIndex
CREATE INDEX "WorkflowTaskToken_deletedAt_idx" ON "WorkflowTaskToken"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_orgId_idx" ON "WorkflowActionReceipt"("orgId");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_workflowExecutionId_idx" ON "WorkflowActionReceipt"("workflowExecutionId");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_taskId_idx" ON "WorkflowActionReceipt"("taskId");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_actorUserId_idx" ON "WorkflowActionReceipt"("actorUserId");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_tokenId_idx" ON "WorkflowActionReceipt"("tokenId");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_status_idx" ON "WorkflowActionReceipt"("status");

-- CreateIndex
CREATE INDEX "WorkflowActionReceipt_deletedAt_idx" ON "WorkflowActionReceipt"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowActionReceipt_taskId_idempotencyKey_key" ON "WorkflowActionReceipt"("taskId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "WorkflowHumanTask" ADD CONSTRAINT "WorkflowHumanTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowHumanTask" ADD CONSTRAINT "WorkflowHumanTask_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowHumanTask" ADD CONSTRAINT "WorkflowHumanTask_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowHumanTaskRole" ADD CONSTRAINT "WorkflowHumanTaskRole_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowHumanTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowHumanTaskRole" ADD CONSTRAINT "WorkflowHumanTaskRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTaskToken" ADD CONSTRAINT "WorkflowTaskToken_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowHumanTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionReceipt" ADD CONSTRAINT "WorkflowActionReceipt_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionReceipt" ADD CONSTRAINT "WorkflowActionReceipt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkflowHumanTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionReceipt" ADD CONSTRAINT "WorkflowActionReceipt_workflowExecutionId_fkey" FOREIGN KEY ("workflowExecutionId") REFERENCES "WorkflowExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionReceipt" ADD CONSTRAINT "WorkflowActionReceipt_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
