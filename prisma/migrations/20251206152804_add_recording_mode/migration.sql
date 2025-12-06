-- CreateEnum
CREATE TYPE "RecordingMode" AS ENUM ('ROAD_QUALITY', 'TRAFFIC');

-- AlterTable
ALTER TABLE "Drive" ADD COLUMN     "recordingMode" "RecordingMode" NOT NULL DEFAULT 'ROAD_QUALITY';
