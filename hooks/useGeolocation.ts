'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GPSData } from '@/types/sensors';
import { truncateHistory } from '@/lib/sensor-utils';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

export function useGeolocation(enabled: boolean) {
  const [data, setData] = useState<GPSData | null>(null);
  const [history, setHistory] = useState<GPSData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
        
        const newData: GPSData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          heading: position.coords.heading,
          accuracy: position.coords.accuracy,
          timestamp: Date.now(),
        };

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
