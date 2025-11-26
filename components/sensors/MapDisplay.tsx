'use client';

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import { useSensorContext } from '@/components/providers/SensorProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SENSOR_CONFIG } from '@/lib/constants';
import L from 'leaflet';

// Fix for default marker icon in Next.js
const icon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Component to auto-center map on current position with throttling
function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  const lastPanTimeRef = useRef<number>(0);
  const pendingPanRef = useRef<NodeJS.Timeout | null>(null);

  const panToCenter = useCallback((newCenter: [number, number]) => {
    map.setView(newCenter, map.getZoom(), { animate: true, duration: 0.3 });
    lastPanTimeRef.current = Date.now();
  }, [map]);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastPan = now - lastPanTimeRef.current;
    const throttleDelay = SENSOR_CONFIG.MAP_PAN_THROTTLE;

    // Clear any pending pan
    if (pendingPanRef.current) {
      clearTimeout(pendingPanRef.current);
      pendingPanRef.current = null;
    }

    if (timeSinceLastPan >= throttleDelay) {
      // Enough time has passed, pan immediately
      panToCenter(center);
    } else {
      // Schedule pan for later
      const remainingDelay = throttleDelay - timeSinceLastPan;
      pendingPanRef.current = setTimeout(() => {
        panToCenter(center);
      }, remainingDelay);
    }

    return () => {
      if (pendingPanRef.current) {
        clearTimeout(pendingPanRef.current);
      }
    };
  }, [center, panToCenter]);

  return null;
}

export function MapDisplay() {
  const { gps } = useSensorContext();

  const currentPosition: [number, number] | null = useMemo(() => {
    if (gps.data) {
      return [gps.data.latitude, gps.data.longitude];
    }
    return null;
  }, [gps.data]);

  const pathPositions: [number, number][] = useMemo(() => {
    return gps.history.map((reading) => [reading.latitude, reading.longitude]);
  }, [gps.history]);

  const defaultCenter: [number, number] = [37.7749, -122.4194]; // San Francisco

  if (gps.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>GPS Map</CardTitle>
          <CardDescription>Location tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] flex items-center justify-center text-destructive">
            <p>{gps.error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!currentPosition) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>GPS Map</CardTitle>
          <CardDescription>Location tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] flex items-center justify-center text-muted-foreground">
            <p>Waiting for GPS data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>GPS Map</span>
          <div className="flex gap-2">
            {gps.data && (
              <>
                {gps.data.heading !== null && (
                  <Badge variant="outline">Heading: {gps.data.heading.toFixed(0)}°</Badge>
                )}
                <Badge variant={gps.data.accuracy < 20 ? 'default' : 'outline'}>
                  ±{gps.data.accuracy.toFixed(0)}m
                </Badge>
              </>
            )}
          </div>
        </CardTitle>
        <CardDescription>
          Real-time location with path history (last {SENSOR_CONFIG.MAX_HISTORY_LENGTH} points)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[500px] rounded-lg overflow-hidden border">
          <MapContainer
            center={currentPosition}
            zoom={SENSOR_CONFIG.DEFAULT_MAP_ZOOM}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapController center={currentPosition} />
            {pathPositions.length > 1 && (
              <Polyline
                positions={pathPositions}
                color="blue"
                weight={3}
                opacity={0.7}
              />
            )}
            <Marker position={currentPosition} icon={icon} />
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}
