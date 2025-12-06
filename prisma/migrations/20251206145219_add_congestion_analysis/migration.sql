-- CreateEnum
CREATE TYPE "RoadType" AS ENUM ('HIGHWAY', 'ARTERIAL', 'COLLECTOR', 'LOCAL', 'RESIDENTIAL');

-- CreateEnum
CREATE TYPE "SegmentSource" AS ENUM ('MANUAL', 'OSM_IMPORT', 'AUTO_DETECTED');

-- CreateEnum
CREATE TYPE "CongestionSeverity" AS ENUM ('FREE_FLOW', 'SLOW', 'CONGESTED', 'HEAVY', 'GRIDLOCK');

-- CreateTable
CREATE TABLE "RoadSegment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "geometry" JSONB NOT NULL,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "minLon" DOUBLE PRECISION NOT NULL,
    "maxLon" DOUBLE PRECISION NOT NULL,
    "roadType" "RoadType",
    "source" "SegmentSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,

    CONSTRAINT "RoadSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsSegmentMatch" (
    "id" TEXT NOT NULL,
    "gpsId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GpsSegmentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CongestionEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driveId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "weekOfYear" INTEGER NOT NULL,
    "severity" "CongestionSeverity" NOT NULL,
    "avgSpeed" DOUBLE PRECISION NOT NULL,
    "minSpeed" DOUBLE PRECISION NOT NULL,
    "maxSpeed" DOUBLE PRECISION NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "startGpsId" TEXT,
    "endGpsId" TEXT,

    CONSTRAINT "CongestionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentStatistics" (
    "id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "segmentId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "hourOfDay" INTEGER,
    "weekStart" TIMESTAMP(3),
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "totalDuration" INTEGER NOT NULL DEFAULT 0,
    "avgSpeed" DOUBLE PRECISION,
    "avgCongestionSpeed" DOUBLE PRECISION,
    "pctFreeFlow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctSlow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctCongested" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctHeavy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pctGridlock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "congestionScore" DOUBLE PRECISION,

    CONSTRAINT "SegmentStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoadSegment_minLat_maxLat_minLon_maxLon_idx" ON "RoadSegment"("minLat", "maxLat", "minLon", "maxLon");

-- CreateIndex
CREATE INDEX "RoadSegment_name_idx" ON "RoadSegment"("name");

-- CreateIndex
CREATE INDEX "GpsSegmentMatch_gpsId_idx" ON "GpsSegmentMatch"("gpsId");

-- CreateIndex
CREATE INDEX "GpsSegmentMatch_segmentId_gpsId_idx" ON "GpsSegmentMatch"("segmentId", "gpsId");

-- CreateIndex
CREATE UNIQUE INDEX "GpsSegmentMatch_gpsId_segmentId_key" ON "GpsSegmentMatch"("gpsId", "segmentId");

-- CreateIndex
CREATE INDEX "CongestionEvent_driveId_idx" ON "CongestionEvent"("driveId");

-- CreateIndex
CREATE INDEX "CongestionEvent_segmentId_startTime_idx" ON "CongestionEvent"("segmentId", "startTime");

-- CreateIndex
CREATE INDEX "CongestionEvent_segmentId_dayOfWeek_hourOfDay_idx" ON "CongestionEvent"("segmentId", "dayOfWeek", "hourOfDay");

-- CreateIndex
CREATE INDEX "CongestionEvent_severity_idx" ON "CongestionEvent"("severity");

-- CreateIndex
CREATE INDEX "SegmentStatistics_segmentId_dayOfWeek_idx" ON "SegmentStatistics"("segmentId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "SegmentStatistics_segmentId_hourOfDay_idx" ON "SegmentStatistics"("segmentId", "hourOfDay");

-- CreateIndex
CREATE INDEX "SegmentStatistics_segmentId_weekStart_idx" ON "SegmentStatistics"("segmentId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentStatistics_segmentId_dayOfWeek_hourOfDay_weekStart_key" ON "SegmentStatistics"("segmentId", "dayOfWeek", "hourOfDay", "weekStart");

-- AddForeignKey
ALTER TABLE "GpsSegmentMatch" ADD CONSTRAINT "GpsSegmentMatch_gpsId_fkey" FOREIGN KEY ("gpsId") REFERENCES "GpsSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsSegmentMatch" ADD CONSTRAINT "GpsSegmentMatch_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "RoadSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CongestionEvent" ADD CONSTRAINT "CongestionEvent_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CongestionEvent" ADD CONSTRAINT "CongestionEvent_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "RoadSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SegmentStatistics" ADD CONSTRAINT "SegmentStatistics_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "RoadSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
