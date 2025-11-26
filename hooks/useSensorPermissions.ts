'use client';

import { useState, useCallback } from 'react';
import { SensorPermissions, PermissionState } from '@/types/permissions';

// Extend DeviceMotionEvent type for iOS 13+ permission request
declare global {
  interface DeviceMotionEvent {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  }
  interface DeviceOrientationEvent {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  }
}

export function useSensorPermissions() {
  const [permissions, setPermissions] = useState<SensorPermissions>({
    motion: 'pending',
    location: 'pending',
  });
  const [error, setError] = useState<string | null>(null);

  const requestMotionPermission = useCallback(async (): Promise<PermissionState> => {
    try {
      // Check if DeviceMotionEvent is supported
      if (typeof DeviceMotionEvent === 'undefined') {
        return 'unsupported';
      }

      // iOS 13+ requires permission request
      // Type assertion needed for iOS-specific API
      const DeviceMotionEventAny = DeviceMotionEvent as any;
      if (typeof DeviceMotionEventAny.requestPermission === 'function') {
        const permission = await DeviceMotionEventAny.requestPermission();
        return permission === 'granted' ? 'granted' : 'denied';
      }

      // For non-iOS browsers, permission is implicit
      return 'granted';
    } catch (err) {
      console.error('Error requesting motion permission:', err);
      setError('Failed to request motion permission');
      return 'denied';
    }
  }, []);

  const requestLocationPermission = useCallback(async (): Promise<PermissionState> => {
    try {
      // Check if Geolocation is supported
      if (!navigator.geolocation) {
        return 'unsupported';
      }

      // For geolocation, we test access by requesting position
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve('granted'),
          (error) => {
            if (error.code === error.PERMISSION_DENIED) {
              resolve('denied');
            } else {
              resolve('denied');
            }
          },
          { timeout: 5000 }
        );
      });
    } catch (err) {
      console.error('Error requesting location permission:', err);
      setError('Failed to request location permission');
      return 'denied';
    }
  }, []);

  const requestAllPermissions = useCallback(async () => {
    setError(null);

    const motionState = await requestMotionPermission();
    const locationState = await requestLocationPermission();

    setPermissions({
      motion: motionState,
      location: locationState,
    });

    if (motionState === 'denied' || locationState === 'denied') {
      setError('Some permissions were denied. Please enable them in your browser settings.');
    }
  }, [requestMotionPermission, requestLocationPermission]);

  return {
    permissions,
    requestAllPermissions,
    error,
  };
}
