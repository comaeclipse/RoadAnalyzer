ALTER TABLE "Drive" ADD COLUMN "routeTemplateId" TEXT;

CREATE TABLE "RouteTemplate" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "geometry" JSONB NOT NULL,
  "distance" DOUBLE PRECISION NOT NULL,
  "direction" "CardinalDirection",
  "referenceDriveId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "RouteTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteTemplate_referenceDriveId_key" ON "RouteTemplate"("referenceDriveId");
CREATE INDEX "RouteTemplate_isActive_idx" ON "RouteTemplate"("isActive");
CREATE INDEX "Drive_routeTemplateId_idx" ON "Drive"("routeTemplateId");
ALTER TABLE "Drive" ADD CONSTRAINT "Drive_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "RouteTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
