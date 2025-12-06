'use client';

import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import { useEffect, useMemo } from 'react';
import L from 'leaflet';

interface MatchMapProps {
  points: { lat: number; lng: number }[];
}

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, points]);

  return null;
}

export function MatchMap({ points }: MatchMapProps) {
  const positions = useMemo(() => points.map((p) => [p.lat, p.lng] as [number, number]), [points]);
  const center: [number, number] =
    positions.length > 0 ? positions[0] : [30.4213, -87.2169]; // Pensacola default

  return (
    <div className="h-44 w-full overflow-hidden rounded-lg border border-gray-200">
      <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {positions.length > 0 && (
          <Polyline positions={positions} color="#111827" weight={4} opacity={0.8} />
        )}
      </MapContainer>
    </div>
  );
}

