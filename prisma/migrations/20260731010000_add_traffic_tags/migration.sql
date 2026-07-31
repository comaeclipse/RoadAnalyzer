CREATE TYPE "TrafficTagKind" AS ENUM ('RED_LIGHT', 'STOP_SIGN', 'INTERSECTION', 'TRAFFIC', 'PARKING', 'OTHER');

CREATE TABLE "TrafficTag" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "driveId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "featureType" TEXT NOT NULL,
  "kind" "TrafficTagKind" NOT NULL,
  "note" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "duration" INTEGER NOT NULL,
  CONSTRAINT "TrafficTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrafficTag_driveId_featureKey_key" ON "TrafficTag"("driveId", "featureKey");
CREATE INDEX "TrafficTag_driveId_idx" ON "TrafficTag"("driveId");
CREATE INDEX "TrafficTag_kind_idx" ON "TrafficTag"("kind");
ALTER TABLE "TrafficTag" ADD CONSTRAINT "TrafficTag_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
