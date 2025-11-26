'use client';

import { useState, useEffect, useCallback } from 'react';
import { GPSData } from '@/types/sensors';
import { truncateHistory } from '@/lib/sensor-utils';

export function useGeolocation(enabled: boolean) {
  const [data, setData] = useState<GPSData | null>(null);
  const [history, setHistory] = useState<GPSData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        setWatchId(null);
      }
      return;
    }

    // Check if Geolocation is supported
    if (!navigator.geolocation) {
      setError('Geolocation is not supported on this device');
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
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
        console.error('Geolocation error:', err);
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );

    setWatchId(id);

    return () => {
      navigator.geolocation.clearWatch(id);
    };
  }, [enabled, watchId]);

  const clear = useCallback(() => {
    setData(null);
    setHistory([]);
    setError(null);
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }
  }, [watchId]);

  return {
    data,
    history,
    error,
    clear,
  };
}
