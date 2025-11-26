export const SENSOR_CONFIG = {
  ACCELEROMETER_INTERVAL: 200, // 5 Hz (reduced from 10Hz for better performance)
  GPS_INTERVAL: 1000,           // 1 Hz
  MAX_HISTORY_LENGTH: 50,
  DEFAULT_MAP_ZOOM: 15,
  MAP_PAN_THROTTLE: 1000,       // Throttle map panning to 1 second
  // GPS calculation thresholds
  GPS_MIN_DISTANCE_FOR_HEADING: 2,     // meters
  GPS_MIN_TIME_FOR_CALCULATION: 1000,  // milliseconds
  GPS_MAX_ACCURACY_FOR_REFERENCE: 50,  // meters
} as const;
