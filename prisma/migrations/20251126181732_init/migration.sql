-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('RECORDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Drive" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" "DriveStatus" NOT NULL DEFAULT 'RECORDING',
    "name" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "duration" INTEGER,
    "distance" DOUBLE PRECISION,
    "maxSpeed" DOUBLE PRECISION,
    "avgSpeed" DOUBLE PRECISION,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Drive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccelerometerSample" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "magnitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AccelerometerSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsSample" (
    "id" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitude" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "distanceFromPrev" DOUBLE PRECISION,

    CONSTRAINT "GpsSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Drive_createdAt_idx" ON "Drive"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Drive_status_idx" ON "Drive"("status");

-- CreateIndex
CREATE INDEX "AccelerometerSample_driveId_timestamp_idx" ON "AccelerometerSample"("driveId", "timestamp");

-- CreateIndex
CREATE INDEX "AccelerometerSample_timestamp_idx" ON "AccelerometerSample"("timestamp");

-- CreateIndex
CREATE INDEX "GpsSample_driveId_timestamp_idx" ON "GpsSample"("driveId", "timestamp");

-- CreateIndex
CREATE INDEX "GpsSample_timestamp_idx" ON "GpsSample"("timestamp");

-- AddForeignKey
ALTER TABLE "AccelerometerSample" ADD CONSTRAINT "AccelerometerSample_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsSample" ADD CONSTRAINT "GpsSample_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
