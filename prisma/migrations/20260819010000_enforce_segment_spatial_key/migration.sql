-- Make the tile the merge key. Applied only after the backfill collapsed the
-- OpenLR-keyed duplicates: two rows for one tile would fail this outright,
-- which is the point of adding it last.
-- DropIndex
DROP INDEX "RoadSegment_source_spatialKey_idx";

-- CreateIndex
CREATE UNIQUE INDEX "RoadSegment_source_spatialKey_key" ON "RoadSegment"("source", "spatialKey");

-- Provenance only from here: the same road matched twice returns different
-- OpenLR references, so this can no longer be an identity.
-- DropIndex
DROP INDEX "RoadSegment_source_sourceId_key";

-- CreateIndex
CREATE INDEX "RoadSegment_source_sourceId_idx" ON "RoadSegment"("source", "sourceId");
