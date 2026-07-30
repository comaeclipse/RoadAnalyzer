-- Adds provenance and idempotency information for finalized iOS traffic reports.
CREATE TYPE "DriveSource" AS ENUM ('WEB', 'IOS');

ALTER TABLE "Drive"
  ADD COLUMN "source" "DriveSource" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "appSchemaVersion" TEXT,
  ADD COLUMN "trafficAnalysisVersion" TEXT,
  ADD COLUMN "deviceModel" TEXT,
  ADD COLUMN "osVersion" TEXT,
  ADD COLUMN "uploadCompletedAt" TIMESTAMP(3),
  ADD COLUMN "diagnostics" JSONB;

CREATE UNIQUE INDEX "Drive_idempotencyKey_key" ON "Drive"("idempotencyKey");
