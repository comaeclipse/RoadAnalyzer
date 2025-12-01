'use client';

import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

interface RouteMapProps {
  points: GpsPoint[];
}

// Custom marker icons
const startIcon = new L.DivIcon({
  className: 'custom-marker',
  html: `<div style="
    width: 16px; 
    height: 16px; 
    background: #10b981; 
    border: 3px solid white; 
    border-radius: 50%; 
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const endIcon = new L.DivIcon({
  className: 'custom-marker',
  html: `<div style="
    width: 16px; 
    height: 16px; 
    background: #ef4444; 
    border: 3px solid white; 
    border-radius: 50%; 
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function RouteMap({ points }: RouteMapProps) {
  if (points.length === 0) {
    return (
      <div className="h-[400px] bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500">
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
    <div className="h-[400px] rounded-lg overflow-hidden">
      <MapContainer
        bounds={bounds}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* Route line */}
        <Polyline
          positions={polylinePositions}
          color="#10b981"
          weight={4}
          opacity={0.8}
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

