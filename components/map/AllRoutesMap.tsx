'use client';

import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

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

// Color palette for routes without roughness scores
const ROUTE_COLORS = [
  '#e11d48', // rose
  '#7c3aed', // violet
  '#2563eb', // blue
  '#0891b2', // cyan
  '#059669', // emerald
  '#ca8a04', // yellow
  '#ea580c', // orange
  '#dc2626', // red
];

// Get color based on roughness or assign from palette
function getRouteColor(roughnessScore: number | null, isSelected: boolean, index: number): string {
  if (isSelected) return '#1f2937'; // charcoal when selected
  
  // If has roughness score, use roughness-based colors
  if (roughnessScore !== null) {
    if (roughnessScore >= 90) return '#22c55e';
    if (roughnessScore >= 75) return '#84cc16';
    if (roughnessScore >= 50) return '#eab308';
    if (roughnessScore >= 25) return '#f97316';
    return '#ef4444';
  }
  
  // Otherwise use color from palette based on index
  return ROUTE_COLORS[index % ROUTE_COLORS.length];
}

function MapController({ routes, selectedRouteId }: { routes: Route[]; selectedRouteId: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedRouteId) {
      const route = routes.find((r) => r.id === selectedRouteId);
      if (route && route.points.length > 0) {
        const bounds = L.latLngBounds(route.points.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else if (routes.length > 0) {
      // Fit all routes
      const allPoints = routes.flatMap((r) => r.points);
      if (allPoints.length > 0) {
        const bounds = L.latLngBounds(allPoints.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [map, routes, selectedRouteId]);

  return null;
}

export default function AllRoutesMap({ routes, selectedRouteId, onRouteSelect }: AllRoutesMapProps) {
  // Calculate initial bounds
  const initialBounds = useMemo(() => {
    const allPoints = routes.flatMap((r) => r.points);
    if (allPoints.length === 0) {
      return L.latLngBounds([[37.7749, -122.4194], [37.7749, -122.4194]]); // Default SF
    }
    const lats = allPoints.map((p) => p.lat);
    const lngs = allPoints.map((p) => p.lng);
    return L.latLngBounds(
      [Math.min(...lats) - 0.01, Math.min(...lngs) - 0.01],
      [Math.max(...lats) + 0.01, Math.max(...lngs) + 0.01]
    );
  }, [routes]);

  // Sort routes so selected one renders on top
  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) => {
      if (a.id === selectedRouteId) return 1;
      if (b.id === selectedRouteId) return -1;
      return 0;
    });
  }, [routes, selectedRouteId]);

  return (
    <div className="h-[calc(100vh-12rem)] min-h-[400px]">
      <MapContainer
        bounds={initialBounds}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <MapController routes={routes} selectedRouteId={selectedRouteId} />
        
        {sortedRoutes.map((route, index) => {
          const isSelected = route.id === selectedRouteId;
          const positions: [number, number][] = route.points.map((p) => [p.lat, p.lng]);
          
          return (
            <Polyline
              key={route.id}
              positions={positions}
              color={getRouteColor(route.roughnessScore, isSelected, index)}
              weight={isSelected ? 5 : 3}
              opacity={selectedRouteId && !isSelected ? 0.4 : 0.9}
              eventHandlers={{
                click: () => onRouteSelect(isSelected ? null : route.id),
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}

