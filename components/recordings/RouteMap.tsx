'use client';

import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

interface RouteMapProps {
  points: GpsPoint[];
}

// Custom marker icons - charcoal theme
const startIcon = new L.DivIcon({
  className: 'custom-marker',
  html: `<div style="
    width: 14px; 
    height: 14px; 
    background: #374151; 
    border: 2px solid white; 
    border-radius: 50%; 
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const endIcon = new L.DivIcon({
  className: 'custom-marker',
  html: `<div style="
    width: 14px; 
    height: 14px; 
    background: #6b7280; 
    border: 2px solid white; 
    border-radius: 50%; 
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export default function RouteMap({ points }: RouteMapProps) {
  if (points.length === 0) {
    return (
      <div className="h-[400px] bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 border border-gray-200">
        No GPS data
      </div>
    );
  }

  // Calculate bounds to fit all points
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const bounds: L.LatLngBoundsExpression = [
    [Math.min(...lats) - 0.001, Math.min(...lngs) - 0.001],
    [Math.max(...lats) + 0.001, Math.max(...lngs) + 0.001],
  ];

  // Convert points to polyline format
  const polylinePositions: [number, number][] = points.map((p) => [p.lat, p.lng]);

  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  const formatSpeed = (mps: number | null) => {
    if (!mps) return 'N/A';
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  };

  return (
    <div className="h-[400px] rounded-lg overflow-hidden border border-gray-200">
      <MapContainer
        bounds={bounds}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Route line - charcoal */}
        <Polyline
          positions={polylinePositions}
          color="#374151"
          weight={3}
          opacity={0.9}
        />

        {/* Start marker */}
        <Marker position={[startPoint.lat, startPoint.lng]} icon={startIcon}>
          <Popup>
            <div className="text-sm">
              <strong>Start</strong>
              <br />
              Speed: {formatSpeed(startPoint.speed)}
            </div>
          </Popup>
        </Marker>

        {/* End marker */}
        {points.length > 1 && (
          <Marker position={[endPoint.lat, endPoint.lng]} icon={endIcon}>
            <Popup>
              <div className="text-sm">
                <strong>End</strong>
                <br />
                Speed: {formatSpeed(endPoint.speed)}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}

