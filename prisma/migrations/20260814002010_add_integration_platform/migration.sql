-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'CONFIG_ERROR');

-- CreateEnum
CREATE TYPE "IntegrationTestStatus" AS ENUM ('NOT_TESTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActivityIdempotencyStatus" AS ENUM ('RECEIVED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentialCiphertext" TEXT NOT NULL,
    "credentialIv" TEXT NOT NULL,
    "credentialAuthTag" TEXT NOT NULL,
    "credentialKeyVersion" TEXT NOT NULL,
    "credentialFingerprint" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" "IntegrationTestStatus",
    "lastTestMessage" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowIntegrationBinding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationStatus" "IntegrationTestStatus",
    "lastValidationMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowIntegrationBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityIdempotency" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ActivityIdempotencyStatus" NOT NULL DEFAULT 'RECEIVED',
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "error" JSONB,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_orgId_idx" ON "IntegrationConnection"("orgId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_providerKey_idx" ON "IntegrationConnection"("providerKey");

-- CreateIndex
CREATE INDEX "IntegrationConnection_status_idx" ON "IntegrationConnection"("status");

-- CreateIndex
CREATE INDEX "IntegrationConnection_deletedAt_idx" ON "IntegrationConnection"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_orgId_name_key" ON "IntegrationConnection"("orgId", "name");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationBinding_orgId_idx" ON "WorkflowIntegrationBinding"("orgId");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationBinding_workflowDefinitionId_idx" ON "WorkflowIntegrationBinding"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationBinding_connectionId_idx" ON "WorkflowIntegrationBinding"("connectionId");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationBinding_deletedAt_idx" ON "WorkflowIntegrationBinding"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowIntegrationBinding_orgId_workflowDefinitionId_requi_key" ON "WorkflowIntegrationBinding"("orgId", "workflowDefinitionId", "requirementKey");

-- CreateIndex
CREATE INDEX "ActivityIdempotency_orgId_idx" ON "ActivityIdempotency"("orgId");

-- CreateIndex
CREATE INDEX "ActivityIdempotency_scope_idx" ON "ActivityIdempotency"("scope");

-- CreateIndex
CREATE INDEX "ActivityIdempotency_status_idx" ON "ActivityIdempotency"("status");

-- CreateIndex
CREATE INDEX "ActivityIdempotency_expiresAt_idx" ON "ActivityIdempotency"("expiresAt");

-- CreateIndex
CREATE INDEX "ActivityIdempotency_deletedAt_idx" ON "ActivityIdempotency"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityIdempotency_orgId_scope_idempotencyKey_key" ON "ActivityIdempotency"("orgId", "scope", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowIntegrationBinding" ADD CONSTRAINT "WorkflowIntegrationBinding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowIntegrationBinding" ADD CONSTRAINT "WorkflowIntegrationBinding_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowIntegrationBinding" ADD CONSTRAINT "WorkflowIntegrationBinding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityIdempotency" ADD CONSTRAINT "ActivityIdempotency_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
