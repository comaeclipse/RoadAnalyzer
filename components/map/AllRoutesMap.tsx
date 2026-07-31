'use client';

import { useMemo } from 'react';
import { MapboxLineMap } from '@/components/maps/MapboxLineMap';

interface Route {
  id: string;
  name: string | null;
  roughnessScore: number | null;
  points: { lat: number; lng: number }[];
}

interface AllRoutesMapProps {
  routes: Route[];
  selectedRouteId: string | null;
  onRouteSelect: (id: string | null) => void;
}

const COLORS = ['#e11d48', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#ea580c', '#dc2626'];

function routeColor(score: number | null, selected: boolean, index: number): string {
  if (selected) return '#1f2937';
  if (score == null) return COLORS[index % COLORS.length];
  if (score >= 90) return '#22c55e';
  if (score >= 75) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 25) return '#f97316';
  return '#ef4444';
}

export default function AllRoutesMap({ routes, selectedRouteId, onRouteSelect }: AllRoutesMapProps) {
  const lines = useMemo(() => routes.map((route, index) => {
    const selected = route.id === selectedRouteId;
    return {
      id: route.id,
      coordinates: route.points.map((point) => [point.lng, point.lat]),
      color: routeColor(route.roughnessScore, selected, index),
      width: selected ? 6 : 3,
      opacity: selectedRouteId && !selected ? 0.4 : 0.9,
      label: route.name || 'Untitled drive',
    };
  }), [routes, selectedRouteId]);

  return (
    <MapboxLineMap
      lines={lines}
      className="h-[calc(100vh-12rem)] min-h-[400px] w-full"
      onLineClick={(id) => onRouteSelect(id === selectedRouteId ? null : id)}
    />
  );
}
