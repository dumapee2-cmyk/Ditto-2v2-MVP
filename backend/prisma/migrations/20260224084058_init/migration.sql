-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "short_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "original_prompt" TEXT NOT NULL,
    "forked_from" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_runs" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "tokens_used" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apps_short_id_key" ON "apps"("short_id");

-- CreateIndex
CREATE INDEX "apps_short_id_idx" ON "apps"("short_id");

-- CreateIndex
CREATE INDEX "apps_created_at_idx" ON "apps"("created_at");

-- CreateIndex
CREATE INDEX "app_runs_app_id_created_at_idx" ON "app_runs"("app_id", "created_at");

-- AddForeignKey
ALTER TABLE "app_runs" ADD CONSTRAINT "app_runs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
