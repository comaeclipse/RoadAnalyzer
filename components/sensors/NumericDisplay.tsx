'use client';

import { useSensorContext } from '@/components/providers/SensorProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { calculateMagnitude } from '@/lib/sensor-utils';
import { format } from 'date-fns';

export function NumericDisplay() {
  const { accelerometer, gps } = useSensorContext();

  const formatValue = (value: number | null, precision: number = 2): string => {
    if (value === null) return 'N/A';
    return value.toFixed(precision);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Accelerometer Card */}
      <Card>
        <CardHeader>
          <CardTitle>Accelerometer</CardTitle>
          <CardDescription>
            {accelerometer.data ? format(accelerometer.data.timestamp, 'HH:mm:ss') : 'Waiting for data...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accelerometer.error ? (
            <p className="text-sm text-destructive">{accelerometer.error}</p>
          ) : accelerometer.data ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">X-Axis</p>
                  <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                    {formatValue(accelerometer.data.x)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">m/s²</p>
                </div>

                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">Y-Axis</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                    {formatValue(accelerometer.data.y)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">m/s²</p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Z-Axis</p>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {formatValue(accelerometer.data.z)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">m/s²</p>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border">
                <p className="text-xs font-medium text-muted-foreground mb-1">Magnitude</p>
                <p className="text-2xl font-bold">
                  {formatValue(calculateMagnitude(accelerometer.data))}
                </p>
                <p className="text-xs text-muted-foreground mt-1">m/s²</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No accelerometer data available</p>
          )}
        </CardContent>
      </Card>

      {/* GPS Card */}
      <Card>
        <CardHeader>
          <CardTitle>GPS Location</CardTitle>
          <CardDescription>
            {gps.data ? format(gps.data.timestamp, 'HH:mm:ss') : 'Waiting for data...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {gps.error ? (
            <p className="text-sm text-destructive">{gps.error}</p>
          ) : gps.data ? (
            <>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Latitude</span>
                  <span className="font-mono font-semibold">{formatValue(gps.data.latitude, 6)}°</span>
                </div>

                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Longitude</span>
                  <span className="font-mono font-semibold">{formatValue(gps.data.longitude, 6)}°</span>
                </div>

                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Altitude</span>
                  <span className="font-mono font-semibold">{formatValue(gps.data.altitude, 1)} m</span>
                </div>

                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Speed</span>
                  <span className="font-mono font-semibold">
                    {gps.data.speed !== null ? `${formatValue(gps.data.speed * 3.6, 1)} km/h` : 'N/A'}
                  </span>
                </div>

                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Heading</span>
                  <span className="font-mono font-semibold">{formatValue(gps.data.heading, 0)}°</span>
                </div>

                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Accuracy</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{formatValue(gps.data.accuracy, 1)} m</span>
                    <Badge variant={gps.data.accuracy < 20 ? 'default' : 'outline'}>
                      {gps.data.accuracy < 20 ? 'Good' : 'Fair'}
                    </Badge>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No GPS data available</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
