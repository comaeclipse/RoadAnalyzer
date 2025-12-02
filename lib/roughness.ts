/**
 * Road Roughness Analysis
 * 
 * Analyzes accelerometer Z-axis data to assess road surface quality.
 * Uses rolling standard deviation of vertical acceleration to detect bumps/vibrations.
 */

export interface AccelSample {
  x: number;
  y: number;
  z: number;
  timestamp: number | bigint;
}

export interface RoughnessBreakdown {
  smooth: number;      // % of samples < 0.5 std dev
  light: number;       // % of samples 0.5-1.5
  moderate: number;    // % of samples 1.5-3.0
  rough: number;       // % of samples 3.0-5.0
  veryRough: number;   // % of samples > 5.0
}

export interface RoughnessResult {
  score: number;           // 0-100 (100 = smoothest)
  breakdown: RoughnessBreakdown;
  avgRoughness: number;    // Average std dev value
  maxRoughness: number;    // Peak roughness detected
}

// Roughness thresholds (standard deviation of Z acceleration)
const THRESHOLDS = {
  SMOOTH: 0.5,
  LIGHT: 1.5,
  MODERATE: 3.0,
  ROUGH: 5.0,
};

// Window size for rolling standard deviation (number of samples)
const WINDOW_SIZE = 15;

/**
 * Calculate rolling standard deviation for Z-axis acceleration
 */
function calculateRollingStdDev(samples: AccelSample[]): number[] {
  const stdDevs: number[] = [];
  
  for (let i = 0; i < samples.length; i++) {
    const windowStart = Math.max(0, i - WINDOW_SIZE + 1);
    const window = samples.slice(windowStart, i + 1);
    
    if (window.length < 2) {
      stdDevs.push(0);
      continue;
    }
    
    // Calculate mean Z
    const meanZ = window.reduce((sum, s) => sum + s.z, 0) / window.length;
    
    // Calculate variance
    const variance = window.reduce((sum, s) => sum + Math.pow(s.z - meanZ, 2), 0) / window.length;
    
    // Standard deviation
    stdDevs.push(Math.sqrt(variance));
  }
  
  return stdDevs;
}

/**
 * Categorize a roughness value
 */
function categorizeRoughness(stdDev: number): keyof RoughnessBreakdown {
  if (stdDev < THRESHOLDS.SMOOTH) return 'smooth';
  if (stdDev < THRESHOLDS.LIGHT) return 'light';
  if (stdDev < THRESHOLDS.MODERATE) return 'moderate';
  if (stdDev < THRESHOLDS.ROUGH) return 'rough';
  return 'veryRough';
}

/**
 * Convert roughness breakdown to a 0-100 score
 * 100 = perfectly smooth, 0 = extremely rough
 */
function calculateScore(breakdown: RoughnessBreakdown): number {
  // Weighted scoring: smooth roads get high scores, rough roads get low scores
  const weights = {
    smooth: 100,
    light: 75,
    moderate: 50,
    rough: 25,
    veryRough: 0,
  };
  
  const score = 
    (breakdown.smooth * weights.smooth +
     breakdown.light * weights.light +
     breakdown.moderate * weights.moderate +
     breakdown.rough * weights.rough +
     breakdown.veryRough * weights.veryRough) / 100;
  
  return Math.round(score);
}

/**
 * Analyze accelerometer data and return roughness metrics
 */
export function analyzeRoughness(samples: AccelSample[]): RoughnessResult | null {
  if (samples.length < WINDOW_SIZE) {
    return null; // Not enough data for meaningful analysis
  }
  
  // Calculate rolling standard deviations
  const stdDevs = calculateRollingStdDev(samples);
  
  // Skip the first few samples (incomplete window)
  const validStdDevs = stdDevs.slice(WINDOW_SIZE - 1);
  
  if (validStdDevs.length === 0) {
    return null;
  }
  
  // Count samples in each category
  const counts: RoughnessBreakdown = {
    smooth: 0,
    light: 0,
    moderate: 0,
    rough: 0,
    veryRough: 0,
  };
  
  let totalRoughness = 0;
  let maxRoughness = 0;
  
  for (const stdDev of validStdDevs) {
    const category = categorizeRoughness(stdDev);
    counts[category]++;
    totalRoughness += stdDev;
    maxRoughness = Math.max(maxRoughness, stdDev);
  }
  
  // Convert counts to percentages
  const total = validStdDevs.length;
  const breakdown: RoughnessBreakdown = {
    smooth: Math.round((counts.smooth / total) * 100),
    light: Math.round((counts.light / total) * 100),
    moderate: Math.round((counts.moderate / total) * 100),
    rough: Math.round((counts.rough / total) * 100),
    veryRough: Math.round((counts.veryRough / total) * 100),
  };
  
  // Ensure percentages sum to 100 (fix rounding errors)
  const sum = breakdown.smooth + breakdown.light + breakdown.moderate + breakdown.rough + breakdown.veryRough;
  if (sum !== 100 && sum > 0) {
    // Adjust the largest category
    const largest = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0][0] as keyof RoughnessBreakdown;
    breakdown[largest] += (100 - sum);
  }
  
  return {
    score: calculateScore(breakdown),
    breakdown,
    avgRoughness: totalRoughness / total,
    maxRoughness,
  };
}

/**
 * Get a human-readable label for a roughness score
 */
export function getRoughnessLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Very Poor';
}

/**
 * Get color for roughness score (for UI display)
 */
export function getRoughnessColor(score: number): string {
  if (score >= 90) return '#22c55e'; // green
  if (score >= 75) return '#84cc16'; // lime
  if (score >= 50) return '#eab308'; // yellow
  if (score >= 25) return '#f97316'; // orange
  return '#ef4444'; // red
}

