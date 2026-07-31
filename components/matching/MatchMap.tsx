'use client';

import { MapboxLineMap } from '@/components/maps/MapboxLineMap';

interface MatchMapProps {
  points: { lat: number; lng: number }[];
  matchedGeometry?: GeoJSON.LineString | null;
}

export function MatchMap({ points, matchedGeometry }: MatchMapProps) {
  const lines = [
    {
      id: 'raw',
      coordinates: points.map((point) => [point.lng, point.lat]),
      color: '#9ca3af',
      width: 2,
      dashed: true,
    },
    ...(matchedGeometry ? [{
      id: 'matched',
      coordinates: matchedGeometry.coordinates,
      color: '#2563eb',
      width: 4,
    }] : []),
  ];
  return <MapboxLineMap lines={lines} interactive={false} className="h-44 w-full" />;
}
