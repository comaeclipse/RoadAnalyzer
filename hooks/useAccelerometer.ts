'use client';

import { useState, useEffect, useCallback } from 'react';
import { AccelerometerData } from '@/types/sensors';
import { truncateHistory, throttle } from '@/lib/sensor-utils';
import { SENSOR_CONFIG } from '@/lib/constants';

export function useAccelerometer(enabled: boolean) {
  const [data, setData] = useState<AccelerometerData | null>(null);
  const [history, setHistory] = useState<AccelerometerData[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleMotionEvent = useCallback(
    throttle((event: DeviceMotionEvent) => {
      const acceleration = event.acceleration || event.accelerationIncludingGravity;

      if (acceleration && acceleration.x !== null && acceleration.y !== null && acceleration.z !== null) {
        const newData: AccelerometerData = {
          x: acceleration.x,
          y: acceleration.y,
          z: acceleration.z,
          timestamp: Date.now(),
        };

        setData(newData);
        setHistory((prev) => truncateHistory([...prev, newData]));
      }
    }, SENSOR_CONFIG.ACCELEROMETER_INTERVAL),
    []
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Check if DeviceMotionEvent is supported
    if (typeof DeviceMotionEvent === 'undefined') {
      setError('Device motion is not supported on this device');
      return;
    }

    window.addEventListener('devicemotion', handleMotionEvent);

    return () => {
      window.removeEventListener('devicemotion', handleMotionEvent);
    };
  }, [enabled, handleMotionEvent]);

  const clear = useCallback(() => {
    setData(null);
    setHistory([]);
    setError(null);
  }, []);

  return {
    data,
    history,
    error,
    clear,
  };
}
