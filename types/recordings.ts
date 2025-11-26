import { Drive, DriveStatus } from '@prisma/client';
import { AccelerometerData, GPSData } from './sensors';

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

export type { Drive, DriveStatus };
