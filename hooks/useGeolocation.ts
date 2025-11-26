'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GPSData } from '@/types/sensors';
import { truncateHistory, calculateDistance, calculateBearing, calculateSpeed } from '@/lib/sensor-utils';
import { SENSOR_CONFIG } from '@/lib/constants';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

export function useGeolocation(enabled: boolean) {
  const [data, setData] = useState<GPSData | null>(null);
  const [history, setHistory] = useState<GPSData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPositionRef = useRef<{ lat: number; lon: number; timestamp: number } | null>(null);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const startWatching = useCallback(() => {
    // Check if Geolocation is supported
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device');
      return;
    }

    // Clear any existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        // Success - reset retry count
        retryCountRef.current = 0;

        let calculatedSpeed: number | null = position.coords.speed;
        let calculatedHeading: number | null = position.coords.heading;

        // If native speed/heading not available, calculate from previous position
        if (previousPositionRef.current &&
            (position.coords.speed === null || position.coords.heading === null)) {

          const prev = previousPositionRef.current;
          const timeDelta = Date.now() - prev.timestamp;

          // Only calculate if enough time has passed
          if (timeDelta >= SENSOR_CONFIG.GPS_MIN_TIME_FOR_CALCULATION) {
            const distance = calculateDistance(
              prev.lat,
              prev.lon,
              position.coords.latitude,
              position.coords.longitude
            );

            // Only calculate speed/heading if moved enough (reduces GPS jitter)
            if (distance >= SENSOR_CONFIG.GPS_MIN_DISTANCE_FOR_HEADING) {
              if (position.coords.speed === null) {
                calculatedSpeed = calculateSpeed(distance, timeDelta);
              }

              if (position.coords.heading === null) {
                calculatedHeading = calculateBearing(
                  prev.lat,
                  prev.lon,
                  position.coords.latitude,
                  position.coords.longitude
                );
              }
            }
          }
        }

        const newData: GPSData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          speed: calculatedSpeed,
          heading: calculatedHeading,
          accuracy: position.coords.accuracy,
          timestamp: Date.now(),
        };

        // Update previous position for next calculation
        // Only update if accuracy is good to avoid bad reference points
        if (position.coords.accuracy < SENSOR_CONFIG.GPS_MAX_ACCURACY_FOR_REFERENCE) {
          previousPositionRef.current = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            timestamp: Date.now(),
          };
        }

        setData(newData);
        setHistory((prev) => truncateHistory([...prev, newData]));
        setError(null);
      },
      (err) => {
        console.error('Geolocation error:', err.code, err.message);
        
        // Handle kCLErrorDomain error 0 and other temporary failures with retry
        const isTemporaryError = err.code === 0 || 
          err.code === GeolocationPositionError.TIMEOUT ||
          err.message.includes('kCLErrorDomain');
        
        if (isTemporaryError && retryCountRef.current < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCountRef.current] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
          retryCountRef.current++;
          
          console.log(`GPS retry ${retryCountRef.current}/${MAX_RETRIES} in ${delay}ms`);
          
          // Clear current watch and retry after delay
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
          
          clearRetryTimeout();
          retryTimeoutRef.current = setTimeout(() => {
            startWatching();
          }, delay);
        } else {
          // Max retries exceeded or non-recoverable error
          setError(err.message || 'Unable to get location');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000, // Increased timeout for better reliability
      }
    );

    watchIdRef.current = id;
  }, [clearRetryTimeout]);

  useEffect(() => {
    if (!enabled) {
      // Clean up when disabled
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      clearRetryTimeout();
      retryCountRef.current = 0;
      return;
    }

    startWatching();

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      clearRetryTimeout();
    };
  }, [enabled, startWatching, clearRetryTimeout]);

  const clear = useCallback(() => {
    setData(null);
    setHistory([]);
    setError(null);
    retryCountRef.current = 0;
    previousPositionRef.current = null;
    clearRetryTimeout();
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, [clearRetryTimeout]);

  return {
    data,
    history,
    error,
    clear,
  };
}
