-- Deterministic identity for a physical stretch of road. Nullable and not yet
-- unique: existing rows carry duplicates of the same stretch, so the constraint
-- can only go on once the backfill has collapsed them.
-- AlterTable
ALTER TABLE "RoadSegment"
ADD COLUMN "spatialKey" TEXT;

-- CreateIndex
CREATE INDEX "RoadSegment_source_spatialKey_idx" ON "RoadSegment"("source", "spatialKey");
