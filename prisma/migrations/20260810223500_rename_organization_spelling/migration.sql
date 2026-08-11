-- Rename the multi-tenancy table and database objects to the American spelling.
ALTER TABLE "OrgMember" DROP CONSTRAINT IF EXISTS "OrgMember_orgId_fkey";

ALTER TABLE "Organisation" RENAME TO "Organization";
ALTER TABLE "Organization" RENAME CONSTRAINT "Organisation_pkey" TO "Organization_pkey";
ALTER INDEX IF EXISTS "Organisation_slug_key" RENAME TO "Organization_slug_key";
ALTER INDEX IF EXISTS "Organisation_deletedAt_idx" RENAME TO "Organization_deletedAt_idx";

ALTER TABLE "OrgMember"
  ADD CONSTRAINT "OrgMember_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
