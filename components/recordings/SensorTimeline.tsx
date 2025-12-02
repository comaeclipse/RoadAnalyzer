'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface AccelPoint {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

interface SensorTimelineProps {
  accelPoints: AccelPoint[];
  gpsPoints: GpsPoint[];
  startTime: number;
}

export function SensorTimeline({ accelPoints, gpsPoints, startTime }: SensorTimelineProps) {
  const chartData = useMemo(() => {
    // Combine and normalize data by relative time
    const data: { time: number; magnitude?: number; speed?: number }[] = [];

    // Add accelerometer data
    accelPoints.forEach((point) => {
      const relativeTime = (point.timestamp - startTime) / 1000; // seconds
      data.push({
        time: relativeTime,
        magnitude: point.magnitude,
      });
    });

    // Add GPS speed data
    gpsPoints.forEach((point) => {
      if (point.speed !== null) {
        const relativeTime = (point.timestamp - startTime) / 1000;
        // Find existing entry or create new
        const existing = data.find((d) => Math.abs(d.time - relativeTime) < 0.5);
        if (existing) {
          existing.speed = point.speed * 2.237; // Convert m/s to mph
        } else {
          data.push({
            time: relativeTime,
            speed: point.speed * 2.237,
          });
        }
      }
    });

    // Sort by time
    data.sort((a, b) => a.time - b.time);

    return data;
  }, [accelPoints, gpsPoints, startTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (chartData.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-gray-200">
        No sensor data available
      </div>
    );
  }

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="time"
            tickFormatter={formatTime}
            stroke="#9ca3af"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke="#9ca3af"
            fontSize={12}
            tickLine={false}
            label={{ value: 'Accel (m/s²)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#9ca3af"
            fontSize={12}
            tickLine={false}
            label={{ value: 'Speed (mph)', angle: 90, position: 'insideRight', fontSize: 11, fill: '#9ca3af' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(value: number, name: string) => [
              name === 'magnitude' ? `${value.toFixed(2)} m/s²` : `${value.toFixed(1)} mph`,
              name === 'magnitude' ? 'Acceleration' : 'Speed',
            ]}
            labelFormatter={(label) => `Time: ${formatTime(label as number)}`}
          />
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            formatter={(value) => (value === 'magnitude' ? 'Acceleration' : 'Speed')}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="magnitude"
            stroke="#374151"
            strokeWidth={1.5}
            dot={false}
            name="magnitude"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="speed"
            stroke="#6b7280"
            strokeWidth={1.5}
            dot={false}
            name="speed"
            strokeDasharray="5 5"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

