import { AccelerometerData, GPSData } from './sensors';

// Drive status enum
export type DriveStatus = 'RECORDING' | 'COMPLETED' | 'FAILED';

// Drive type (matches Prisma schema but without Prisma dependency)
export interface Drive {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  startTime: Date | string;
  endTime: Date | string | null;
  status: DriveStatus;
  name: string | null;
  description: string | null;
  tags: string[];
  duration: number | null;
  distance: number | null;
  maxSpeed: number | null;
  avgSpeed: number | null;
  sampleCount: number;
}

export interface DriveMetadata {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface StartRecordingRequest {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface StartRecordingResponse {
  driveId: string;
}

export interface StopRecordingRequest {
  driveId: string;
}

export interface StopRecordingResponse {
  drive: Drive;
}

export interface SensorDataBatch {
  driveId: string;
  type: 'accelerometer' | 'gps';
  samples: AccelerometerData[] | GPSData[];
}

export interface SensorDataResponse {
  success: boolean;
  count: number;
}

export interface RecordingContextType {
  isRecording: boolean;
  currentDriveId: string | null;
  startRecording: (metadata?: DriveMetadata) => Promise<void>;
  stopRecording: () => Promise<Drive>;
  recordingError: string | null;
  bufferStatus: {
    accelerometer: number;
    gps: number;
  };
  recordingDuration: number; // in seconds
}
