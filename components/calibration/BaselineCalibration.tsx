'use client';

import { useState, useEffect, useRef } from 'react';
import { useSensorContext } from '@/components/providers/SensorProvider';
import { analyzeBaseline, saveBaseline, loadBaseline, formatBaselineReport, getQualityColor, type BaselineData } from '@/lib/baseline';
import { AccelerometerData } from '@/types/sensors';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Square, Download, AlertCircle, CheckCircle, Info } from 'lucide-react';

export function BaselineCalibration() {
  const { accelerometer, isEnabled } = useSensorContext();
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [baseline, setBaseline] = useState<BaselineData | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<BaselineData | null>(null);

  const samplesRef = useRef<AccelerometerData[]>([]);
  const startTimeRef = useRef<number | null>(null);

  // Load saved baseline on mount
  useEffect(() => {
    const saved = loadBaseline();
    setSavedBaseline(saved);
  }, []);

  // Collect samples during recording
  useEffect(() => {
    if (!isRecording || !isEnabled || !accelerometer.data) return;

    samplesRef.current.push(accelerometer.data);
  }, [accelerometer.data, isRecording, isEnabled]);

  // Update recording duration
  useEffect(() => {
    if (!isRecording || !startTimeRef.current) return;

    const interval = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - startTimeRef.current!) / 1000));
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording]);

  const startRecording = () => {
    if (!isEnabled) {
      alert('Please enable sensors first');
      return;
    }

    // 3-second countdown
    setCountdown(3);
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownInterval);
          // Start actual recording
          samplesRef.current = [];
          startTimeRef.current = Date.now();
          setIsRecording(true);
          setCountdown(null);
          setBaseline(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    setIsRecording(false);
    setRecordingDuration(0);

    // Analyze collected samples
    const result = analyzeBaseline(samplesRef.current);

    if (result) {
      setBaseline(result);

      // Auto-save if quality is good
      if (result.quality.score >= 75) {
        saveBaseline(result);
        setSavedBaseline(result);
      }
    } else {
      alert('Not enough data collected. Please record for at least 10 seconds.');
    }

    samplesRef.current = [];
    startTimeRef.current = null;
  };

  const downloadReport = () => {
    if (!baseline) return;

    const report = formatBaselineReport(baseline);
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baseline-calibration-${baseline.timestamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const manualSave = () => {
    if (!baseline) return;
    saveBaseline(baseline);
    setSavedBaseline(baseline);
    alert('Baseline saved successfully!');
  };

  return (
    <div className="space-y-6">
      {/* Instructions Card */}
      <Card className="p-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <div className="flex gap-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              How to Record Baseline
            </h3>
            <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-decimal list-inside">
              <li>Place your phone on a flat, stable, hard surface (e.g., table, countertop)</li>
              <li>Ensure the surface is completely level</li>
              <li>Do not touch or move the device during recording</li>
              <li>Record for at least 15 seconds for accurate results</li>
              <li>Avoid areas with vibrations (appliances, traffic, etc.)</li>
            </ol>
          </div>
        </div>
      </Card>

      {/* Current Status Card */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recording Status</h3>

        {countdown !== null && (
          <div className="text-center py-12">
            <div className="text-6xl font-bold text-blue-600 dark:text-blue-400 mb-4">
              {countdown}
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Get ready... Do not move the device!
            </p>
          </div>
        )}

        {isRecording && (
          <div className="space-y-4">
            <div className="text-center py-8">
              <div className="text-5xl font-bold text-green-600 dark:text-green-400 mb-2">
                {recordingDuration.toFixed(1)}s
              </div>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Recording... Keep device still!
              </p>
              <div className="text-sm text-gray-500">
                Samples collected: {samplesRef.current.length}
              </div>

              {/* Pulsing indicator */}
              <div className="flex justify-center mt-4">
                <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse"></div>
              </div>
            </div>

            <Button
              onClick={stopRecording}
              variant="outline"
              className="w-full"
              disabled={recordingDuration < 5}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop Recording {recordingDuration < 10 && `(wait ${10 - recordingDuration}s)`}
            </Button>
          </div>
        )}

        {!isRecording && countdown === null && (
          <div>
            <Button
              onClick={startRecording}
              disabled={!isEnabled}
              className="w-full"
              size="lg"
            >
              <Play className="w-5 h-5 mr-2" />
              Start Baseline Recording
            </Button>
            {!isEnabled && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2 text-center">
                Sensors are not enabled. Please enable them first.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Results Card */}
      {baseline && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Calibration Results</h3>
            <div className="flex gap-2">
              <Button onClick={downloadReport} variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Download Report
              </Button>
              {baseline.quality.score < 75 && (
                <Button onClick={manualSave} variant="outline" size="sm">
                  Save Anyway
                </Button>
              )}
            </div>
          </div>

          {/* Quality Score */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Quality Score</span>
              <span className="text-2xl font-bold" style={{ color: getQualityColor(baseline.quality.score) }}>
                {baseline.quality.score}/100
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${baseline.quality.score}%`,
                  backgroundColor: getQualityColor(baseline.quality.score),
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {baseline.quality.score >= 80 ? '✅ Excellent calibration' :
               baseline.quality.score >= 60 ? '⚠️ Acceptable calibration' :
               '❌ Poor calibration - please retry'}
            </p>
          </div>

          {/* Statistics Grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Duration</div>
              <div className="text-lg font-semibold">{(baseline.duration / 1000).toFixed(1)}s</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Samples</div>
              <div className="text-lg font-semibold">{baseline.sampleCount}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Noise Level</div>
              <div className="text-lg font-semibold">{baseline.accelerometer.noiseLevel.toFixed(4)} m/s²</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Stability</div>
              <div className="text-lg font-semibold capitalize">{baseline.accelerometer.stability}</div>
            </div>
          </div>

          {/* Accelerometer Readings */}
          <div className="mb-6">
            <h4 className="text-sm font-semibold mb-3">Accelerometer Readings</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">X-axis (lateral):</span>
                <span className="font-mono">
                  {baseline.accelerometer.mean.x.toFixed(4)} m/s²
                  <span className="text-xs text-gray-500 ml-2">
                    (±{baseline.accelerometer.stdDev.x.toFixed(4)})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Y-axis (longitudinal):</span>
                <span className="font-mono">
                  {baseline.accelerometer.mean.y.toFixed(4)} m/s²
                  <span className="text-xs text-gray-500 ml-2">
                    (±{baseline.accelerometer.stdDev.y.toFixed(4)})
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Z-axis (vertical):</span>
                <span className="font-mono">
                  {baseline.accelerometer.mean.z.toFixed(4)} m/s²
                  <span className="text-xs text-gray-500 ml-2">
                    (±{baseline.accelerometer.stdDev.z.toFixed(4)})
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Gravity Check */}
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4 className="text-sm font-semibold mb-2">Gravity Measurement</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Expected:</span>
                <span className="font-mono">{baseline.expectedGravity.toFixed(4)} m/s²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Measured:</span>
                <span className="font-mono">{baseline.measuredGravity.toFixed(4)} m/s²</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Error:</span>
                <span className={`font-mono ${Math.abs(baseline.gravityError) < 0.2 ? 'text-green-600' : 'text-orange-600'}`}>
                  {baseline.gravityError > 0 ? '+' : ''}{baseline.gravityError.toFixed(4)} m/s²
                  ({((baseline.gravityError / baseline.expectedGravity) * 100).toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Issues and Recommendations */}
          {baseline.quality.issues.length > 0 && (
            <div className="mb-4 p-4 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
              <div className="flex gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-100">
                  Issues Detected
                </h4>
              </div>
              <ul className="text-sm text-orange-800 dark:text-orange-200 space-y-1 list-disc list-inside">
                {baseline.quality.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {baseline.quality.recommendations.length > 0 && (
            <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Recommendations
                </h4>
              </div>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                {baseline.quality.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Saved Baseline Card */}
      {savedBaseline && !baseline && (
        <Card className="p-6 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
          <div className="flex gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
                Saved Baseline Available
              </h3>
              <div className="text-sm text-green-800 dark:text-green-200 space-y-1">
                <p>Quality Score: {savedBaseline.quality.score}/100</p>
                <p>Noise Level: {savedBaseline.accelerometer.noiseLevel.toFixed(4)} m/s²</p>
                <p>Recorded: {new Date(savedBaseline.timestamp).toLocaleString()}</p>
                <p className="text-xs pt-2">
                  This baseline will be used to improve recording accuracy.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
