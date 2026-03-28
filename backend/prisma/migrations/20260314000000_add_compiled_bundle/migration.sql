-- AlterTable
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "compiled_bundle" TEXT;

-- AlterTable
ALTER TABLE "app_versions" ADD COLUMN IF NOT EXISTS "compiled_bundle" TEXT;
