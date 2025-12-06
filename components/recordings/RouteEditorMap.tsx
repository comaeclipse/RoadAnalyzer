'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';

export type EditMode = 'individual' | 'moveAll';

interface RouteEditorMapProps {
  points: { lat: number; lng: number }[];
  onChange: (points: { lat: number; lng: number }[]) => void;
  editMode: EditMode;
}

const editPointIcon = new L.DivIcon({
  className: 'edit-point',
  html: '<div style="width: 10px; height: 10px; background: #111827; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: grab;"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const moveAllPointIcon = new L.DivIcon({
  className: 'move-all-point',
  html: '<div style="width: 10px; height: 10px; background: #2563eb; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: move;"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

export function RouteEditorMap({ points, onChange, editMode }: RouteEditorMapProps) {
  const [localPoints, setLocalPoints] = useState(points);
  const dragStartRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setLocalPoints(points);
  }, [points]);

  const positions = useMemo(
    () => localPoints.map((p) => [p.lat, p.lng] as [number, number]),
    [localPoints]
  );

  // Individual point drag
  const handleDragEnd = (idx: number, latlng: L.LatLng) => {
    if (editMode === 'individual') {
      setLocalPoints((prev) => {
        const updated = [...prev];
        updated[idx] = { lat: latlng.lat, lng: latlng.lng };
        onChange(updated);
        return updated;
      });
    }
  };

  // Move all: track start position
  const handleDragStart = (idx: number, latlng: L.LatLng) => {
    if (editMode === 'moveAll') {
      dragStartRef.current = { lat: latlng.lat, lng: latlng.lng };
    }
  };

  // Move all: apply delta to all points
  const handleMoveAllDragEnd = (idx: number, latlng: L.LatLng) => {
    if (editMode === 'moveAll' && dragStartRef.current) {
      const deltaLat = latlng.lat - dragStartRef.current.lat;
      const deltaLng = latlng.lng - dragStartRef.current.lng;
      setLocalPoints((prev) => {
        const updated = prev.map((p) => ({
          lat: p.lat + deltaLat,
          lng: p.lng + deltaLng,
        }));
        onChange(updated);
        return updated;
      });
      dragStartRef.current = null;
    }
  };

  const center: [number, number] =
    positions.length > 0 ? positions[0] : [30.4213, -87.2169]; // Pensacola default

  const icon = editMode === 'moveAll' ? moveAllPointIcon : editPointIcon;
  const lineColor = editMode === 'moveAll' ? '#2563eb' : '#111827';

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-200">
      <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={localPoints} />

        {positions.length > 0 && (
          <Polyline positions={positions} color={lineColor} weight={4} opacity={0.85} />
        )}

        {positions.map((pos, idx) => (
          <Marker
            key={idx}
            position={pos}
            icon={icon}
            draggable
            eventHandlers={{
              dragstart: (e) => handleDragStart(idx, e.target.getLatLng()),
              dragend: (e) =>
                editMode === 'moveAll'
                  ? handleMoveAllDragEnd(idx, e.target.getLatLng())
                  : handleDragEnd(idx, e.target.getLatLng()),
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
