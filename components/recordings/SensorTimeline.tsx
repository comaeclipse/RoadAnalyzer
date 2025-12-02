'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface AccelPoint {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

interface SensorTimelineProps {
  accelPoints: AccelPoint[];
  startTime: number;
}

// Calculate rolling standard deviation for roughness
function calculateRoughness(points: AccelPoint[], windowSize: number = 10): { time: number; roughness: number; zAccel: number }[] {
  const result: { time: number; roughness: number; zAccel: number }[] = [];
  
  for (let i = 0; i < points.length; i++) {
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = points.slice(windowStart, i + 1);
    
    // Calculate mean Z
    const meanZ = window.reduce((sum, p) => sum + p.z, 0) / window.length;
    
    // Calculate standard deviation of Z (roughness indicator)
    const variance = window.reduce((sum, p) => sum + Math.pow(p.z - meanZ, 2), 0) / window.length;
    const stdDev = Math.sqrt(variance);
    
    result.push({
      time: points[i].timestamp,
      roughness: stdDev,
      zAccel: Math.abs(points[i].z - 9.8), // Deviation from gravity (1g ≈ 9.8 m/s²)
    });
  }
  
  return result;
}

export function SensorTimeline({ accelPoints, startTime }: SensorTimelineProps) {
  const chartData = useMemo(() => {
    if (accelPoints.length === 0) return [];
    
    const roughnessData = calculateRoughness(accelPoints, 15);
    
    return roughnessData.map((point) => ({
      time: (point.timestamp - startTime) / 1000, // seconds
      roughness: point.roughness,
      bump: point.zAccel,
    }));
  }, [accelPoints, startTime]);

  // Calculate average roughness for reference line
  const avgRoughness = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData.reduce((sum, d) => sum + d.roughness, 0) / chartData.length;
  }, [chartData]);

  // Calculate max roughness for context
  const maxRoughness = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.max(...chartData.map(d => d.roughness));
  }, [chartData]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getRoughnessLabel = (value: number) => {
    if (value < 0.5) return 'Smooth';
    if (value < 1.5) return 'Light vibration';
    if (value < 3) return 'Moderate';
    if (value < 5) return 'Rough';
    return 'Very rough';
  };

  if (chartData.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-gray-200">
        No accelerometer data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="flex gap-4 text-sm">
        <div className="px-3 py-1.5 bg-gray-50 rounded border border-gray-200">
          <span className="text-gray-500">Avg roughness:</span>{' '}
          <span className="font-medium text-gray-900">{avgRoughness.toFixed(2)} — {getRoughnessLabel(avgRoughness)}</span>
        </div>
        <div className="px-3 py-1.5 bg-gray-50 rounded border border-gray-200">
          <span className="text-gray-500">Peak:</span>{' '}
          <span className="font-medium text-gray-900">{maxRoughness.toFixed(2)}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="roughnessGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#374151" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#374151" stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
            />
            <YAxis
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#e5e7eb' }}
              label={{ value: 'Vibration', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '12px',
              }}
              formatter={(value: number) => [
                `${value.toFixed(2)} — ${getRoughnessLabel(value)}`,
                'Roughness',
              ]}
              labelFormatter={(label) => `Time: ${formatTime(label as number)}`}
            />
            <ReferenceLine
              y={avgRoughness}
              stroke="#9ca3af"
              strokeDasharray="5 5"
              label={{ value: 'avg', position: 'right', fontSize: 10, fill: '#9ca3af' }}
            />
            <Area
              type="monotone"
              dataKey="roughness"
              stroke="#374151"
              strokeWidth={1.5}
              fill="url(#roughnessGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      <p className="text-xs text-gray-400">
        Roughness = rolling standard deviation of vertical (Z) acceleration. Higher values = bumpier road.
      </p>
    </div>
  );
}
