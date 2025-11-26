'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSensorPermissions } from '@/hooks/useSensorPermissions';
import { useAccelerometer } from '@/hooks/useAccelerometer';
import { useGeolocation } from '@/hooks/useGeolocation';
import { SensorPermissions } from '@/types/permissions';
import { AccelerometerData, GPSData, VisualizationMode } from '@/types/sensors';

interface SensorContextType {
  permissions: SensorPermissions;
  requestAllPermissions: () => Promise<void>;
  permissionError: string | null;
  accelerometer: {
    data: AccelerometerData | null;
    history: AccelerometerData[];
    error: string | null;
  };
  gps: {
    data: GPSData | null;
    history: GPSData[];
    error: string | null;
  };
  mode: VisualizationMode;
  setMode: (mode: VisualizationMode) => void;
  isEnabled: boolean;
  setIsEnabled: (enabled: boolean) => void;
}

const SensorContext = createContext<SensorContextType | undefined>(undefined);

export function SensorProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<VisualizationMode>('numeric');
  const [isEnabled, setIsEnabled] = useState(false);

  const {
    permissions,
    requestAllPermissions,
    error: permissionError,
  } = useSensorPermissions();

  const accelerometer = useAccelerometer(isEnabled);
  const gps = useGeolocation(isEnabled);

  // Auto-enable sensors when permissions are granted
  useEffect(() => {
    if (permissions.motion === 'granted' && permissions.location === 'granted') {
      setIsEnabled(true);
    }
  }, [permissions]);

  const value: SensorContextType = {
    permissions,
    requestAllPermissions,
    permissionError,
    accelerometer: {
      data: accelerometer.data,
      history: accelerometer.history,
      error: accelerometer.error,
    },
    gps: {
      data: gps.data,
      history: gps.history,
      error: gps.error,
    },
    mode,
    setMode,
    isEnabled,
    setIsEnabled,
  };

  return (
    <SensorContext.Provider value={value}>
      {children}
    </SensorContext.Provider>
  );
}

export function useSensorContext() {
  const context = useContext(SensorContext);
  if (context === undefined) {
    throw new Error('useSensorContext must be used within a SensorProvider');
  }
  return context;
}
