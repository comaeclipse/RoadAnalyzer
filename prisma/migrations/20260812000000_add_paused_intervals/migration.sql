-- AlterTable
ALTER TABLE "Drive"
ADD COLUMN "pausedDuration" INTEGER;

-- CreateTable
CREATE TABLE "PausedInterval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driveId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "endedBy" TEXT,

    CONSTRAINT "PausedInterval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PausedInterval_driveId_startedAt_idx" ON "PausedInterval"("driveId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PausedInterval_driveId_clientId_key" ON "PausedInterval"("driveId", "clientId");

-- AddForeignKey
ALTER TABLE "PausedInterval" ADD CONSTRAINT "PausedInterval_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
