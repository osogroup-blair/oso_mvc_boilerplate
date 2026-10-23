-- Expand-only: existing public Asset rows and URLs are unchanged.
CREATE TYPE "PrivateAssetState" AS ENUM ('PENDING', 'READY', 'DELETING', 'DELETED');

CREATE TABLE "PrivateAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "state" "PrivateAssetState" NOT NULL DEFAULT 'PENDING',
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "PrivateAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrivateAsset_key_key" ON "PrivateAsset"("key");
CREATE UNIQUE INDEX "PrivateAsset_orgId_resourceType_resourceId_operationId_key" ON "PrivateAsset"("orgId", "resourceType", "resourceId", "operationId");
CREATE INDEX "PrivateAsset_orgId_resourceType_resourceId_state_idx" ON "PrivateAsset"("orgId", "resourceType", "resourceId", "state");
CREATE INDEX "PrivateAsset_state_updatedAt_idx" ON "PrivateAsset"("state", "updatedAt");
CREATE INDEX "PrivateAsset_deletedAt_idx" ON "PrivateAsset"("deletedAt");
ALTER TABLE "PrivateAsset" ADD CONSTRAINT "PrivateAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
