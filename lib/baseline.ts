/**
 * Sensor Baseline Calibration
 *
 * Analyzes accelerometer and gyroscope stability when device is stationary
 * on a flat, hard surface. Establishes noise floor and sensor bias.
 */

export interface BaselineData {
  timestamp: number;
  duration: number; // milliseconds
  sampleCount: number;

  // Accelerometer analysis
  accelerometer: {
    mean: { x: number; y: number; z: number };
    stdDev: { x: number; y: number; z: number };
    bias: { x: number; y: number; z: number }; // Deviation from expected (0, 0, 9.8)
    noiseLevel: number; // Overall noise magnitude
    stability: 'excellent' | 'good' | 'fair' | 'poor';
  };

  // Expected vs actual
  expectedGravity: number; // Should be ~9.8 m/s²
  measuredGravity: number; // Actual Z-axis mean
  gravityError: number;    // Difference

  // Quality assessment
  quality: {
    score: number; // 0-100
    issues: string[];
    recommendations: string[];
  };
}

interface SensorSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

const EXPECTED_GRAVITY = 9.80665; // m/s² at sea level

/**
 * Calculate mean of sensor readings
 */
function calculateMean(samples: SensorSample[]): { x: number; y: number; z: number } {
  const sum = samples.reduce(
    (acc, s) => ({ x: acc.x + s.x, y: acc.y + s.y, z: acc.z + s.z }),
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: sum.x / samples.length,
    y: sum.y / samples.length,
    z: sum.z / samples.length,
  };
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(
  samples: SensorSample[],
  mean: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  const variance = samples.reduce(
    (acc, s) => ({
      x: acc.x + Math.pow(s.x - mean.x, 2),
      y: acc.y + Math.pow(s.y - mean.y, 2),
      z: acc.z + Math.pow(s.z - mean.z, 2),
    }),
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: Math.sqrt(variance.x / samples.length),
    y: Math.sqrt(variance.y / samples.length),
    z: Math.sqrt(variance.z / samples.length),
  };
}

/**
 * Calculate overall noise level (RMS of all axes)
 */
function calculateNoiseLevel(stdDev: { x: number; y: number; z: number }): number {
  return Math.sqrt(stdDev.x ** 2 + stdDev.y ** 2 + stdDev.z ** 2);
}

/**
 * Assess stability based on noise level
 */
function assessStability(noiseLevel: number): BaselineData['accelerometer']['stability'] {
  if (noiseLevel < 0.01) return 'excellent';
  if (noiseLevel < 0.05) return 'good';
  if (noiseLevel < 0.1) return 'fair';
  return 'poor';
}

/**
 * Calculate quality score and provide recommendations
 */
function assessQuality(
  noiseLevel: number,
  gravityError: number,
  sampleCount: number,
  duration: number
): BaselineData['quality'] {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Check noise level
  if (noiseLevel > 0.1) {
    issues.push('High noise level detected');
    recommendations.push('Ensure device is on a completely stable, hard surface');
    score -= 30;
  } else if (noiseLevel > 0.05) {
    issues.push('Moderate noise level');
    recommendations.push('Try placing device on a more stable surface');
    score -= 15;
  }

  // Check gravity measurement
  if (Math.abs(gravityError) > 0.5) {
    issues.push('Large gravity measurement error');
    recommendations.push('Ensure device is completely flat (use a level if available)');
    score -= 25;
  } else if (Math.abs(gravityError) > 0.2) {
    issues.push('Moderate gravity measurement error');
    recommendations.push('Adjust device to be more level');
    score -= 10;
  }

  // Check sample count
  if (sampleCount < 100) {
    issues.push('Insufficient samples collected');
    recommendations.push('Record for at least 10 seconds');
    score -= 20;
  }

  // Check duration
  if (duration < 10000) {
    issues.push('Recording too short');
    recommendations.push('Record for at least 10-15 seconds for accurate results');
    score -= 15;
  }

  if (score === 100) {
    recommendations.push('Excellent baseline! Sensor is performing optimally.');
  }

  return {
    score: Math.max(0, score),
    issues,
    recommendations,
  };
}

/**
 * Analyze baseline sensor data
 */
export function analyzeBaseline(samples: SensorSample[]): BaselineData | null {
  if (samples.length < 10) {
    return null; // Not enough data
  }

  // Calculate timing
  const timestamps = samples.map(s => s.timestamp);
  const startTime = Math.min(...timestamps);
  const endTime = Math.max(...timestamps);
  const duration = endTime - startTime;

  // Calculate accelerometer statistics
  const mean = calculateMean(samples);
  const stdDev = calculateStdDev(samples, mean);
  const noiseLevel = calculateNoiseLevel(stdDev);

  // Calculate bias (expected values: x=0, y=0, z=9.8)
  const bias = {
    x: mean.x - 0,
    y: mean.y - 0,
    z: mean.z - EXPECTED_GRAVITY,
  };

  // Measured gravity (should be close to 9.8 m/s²)
  const measuredGravity = Math.abs(mean.z);
  const gravityError = measuredGravity - EXPECTED_GRAVITY;

  // Assess quality
  const quality = assessQuality(noiseLevel, gravityError, samples.length, duration);

  return {
    timestamp: Date.now(),
    duration,
    sampleCount: samples.length,

    accelerometer: {
      mean,
      stdDev,
      bias,
      noiseLevel,
      stability: assessStability(noiseLevel),
    },

    expectedGravity: EXPECTED_GRAVITY,
    measuredGravity,
    gravityError,

    quality,
  };
}

/**
 * Get human-readable stability description
 */
export function getStabilityDescription(stability: BaselineData['accelerometer']['stability']): string {
  const descriptions = {
    excellent: 'Sensor is extremely stable with minimal noise',
    good: 'Sensor is stable with acceptable noise levels',
    fair: 'Sensor has moderate noise - consider recalibrating',
    poor: 'Sensor has high noise - check device placement',
  };
  return descriptions[stability];
}

/**
 * Get color for quality score
 */
export function getQualityColor(score: number): string {
  if (score >= 90) return '#22c55e'; // green
  if (score >= 75) return '#84cc16'; // lime
  if (score >= 60) return '#eab308'; // yellow
  if (score >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
}

/**
 * Format baseline for display
 */
export function formatBaselineReport(baseline: BaselineData): string {
  return `
SENSOR BASELINE CALIBRATION REPORT
Generated: ${new Date(baseline.timestamp).toLocaleString()}

RECORDING INFO:
  Duration: ${(baseline.duration / 1000).toFixed(1)}s
  Samples: ${baseline.sampleCount}
  Sample Rate: ${(baseline.sampleCount / (baseline.duration / 1000)).toFixed(1)} Hz

ACCELEROMETER ANALYSIS:
  Mean Values:
    X: ${baseline.accelerometer.mean.x.toFixed(4)} m/s²
    Y: ${baseline.accelerometer.mean.y.toFixed(4)} m/s²
    Z: ${baseline.accelerometer.mean.z.toFixed(4)} m/s²

  Standard Deviation (Noise):
    X: ${baseline.accelerometer.stdDev.x.toFixed(4)} m/s²
    Y: ${baseline.accelerometer.stdDev.y.toFixed(4)} m/s²
    Z: ${baseline.accelerometer.stdDev.z.toFixed(4)} m/s²

  Bias (Deviation from Expected):
    X: ${baseline.accelerometer.bias.x.toFixed(4)} m/s² (expected: 0)
    Y: ${baseline.accelerometer.bias.y.toFixed(4)} m/s² (expected: 0)
    Z: ${baseline.accelerometer.bias.z.toFixed(4)} m/s² (expected: ${EXPECTED_GRAVITY})

  Overall Noise Level: ${baseline.accelerometer.noiseLevel.toFixed(4)} m/s²
  Stability: ${baseline.accelerometer.stability.toUpperCase()}

GRAVITY MEASUREMENT:
  Expected: ${baseline.expectedGravity.toFixed(4)} m/s²
  Measured: ${baseline.measuredGravity.toFixed(4)} m/s²
  Error: ${baseline.gravityError.toFixed(4)} m/s² (${((baseline.gravityError / baseline.expectedGravity) * 100).toFixed(2)}%)

QUALITY ASSESSMENT:
  Overall Score: ${baseline.quality.score}/100

  ${baseline.quality.issues.length > 0 ? 'Issues Detected:\n    - ' + baseline.quality.issues.join('\n    - ') : 'No issues detected'}

  Recommendations:
    - ${baseline.quality.recommendations.join('\n    - ')}

STATUS: ${baseline.quality.score >= 80 ? '✅ PASSED' : baseline.quality.score >= 60 ? '⚠️ ACCEPTABLE' : '❌ NEEDS IMPROVEMENT'}
  `.trim();
}

/**
 * Save baseline to localStorage
 */
export function saveBaseline(baseline: BaselineData): void {
  localStorage.setItem('sensor-baseline', JSON.stringify(baseline));
  localStorage.setItem('sensor-baseline-timestamp', baseline.timestamp.toString());
}

/**
 * Load baseline from localStorage
 */
export function loadBaseline(): BaselineData | null {
  const stored = localStorage.getItem('sensor-baseline');
  if (!stored) return null;

  try {
    return JSON.parse(stored) as BaselineData;
  } catch {
    return null;
  }
}

/**
 * Check if baseline is expired (older than 7 days)
 */
export function isBaselineExpired(baseline: BaselineData): boolean {
  const age = Date.now() - baseline.timestamp;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return age > sevenDays;
}

/**
 * Apply baseline correction to a sensor reading
 */
export function applyBaselineCorrection(
  reading: { x: number; y: number; z: number },
  baseline: BaselineData
): { x: number; y: number; z: number } {
  return {
    x: reading.x - baseline.accelerometer.bias.x,
    y: reading.y - baseline.accelerometer.bias.y,
    z: reading.z - baseline.accelerometer.bias.z,
  };
}
