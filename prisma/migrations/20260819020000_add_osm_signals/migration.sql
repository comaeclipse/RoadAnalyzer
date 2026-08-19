-- Traffic controls imported from OpenStreetMap, keyed on the OSM node id.
-- CreateTable
CREATE TABLE "OsmSignal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "osmNodeId" BIGINT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "highway" TEXT NOT NULL,
    "direction" TEXT,
    "tags" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsmSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OsmSignal_osmNodeId_key" ON "OsmSignal"("osmNodeId");

-- CreateIndex
CREATE INDEX "OsmSignal_latitude_longitude_idx" ON "OsmSignal"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "OsmSignal_highway_idx" ON "OsmSignal"("highway");
