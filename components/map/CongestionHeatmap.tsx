'use client';

import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { HeatmapSegment } from '@/types/congestion';

interface CongestionHeatmapProps {
  segments: HeatmapSegment[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
}

// Color scale: Green (free-flow) to Red (gridlock)
// Score is 0-100 (100 = always free-flow, 0 = always congested)
function getCongestionColor(score: number | null): string {
  if (score === null) return '#9ca3af'; // gray (no data)

  if (score >= 80) return '#22c55e';  // green - excellent
  if (score >= 60) return '#84cc16';  // lime - good
  if (score >= 40) return '#eab308';  // yellow - moderate
  if (score >= 20) return '#f97316';  // orange - poor
  return '#ef4444';                   // red - very poor
}

function MapController({ segments, selectedSegmentId }: { segments: HeatmapSegment[]; selectedSegmentId: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedSegmentId) {
      const segment = segments.find((s) => s.segmentId === selectedSegmentId);
      if (segment && segment.geometry.coordinates.length > 0) {
        const positions = segment.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const bounds = L.latLngBounds(positions as [number, number][]);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else if (segments.length > 0) {
      // Fit all segments
      const allPoints: [number, number][] = [];
      for (const segment of segments) {
        for (const [lng, lat] of segment.geometry.coordinates) {
          allPoints.push([lat, lng]);
        }
      }
      if (allPoints.length > 0) {
        const bounds = L.latLngBounds(allPoints);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [map, segments, selectedSegmentId]);

  return null;
}

export default function CongestionHeatmap({ segments, selectedSegmentId, onSegmentSelect }: CongestionHeatmapProps) {
  // Calculate initial bounds
  const initialBounds = useMemo(() => {
    const allPoints: [number, number][] = [];
    for (const segment of segments) {
      for (const [lng, lat] of segment.geometry.coordinates) {
        allPoints.push([lat, lng]);
      }
    }

    if (allPoints.length === 0) {
      return L.latLngBounds([[37.7749, -122.4194], [37.7749, -122.4194]]); // Default SF
    }

    const lats = allPoints.map(([lat]) => lat);
    const lngs = allPoints.map(([, lng]) => lng);
    return L.latLngBounds(
      [Math.min(...lats) - 0.01, Math.min(...lngs) - 0.01],
      [Math.max(...lats) + 0.01, Math.max(...lngs) + 0.01]
    );
  }, [segments]);

  // Sort segments so selected one renders on top
  const sortedSegments = useMemo(() => {
    return [...segments].sort((a, b) => {
      if (a.segmentId === selectedSegmentId) return 1;
      if (b.segmentId === selectedSegmentId) return -1;
      return 0;
    });
  }, [segments, selectedSegmentId]);

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
        <MapController segments={segments} selectedSegmentId={selectedSegmentId} />

        {sortedSegments.map((segment) => {
          const isSelected = segment.segmentId === selectedSegmentId;
          const positions: [number, number][] = segment.geometry.coordinates.map(
            ([lng, lat]) => [lat, lng]
          );

          return (
            <Polyline
              key={segment.segmentId}
              positions={positions}
              color={isSelected ? '#1f2937' : getCongestionColor(segment.congestionScore)}
              weight={isSelected ? 6 : 4}
              opacity={selectedSegmentId && !isSelected ? 0.4 : 0.9}
              eventHandlers={{
                click: () => onSegmentSelect(isSelected ? null : segment.segmentId),
              }}
            >
              <Tooltip>
                <div className="text-sm">
                  <div className="font-semibold">{segment.name}</div>
                  {segment.congestionScore !== null ? (
                    <>
                      <div>Congestion Score: {Math.round(segment.congestionScore)}/100</div>
                      <div>Events: {segment.eventCount}</div>
                      {segment.avgSpeed !== null && (
                        <div>Avg Speed: {(segment.avgSpeed * 2.23694).toFixed(1)} mph</div>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500">No data yet</div>
                  )}
                </div>
              </Tooltip>
            </Polyline>
          );
        })}
      </MapContainer>
    </div>
  );
}
