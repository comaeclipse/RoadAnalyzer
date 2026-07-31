-- CreateEnum
CREATE TYPE "SegmentMatchSource" AS ENUM ('MAPBOX', 'MANUAL_OVERRIDE', 'MANUAL_FALLBACK');

-- CreateEnum
CREATE TYPE "TripAnalysisStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CardinalDirection" AS ENUM ('NORTH', 'NORTHEAST', 'EAST', 'SOUTHEAST', 'SOUTH', 'SOUTHWEST', 'WEST', 'NORTHWEST');

-- AlterEnum
ALTER TYPE "SegmentSource" ADD VALUE 'MAPBOX';

-- AlterTable
ALTER TABLE "GpsSample"
ADD COLUMN "speedAccuracy" DOUBLE PRECISION,
ADD COLUMN "courseAccuracy" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RoadSegment"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GpsSegmentMatch"
ADD COLUMN "snappedLatitude" DOUBLE PRECISION,
ADD COLUMN "snappedLongitude" DOUBLE PRECISION,
ADD COLUMN "confidence" DOUBLE PRECISION,
ADD COLUMN "source" "SegmentMatchSource" NOT NULL DEFAULT 'MAPBOX';

-- CreateTable
CREATE TABLE "TripAnalysis" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "status" "TripAnalysisStatus" NOT NULL DEFAULT 'PROCESSING',
    "provider" TEXT NOT NULL DEFAULT 'mapbox',
    "providerVersion" TEXT NOT NULL DEFAULT 'v5',
    "matchedGeometry" JSONB,
    "matchedDistance" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "coverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchedPointCount" INTEGER NOT NULL DEFAULT 0,
    "totalPointCount" INTEGER NOT NULL DEFAULT 0,
    "netDirection" "CardinalDirection",
    "dominantDirection" "CardinalDirection",
    "directionBreakdown" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maneuver" (
    "id" TEXT NOT NULL,
    "tripAnalysisId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "modifier" TEXT,
    "turnType" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "fromRoad" TEXT,
    "toRoad" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "bearingBefore" DOUBLE PRECISION,
    "bearingAfter" DOUBLE PRECISION,
    "angleDegrees" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "Maneuver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoadSegment_source_sourceId_key" ON "RoadSegment"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TripAnalysis_driveId_key" ON "TripAnalysis"("driveId");

-- CreateIndex
CREATE INDEX "TripAnalysis_status_updatedAt_idx" ON "TripAnalysis"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Maneuver_tripAnalysisId_sequence_key" ON "Maneuver"("tripAnalysisId", "sequence");

-- CreateIndex
CREATE INDEX "Maneuver_tripAnalysisId_idx" ON "Maneuver"("tripAnalysisId");

-- AddForeignKey
ALTER TABLE "TripAnalysis" ADD CONSTRAINT "TripAnalysis_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maneuver" ADD CONSTRAINT "Maneuver_tripAnalysisId_fkey" FOREIGN KEY ("tripAnalysisId") REFERENCES "TripAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
