'use client';

import React, { useMemo } from 'react';
import { useSensorContext } from '@/components/providers/SensorProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export const ChartDisplay = React.memo(function ChartDisplay() {
  const { accelerometer, gps } = useSensorContext();

  // Memoize accelerometer data transformation
  const accelChartData = useMemo(() => {
    return accelerometer.history.map((reading, index) => ({
      index,
      x: Number(reading.x.toFixed(2)),
      y: Number(reading.y.toFixed(2)),
      z: Number(reading.z.toFixed(2)),
    }));
  }, [accelerometer.history]);

  // Memoize GPS data transformation
  const gpsChartData = useMemo(() => {
    return gps.history.map((reading, index) => ({
      index,
      altitude: reading.altitude !== null ? Number(reading.altitude.toFixed(1)) : null,
      speed: reading.speed !== null ? Number((reading.speed * 3.6).toFixed(1)) : null,
    }));
  }, [gps.history]);

  // Memoize tooltip style to prevent recreation on each render
  const tooltipStyle = useMemo(() => ({
    backgroundColor: 'hsl(var(--background))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px'
  }), []);

  return (
    <div className="space-y-6">
      {/* Accelerometer Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Accelerometer History</CardTitle>
          <CardDescription>Real-time X, Y, Z axis readings (m/s²)</CardDescription>
        </CardHeader>
        <CardContent>
          {accelChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={accelChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="index"
                  label={{ value: 'Sample', position: 'insideBottom', offset: -5 }}
                  className="text-xs"
                />
                <YAxis
                  label={{ value: 'm/s²', angle: -90, position: 'insideLeft' }}
                  className="text-xs"
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="x"
                  stroke="#ef4444"
                  dot={false}
                  strokeWidth={2}
                  name="X-Axis"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke="#22c55e"
                  dot={false}
                  strokeWidth={2}
                  name="Y-Axis"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="z"
                  stroke="#3b82f6"
                  dot={false}
                  strokeWidth={2}
                  name="Z-Axis"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <p>Waiting for accelerometer data...</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GPS Chart */}
      <Card>
        <CardHeader>
          <CardTitle>GPS History</CardTitle>
          <CardDescription>Altitude (m) and Speed (km/h) over time</CardDescription>
        </CardHeader>
        <CardContent>
          {gpsChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={gpsChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="index"
                  label={{ value: 'Sample', position: 'insideBottom', offset: -5 }}
                  className="text-xs"
                />
                <YAxis
                  label={{ value: 'Value', angle: -90, position: 'insideLeft' }}
                  className="text-xs"
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="altitude"
                  stroke="#8b5cf6"
                  dot={false}
                  strokeWidth={2}
                  name="Altitude (m)"
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="speed"
                  stroke="#f59e0b"
                  dot={false}
                  strokeWidth={2}
                  name="Speed (km/h)"
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <p>Waiting for GPS data...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
