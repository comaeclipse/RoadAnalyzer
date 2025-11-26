'use client';

import { useState } from 'react';
import { useRecordingContext } from '@/components/providers/RecordingProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';

export function RecordingControls() {
  const {
    isRecording,
    startRecording,
    stopRecording,
    bufferStatus,
    recordingError,
    recordingDuration,
  } = useRecordingContext();

  const [isProcessing, setIsProcessing] = useState(false);

  async function handleStart() {
    setIsProcessing(true);
    try {
      await startRecording({
        name: `Drive ${new Date().toLocaleString()}`,
      });
    } catch (error) {
      console.error('Failed to start recording:', error);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleStop() {
    setIsProcessing(true);
    try {
      const drive = await stopRecording();
      console.log('Recording saved:', drive);
    } catch (error) {
      console.error('Failed to stop recording:', error);
    } finally {
      setIsProcessing(false);
    }
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        {!isRecording ? (
          <Button
            size="lg"
            onClick={handleStart}
            disabled={isProcessing}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold"
          >
            <div className="w-4 h-4 mr-2 rounded-full bg-white" />
            Start Recording
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              onClick={handleStop}
              disabled={isProcessing}
              variant="outline"
              className="font-semibold"
            >
              <div className="w-4 h-4 mr-2 bg-gray-600" />
              Stop Recording
            </Button>

            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-sm font-mono">
                {formatDuration(recordingDuration)}
              </Badge>

              {bufferStatus.accelerometer > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Accel: {bufferStatus.accelerometer}
                </Badge>
              )}

              {bufferStatus.gps > 0 && (
                <Badge variant="secondary" className="text-xs">
                  GPS: {bufferStatus.gps}
                </Badge>
              )}

              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span className="text-sm text-muted-foreground">Recording</span>
              </div>
            </div>
          </>
        )}
      </div>

      {recordingError && (
        <Alert variant="destructive" className="text-sm">
          {recordingError}
        </Alert>
      )}
    </div>
  );
}
