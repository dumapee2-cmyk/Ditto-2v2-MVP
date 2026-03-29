-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_slots" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "is_host" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "phone" TEXT,
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "party_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parties_code_key" ON "parties"("code");
CREATE INDEX "parties_code_idx" ON "parties"("code");
CREATE INDEX "parties_status_idx" ON "parties"("status");

-- CreateIndex
CREATE UNIQUE INDEX "party_slots_party_id_position_key" ON "party_slots"("party_id", "position");
CREATE INDEX "party_slots_party_id_idx" ON "party_slots"("party_id");

-- AddForeignKey
ALTER TABLE "party_slots" ADD CONSTRAINT "party_slots_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
