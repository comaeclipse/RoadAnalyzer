import { BaselineCalibration } from '@/components/calibration/BaselineCalibration';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function CalibrationPage() {
  return (
    <div className="container mx-auto p-4 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Dashboard
        </Link>

        <h1 className="text-3xl font-bold mb-2">Sensor Baseline Calibration</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Establish sensor noise floor and bias for improved recording accuracy
        </p>
      </div>

      {/* Calibration Component */}
      <BaselineCalibration />

      {/* Info Section */}
      <div className="mt-8 p-6 bg-gray-50 dark:bg-gray-900 rounded-lg">
        <h2 className="text-lg font-semibold mb-3">What is Baseline Calibration?</h2>
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Baseline calibration measures your device's accelerometer when completely still.
            This helps us understand:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong>Sensor noise floor</strong> - The minimum detectable vibration level</li>
            <li><strong>Sensor bias</strong> - Any systematic error in measurements</li>
            <li><strong>Gravity accuracy</strong> - How well the sensor measures Earth's gravity (9.8 m/s²)</li>
            <li><strong>Overall sensor quality</strong> - Health check for your device's sensors</li>
          </ul>

          <h3 className="font-semibold mt-4">Why is this useful?</h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Filters out sensor noise from real road vibrations</li>
            <li>Improves roughness detection accuracy</li>
            <li>Establishes a quality baseline for your specific device</li>
            <li>Helps diagnose sensor issues</li>
          </ul>

          <h3 className="font-semibold mt-4">When should I calibrate?</h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>When first using the app</li>
            <li>After a device restart or iOS update</li>
            <li>If you notice unusual readings during drives</li>
            <li>Every 1-2 weeks for best accuracy</li>
          </ul>

          <h3 className="font-semibold mt-4">Tips for best results:</h3>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Use a solid surface (wood/stone table, not bed/couch)</li>
            <li>Ensure surface is perfectly level</li>
            <li>Record in a quiet area away from vibrations</li>
            <li>Keep the device still for the entire duration</li>
            <li>Aim for 15-20 seconds of recording</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
