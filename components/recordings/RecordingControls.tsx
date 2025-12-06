'use client';

import { useState } from 'react';
import { useRecordingContext } from '@/components/providers/RecordingProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { RecordingMode } from '@/types/recordings';
import { TrafficCone, Timer } from 'lucide-react';

export function RecordingControls() {
  const {
    isRecording,
    currentRecordingMode,
    startRecording,
    stopRecording,
    bufferStatus,
    recordingError,
    recordingDuration,
  } = useRecordingContext();

  const [isProcessing, setIsProcessing] = useState(false);

  async function handleStart(mode: RecordingMode) {
    setIsProcessing(true);
    try {
      await startRecording({
        recordingMode: mode,
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

  const modeLabel = currentRecordingMode === 'TRAFFIC' ? 'Traffic' : 'Road Quality';
  const modeColor = 'bg-gray-900';

  return (
    <div className="space-y-3">
          <div className="flex flex-col gap-2">
            {!isRecording ? (
              <div className="flex gap-2">
                <Button
                  size="lg"
                  onClick={() => handleStart('ROAD_QUALITY')}
                  disabled={isProcessing}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-medium"
                >
                  <TrafficCone className="w-4 h-4 mr-2" />
                  Road Quality
                </Button>
                <Button
                  size="lg"
                  onClick={() => handleStart('TRAFFIC')}
                  disabled={isProcessing}
                  className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-medium"
                >
                  <Timer className="w-4 h-4 mr-2" />
                  Traffic
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Button
                    size="lg"
                    onClick={handleStop}
                    disabled={isProcessing}
                    variant="outline"
                    className="font-medium border-gray-300 text-gray-900 hover:bg-gray-50"
                  >
                    <div className="w-3 h-3 mr-2 bg-gray-900" />
                    Stop Recording
                  </Button>

                  <Badge className={`${modeColor} text-white border-0`}>
                    {modeLabel}
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-sm font-mono border-gray-300 bg-gray-50">
                    {formatDuration(recordingDuration)}
                  </Badge>

                  {bufferStatus.accelerometer > 0 && (
                    <Badge variant="outline" className="text-xs border-gray-300">
                      Accel: {bufferStatus.accelerometer}
                    </Badge>
                  )}

                  {bufferStatus.gps > 0 && (
                    <Badge variant="outline" className="text-xs border-gray-300">
                      GPS: {bufferStatus.gps}
                    </Badge>
                  )}

                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${modeColor} animate-pulse`} />
                    <span className="text-sm text-gray-500">Recording</span>
                  </div>
                </div>
              </>
            )}
          </div>

      {recordingError && (
        <Alert variant="destructive" className="text-sm border-red-200 bg-red-50 text-red-600">
          {recordingError}
        </Alert>
      )}
    </div>
  );
}
