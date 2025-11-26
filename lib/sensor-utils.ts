import { AccelerometerData } from "@/types/sensors";
import { SENSOR_CONFIG } from "./constants";

export function truncateHistory<T>(history: T[], maxLength: number = SENSOR_CONFIG.MAX_HISTORY_LENGTH): T[] {
  if (history.length > maxLength) {
    return history.slice(-maxLength);
  }
  return history;
}

export function calculateMagnitude(data: AccelerometerData): number {
  return Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
}

export function throttle<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
}
