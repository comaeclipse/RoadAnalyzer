/**
 * Speed Analysis Utilities
 *
 * Provides color mapping for GPS speed data visualization.
 * Converts speed (m/s) to color gradients for traffic heatmaps.
 */

/**
 * Get color based on speed value
 *
 * Maps speed to a 6-tier color gradient:
 * - 0-5 mph: Red (stopped/gridlock)
 * - 6-10 mph: Orange (very slow)
 * - 11-20 mph: Yellow (slow)
 * - 21-30 mph: Lime (moderate)
 * - 31-45 mph: Green (normal)
 * - 46+ mph: Dark green (highway)
 *
 * @param mps Speed in meters per second (from GPS data)
 * @returns Hex color code
 */
export function getSpeedColor(mps: number | null): string {
  if (mps === null || mps === undefined) return '#6b7280'; // gray - no data

  const mph = mps * 2.237; // Convert m/s to mph

  if (mph < 5) return '#ef4444';   // red - stopped/gridlock
  if (mph < 10) return '#f97316';  // orange - very slow
  if (mph < 20) return '#eab308';  // yellow - slow
  if (mph < 30) return '#84cc16';  // lime - moderate
  if (mph < 45) return '#22c55e';  // green - normal
  return '#16a34a';                 // dark green - highway
}

/**
 * Get human-readable label for speed
 *
 * @param mph Speed in miles per hour
 * @returns Speed category label
 */
export function getSpeedLabel(mph: number): string {
  if (mph < 5) return 'Stopped';
  if (mph < 10) return 'Very Slow';
  if (mph < 20) return 'Slow';
  if (mph < 30) return 'Moderate';
  if (mph < 45) return 'Normal';
  return 'Highway';
}

/**
 * Get color category for speed (for legends/summaries)
 *
 * @param mps Speed in meters per second
 * @returns Color category ('red', 'yellow', 'green', or 'gray')
 */
export function getSpeedCategory(mps: number | null): string {
  if (mps === null || mps === undefined) return 'gray';

  const mph = mps * 2.237;

  if (mph < 10) return 'red';      // stopped/very slow
  if (mph < 30) return 'yellow';   // slow/moderate
  return 'green';                   // normal/highway
}
