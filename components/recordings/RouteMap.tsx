'use client';

import { useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

interface AccelPoint {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

interface RouteMapProps {
  points: GpsPoint[];
  accelPoints?: AccelPoint[];
}

// Calculate roughness for a set of accel points
function calculateRoughness(accelPoints: AccelPoint[]): number {
  if (accelPoints.length < 2) return 0;
  const meanZ = accelPoints.reduce((sum, p) => sum + p.z, 0) / accelPoints.length;
  const variance = accelPoints.reduce((sum, p) => sum + Math.pow(p.z - meanZ, 2), 0) / accelPoints.length;
  return Math.sqrt(variance);
}

// Get color based on roughness value
function getRoughnessColor(roughness: number): string {
  if (roughness < 0.5) return '#22c55e'; // green - smooth
  if (roughness < 1.5) return '#84cc16'; // lime - light
  if (roughness < 3) return '#eab308'; // yellow - moderate
  if (roughness < 5) return '#f97316'; // orange - rough
  return '#ef4444'; // red - very rough
}

// Custom marker icons
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

export default function RouteMap({ points, accelPoints = [] }: RouteMapProps) {
  // Calculate roughness for each GPS segment
  const segments = useMemo(() => {
    if (points.length < 2) return [];
    
    const result: { positions: [number, number][]; roughness: number; color: string }[] = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const startTime = points[i].timestamp;
      const endTime = points[i + 1].timestamp;
      
      // Find accel points in this time range
      const segmentAccel = accelPoints.filter(
        (a) => a.timestamp >= startTime && a.timestamp <= endTime
      );
      
      const roughness = segmentAccel.length > 0 ? calculateRoughness(segmentAccel) : 0;
      
      result.push({
        positions: [
          [points[i].lat, points[i].lng],
          [points[i + 1].lat, points[i + 1].lng],
        ],
        roughness,
        color: accelPoints.length > 0 ? getRoughnessColor(roughness) : '#374151',
      });
    }
    
    return result;
  }, [points, accelPoints]);

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

  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  const formatSpeed = (mps: number | null) => {
    if (!mps) return 'N/A';
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  };

  const hasRoughnessData = accelPoints.length > 0;

  return (
    <div className="space-y-2">
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
          
          {/* Route segments colored by roughness */}
          {segments.map((segment, idx) => (
            <Polyline
              key={idx}
              positions={segment.positions}
              color={segment.color}
              weight={4}
              opacity={0.9}
            />
          ))}

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
      
      {/* Legend */}
      {hasRoughnessData && (
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>Road quality:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Smooth</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <span>Moderate</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span>Rough</span>
          </div>
        </div>
      )}
    </div>
  );
}
