-- Add quality metadata on apps
ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "latest_quality_score" INTEGER,
  ADD COLUMN IF NOT EXISTS "latest_pipeline_summary" TEXT;

-- Version snapshots for safe iteration
CREATE TABLE IF NOT EXISTS "app_versions" (
  "id" TEXT PRIMARY KEY,
  "app_id" TEXT NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "generated_code" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "app_versions_app_id_created_at_idx"
  ON "app_versions"("app_id", "created_at");

-- Pipeline artifacts and quality scoring telemetry
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "id" TEXT PRIMARY KEY,
  "app_id" TEXT NOT NULL REFERENCES "apps"("id") ON DELETE CASCADE,
  "prompt" TEXT NOT NULL,
  "intent" JSONB NOT NULL,
  "artifact" JSONB NOT NULL,
  "quality_score" INTEGER NOT NULL,
  "quality_breakdown" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "pipeline_runs_app_id_created_at_idx"
  ON "pipeline_runs"("app_id", "created_at");
