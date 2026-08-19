-- Precomputed at import so the page can count controls we pass without stopping
-- without sweeping every control against every road on each request.
-- AlterTable
ALTER TABLE "OsmSignal"
ADD COLUMN "onDrivenRoad" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "OsmSignal_onDrivenRoad_idx" ON "OsmSignal"("onDrivenRoad");
