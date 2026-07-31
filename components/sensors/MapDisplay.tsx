'use client';

import { useMemo } from 'react';
import { useSensorContext } from '@/components/providers/SensorProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapboxLineMap } from '@/components/maps/MapboxLineMap';
import { SENSOR_CONFIG } from '@/lib/constants';

export function MapDisplay() {
  const { gps } = useSensorContext();
  const lines = useMemo(() => [{
    id: 'live-path',
    coordinates: gps.history.map((reading) => [reading.longitude, reading.latitude]),
    color: '#2563eb',
    width: 4,
  }], [gps.history]);

  if (gps.error || !gps.data) {
    return (
      <Card>
        <CardHeader><CardTitle>GPS Map</CardTitle><CardDescription>Location tracking</CardDescription></CardHeader>
        <CardContent><div className="flex h-[500px] items-center justify-center text-muted-foreground">{gps.error || 'Waiting for GPS data…'}</div></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>GPS Map</span>
          <div className="flex gap-2">
            {gps.data.heading != null && <Badge variant="outline">Heading: {gps.data.heading.toFixed(0)}°</Badge>}
            <Badge variant={gps.data.accuracy < 20 ? 'default' : 'outline'}>±{gps.data.accuracy.toFixed(0)}m</Badge>
          </div>
        </CardTitle>
        <CardDescription>Real-time location with the last {SENSOR_CONFIG.MAX_HISTORY_LENGTH} points</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <MapboxLineMap
            lines={lines}
            className="h-[500px] w-full"
            markers={[{ id: 'current', lng: gps.data.longitude, lat: gps.data.latitude, color: '#dc2626', label: 'Current position' }]}
          />
        </div>
      </CardContent>
    </Card>
  );
}
