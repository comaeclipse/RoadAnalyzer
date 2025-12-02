'use client';

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { useSensorContext } from './SensorProvider';
import { RecordingContextType, DriveMetadata, Drive } from '@/types/recordings';
import { AccelerometerData, GPSData } from '@/types/sensors';

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

// Buffer thresholds
const ACCEL_BUFFER_THRESHOLD = 100; // 100 samples = ~10 seconds at 10Hz
const GPS_BUFFER_THRESHOLD = 10;    // 10 samples = ~10 seconds at 1Hz
const FLUSH_INTERVAL = 10000;       // 10 seconds

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const { accelerometer, gps, isEnabled } = useSensorContext();

  const [isRecording, setIsRecording] = useState(false);
  const [currentDriveId, setCurrentDriveId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);

  // Buffers (using useRef to avoid re-renders)
  const accelerometerBuffer = useRef<AccelerometerData[]>([]);
  const gpsBuffer = useRef<GPSData[]>([]);
  const flushInProgress = useRef({ accel: false, gps: false });

  // Calculate recording duration
  useEffect(() => {
    if (!isRecording || !recordingStartTime) return;

    const interval = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording, recordingStartTime]);

  // Add accelerometer samples to buffer
  useEffect(() => {
    if (!isRecording || !isEnabled || !accelerometer.data) return;

    accelerometerBuffer.current.push(accelerometer.data);

    // Flush when buffer reaches threshold
    if (accelerometerBuffer.current.length >= ACCEL_BUFFER_THRESHOLD) {
      flushAccelerometerBuffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accelerometer.data, isRecording, isEnabled]);

  // Add GPS samples to buffer
  useEffect(() => {
    if (!isRecording || !isEnabled || !gps.data) return;

    gpsBuffer.current.push(gps.data);

    // Flush when buffer reaches threshold
    if (gpsBuffer.current.length >= GPS_BUFFER_THRESHOLD) {
      flushGpsBuffer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.data, isRecording, isEnabled]);

  // Periodic flush (backup to threshold-based flushing)
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      flushAccelerometerBuffer();
      flushGpsBuffer();
    }, FLUSH_INTERVAL);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Warn user before leaving if recording is active
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRecording) {
        e.preventDefault();
        e.returnValue = 'Recording in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRecording]);

  // Flush buffers and stop recording on unmount
  useEffect(() => {
    return () => {
      if (isRecording && currentDriveId) {
        // Use sendBeacon for guaranteed delivery on page unload
        if (accelerometerBuffer.current.length > 0) {
          const blob = new Blob(
            [
              JSON.stringify({
                driveId: currentDriveId,
                type: 'accelerometer',
                samples: accelerometerBuffer.current,
              }),
            ],
            { type: 'application/json' }
          );
          navigator.sendBeacon('/api/recordings/sensor-data', blob);
        }

        if (gpsBuffer.current.length > 0) {
          const blob = new Blob(
            [
              JSON.stringify({
                driveId: currentDriveId,
                type: 'gps',
                samples: gpsBuffer.current,
              }),
            ],
            { type: 'application/json' }
          );
          navigator.sendBeacon('/api/recordings/sensor-data', blob);
        }

        // Also try to stop the recording via sendBeacon
        const stopBlob = new Blob(
          [JSON.stringify({ driveId: currentDriveId })],
          { type: 'application/json' }
        );
        navigator.sendBeacon('/api/recordings/stop', stopBlob);
      }
    };
  }, [isRecording, currentDriveId]);

  // Check for orphaned recording on mount
  useEffect(() => {
    const orphanedDriveId = localStorage.getItem('activeRecording');
    if (orphanedDriveId && !isRecording) {
      // Try to stop the orphaned recording
      fetch('/api/recordings/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveId: orphanedDriveId }),
      })
        .then(() => {
          console.log('Recovered orphaned recording:', orphanedDriveId);
          localStorage.removeItem('activeRecording');
        })
        .catch((err) => {
          console.error('Failed to recover orphaned recording:', err);
          localStorage.removeItem('activeRecording');
        });
    }
  }, []); // Only run on mount

  const flushAccelerometerBuffer = useCallback(async () => {
    if (
      flushInProgress.current.accel ||
      accelerometerBuffer.current.length === 0 ||
      !currentDriveId
    ) {
      return;
    }

    flushInProgress.current.accel = true;
    const batch = [...accelerometerBuffer.current];
    accelerometerBuffer.current = []; // Clear immediately

    try {
      const response = await fetch('/api/recordings/sensor-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driveId: currentDriveId,
          type: 'accelerometer',
          samples: batch,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save accelerometer data');
      }

      // Clear error on success
      if (recordingError) {
        setRecordingError(null);
      }
    } catch (error) {
      console.error('Accelerometer flush error:', error);
      // Re-add to front of buffer (maintain order)
      accelerometerBuffer.current = [...batch, ...accelerometerBuffer.current];
      setRecordingError('Network error - data buffered locally');

      // Retry after delay
      setTimeout(() => flushAccelerometerBuffer(), 5000);
    } finally {
      flushInProgress.current.accel = false;
    }
  }, [currentDriveId, recordingError]);

  const flushGpsBuffer = useCallback(async () => {
    if (
      flushInProgress.current.gps ||
      gpsBuffer.current.length === 0 ||
      !currentDriveId
    ) {
      return;
    }

    flushInProgress.current.gps = true;
    const batch = [...gpsBuffer.current];
    gpsBuffer.current = []; // Clear immediately

    try {
      const response = await fetch('/api/recordings/sensor-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driveId: currentDriveId,
          type: 'gps',
          samples: batch,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save GPS data');
      }

      // Clear error on success
      if (recordingError) {
        setRecordingError(null);
      }
    } catch (error) {
      console.error('GPS flush error:', error);
      // Re-add to front of buffer (maintain order)
      gpsBuffer.current = [...batch, ...gpsBuffer.current];
      setRecordingError('Network error - data buffered locally');

      // Retry after delay
      setTimeout(() => flushGpsBuffer(), 5000);
    } finally {
      flushInProgress.current.gps = false;
    }
  }, [currentDriveId, recordingError]);

  const startRecording = useCallback(async (metadata?: DriveMetadata) => {
    try {
      setRecordingError(null);

      const response = await fetch('/api/recordings/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata || {}),
      });

      if (!response.ok) {
        throw new Error('Failed to start recording');
      }

      const { driveId } = await response.json();
      setCurrentDriveId(driveId);
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      setRecordingDuration(0);

      // Store in localStorage for recovery
      localStorage.setItem('activeRecording', driveId);
    } catch (error) {
      console.error('Start recording error:', error);
      setRecordingError('Failed to start recording');
      throw error;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<Drive> => {
    if (!currentDriveId) {
      throw new Error('No active recording');
    }

    try {
      // Flush remaining buffers first
      await Promise.all([flushAccelerometerBuffer(), flushGpsBuffer()]);

      // Wait a bit to ensure all data is saved
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Call stop endpoint
      const response = await fetch('/api/recordings/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveId: currentDriveId }),
      });

      if (!response.ok) {
        throw new Error('Failed to stop recording');
      }

      const { drive } = await response.json();

      // Reset state
      setIsRecording(false);
      setCurrentDriveId(null);
      setRecordingStartTime(null);
      setRecordingDuration(0);
      accelerometerBuffer.current = [];
      gpsBuffer.current = [];
      setRecordingError(null);

      // Clear localStorage
      localStorage.removeItem('activeRecording');

      return drive;
    } catch (error) {
      console.error('Stop recording error:', error);
      setRecordingError('Failed to stop recording');
      throw error;
    }
  }, [currentDriveId, flushAccelerometerBuffer, flushGpsBuffer]);

  const value: RecordingContextType = {
    isRecording,
    currentDriveId,
    startRecording,
    stopRecording,
    recordingError,
    bufferStatus: {
      accelerometer: accelerometerBuffer.current.length,
      gps: gpsBuffer.current.length,
    },
    recordingDuration,
  };

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext() {
  const context = useContext(RecordingContext);
  if (context === undefined) {
    throw new Error('useRecordingContext must be used within a RecordingProvider');
  }
  return context;
}
