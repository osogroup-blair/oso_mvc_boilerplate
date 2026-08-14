-- CreateEnum
CREATE TYPE "WorkflowCapability" AS ENUM ('START', 'VIEW', 'ACT', 'CANCEL', 'ADMIN');

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "defaultTaskQueue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "icon" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "presentation" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinitionRole" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" "WorkflowCapability" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowDefinitionRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowIntegrationRequirement" (
    "id" TEXT NOT NULL,
    "workflowDefinitionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "capabilityKey" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowIntegrationRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_key_key" ON "WorkflowDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinition_slug_key" ON "WorkflowDefinition"("slug");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_key_idx" ON "WorkflowDefinition"("key");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_slug_idx" ON "WorkflowDefinition"("slug");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_isEnabled_idx" ON "WorkflowDefinition"("isEnabled");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_deletedAt_idx" ON "WorkflowDefinition"("deletedAt");

-- CreateIndex
CREATE INDEX "WorkflowDefinitionRole_workflowDefinitionId_idx" ON "WorkflowDefinitionRole"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "WorkflowDefinitionRole_roleId_idx" ON "WorkflowDefinitionRole"("roleId");

-- CreateIndex
CREATE INDEX "WorkflowDefinitionRole_capability_idx" ON "WorkflowDefinitionRole"("capability");

-- CreateIndex
CREATE INDEX "WorkflowDefinitionRole_deletedAt_idx" ON "WorkflowDefinitionRole"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowDefinitionRole_workflowDefinitionId_roleId_capabili_key" ON "WorkflowDefinitionRole"("workflowDefinitionId", "roleId", "capability");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationRequirement_workflowDefinitionId_idx" ON "WorkflowIntegrationRequirement"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationRequirement_providerKey_idx" ON "WorkflowIntegrationRequirement"("providerKey");

-- CreateIndex
CREATE INDEX "WorkflowIntegrationRequirement_deletedAt_idx" ON "WorkflowIntegrationRequirement"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowIntegrationRequirement_workflowDefinitionId_key_key" ON "WorkflowIntegrationRequirement"("workflowDefinitionId", "key");

-- AddForeignKey
ALTER TABLE "WorkflowDefinitionRole" ADD CONSTRAINT "WorkflowDefinitionRole_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinitionRole" ADD CONSTRAINT "WorkflowDefinitionRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowIntegrationRequirement" ADD CONSTRAINT "WorkflowIntegrationRequirement_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
