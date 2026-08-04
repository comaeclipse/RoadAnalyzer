'use client';

import { useMemo } from 'react';
import { MapboxLineMap, type MapLine, type MapMarker } from '@/components/maps/MapboxLineMap';
import { getSpeedColor } from '@/lib/speed';

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
  match?: {
    snappedLatitude: number | null;
    snappedLongitude: number | null;
  } | null;
}

/**
 * Position to draw a point at: the map-matched location when trip analysis
 * produced one, otherwise the raw fix. Keeps overlays sitting on the matched
 * route rather than floating beside it on GPS error.
 */
function drawnPosition(point: GpsPoint): GeoJSON.Position {
  const { snappedLatitude, snappedLongitude } = point.match ?? {};
  return snappedLatitude != null && snappedLongitude != null
    ? [snappedLongitude, snappedLatitude]
    : [point.lng, point.lat];
}

interface AccelPoint {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
}

export interface TrafficFeature {
  id: string;
  kind: 'stop' | 'slow-zone';
  start: number;
  end: number;
  duration: number;
  location: GpsPoint;
  avgSpeed?: number;
}

/**
 * A stored CongestionEvent, as returned by /api/recordings/[id].
 *
 * Distinct from TrafficFeature: these are detected server side against matched
 * road segments and persisted, rather than derived from the raw trace in the
 * browser.
 */
export interface CongestionOverlay {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
  severity: 'FREE_FLOW' | 'SLOW' | 'CONGESTED' | 'HEAVY' | 'GRIDLOCK';
  avgSpeed: number;
  segment?: { name: string } | null;
}

interface RouteMapProps {
  points: GpsPoint[];
  accelPoints?: AccelPoint[];
  mode?: 'ROAD_QUALITY' | 'TRAFFIC';
  matchedGeometry?: GeoJSON.LineString | null;
  stops?: TrafficFeature[];
  slowZones?: TrafficFeature[];
  congestionEvents?: CongestionOverlay[];
  selectedTrafficFeatureId?: string | null;
  onTrafficFeatureSelect?: (id: string) => void;
}

const CONGESTION_ORANGE = '#f97316';

function calculateRoughness(points: AccelPoint[]): number {
  if (points.length < 2) return 0;
  const mean = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  return Math.sqrt(points.reduce((sum, point) => sum + (point.z - mean) ** 2, 0) / points.length);
}

function roughnessColor(value: number): string {
  if (value < 0.5) return '#22c55e';
  if (value < 1.5) return '#84cc16';
  if (value < 3) return '#eab308';
  if (value < 5) return '#f97316';
  return '#ef4444';
}

export default function RouteMap({
  points,
  accelPoints = [],
  mode = 'ROAD_QUALITY',
  matchedGeometry,
  stops = [],
  slowZones = [],
  congestionEvents = [],
  selectedTrafficFeatureId,
  onTrafficFeatureSelect,
}: RouteMapProps) {
  const lines = useMemo<MapLine[]>(() => {
    if (points.length < 2) return [];
    if (matchedGeometry?.coordinates?.length) {
      return [
        {
          id: 'raw-route',
          coordinates: points.map((point) => [point.lng, point.lat]),
          color: '#9ca3af',
          width: 2,
          opacity: 0.65,
          dashed: true,
          label: 'Raw GPS trace',
        },
        {
          id: 'matched-route',
          coordinates: matchedGeometry.coordinates,
          color: '#2563eb',
          width: 5,
          label: 'Map-matched route',
        },
      ];
    }
    return points.slice(0, -1).map((point, index) => {
      let color = getSpeedColor(point.speed);
      if (mode === 'ROAD_QUALITY') {
        const relevant = accelPoints.filter(
          (sample) => sample.timestamp >= point.timestamp && sample.timestamp <= points[index + 1].timestamp
        );
        color = relevant.length ? roughnessColor(calculateRoughness(relevant)) : '#374151';
      }
      return {
        id: `raw-${index}`,
        coordinates: [[point.lng, point.lat], [points[index + 1].lng, points[index + 1].lat]],
        color,
        width: 4,
      };
    });
  }, [accelPoints, matchedGeometry, mode, points]);

  const trafficLines = useMemo<MapLine[]>(() => {
    if (mode !== 'TRAFFIC') return [];
    return [...stops, ...slowZones].flatMap((feature) => {
      const coordinates = points.slice(feature.start, feature.end + 1).map((point) => [point.lng, point.lat] as GeoJSON.Position);
      if (coordinates.length < 2) return [];
      return [{
        id: `traffic-${feature.id}`,
        coordinates,
        color: feature.kind === 'stop' ? '#dc2626' : '#f97316',
        width: feature.kind === 'stop' ? 7 : 5,
        opacity: 0.95,
        label: feature.kind === 'stop' ? `Detected stop — ${formatDuration(feature.duration)}` : `Slow zone — ${formatDuration(feature.duration)}`,
      }];
    });
  }, [mode, points, slowZones, stops]);

  // Stored congestion events, drawn as an orange band along the trace they cover.
  // Events are built from GPS sample timestamps server side, so the times line up
  // exactly with the points here.
  const congestionLines = useMemo<MapLine[]>(() => {
    if (mode !== 'TRAFFIC' || points.length < 2) return [];
    return congestionEvents.flatMap((event) => {
      const start = new Date(event.startTime).getTime();
      const end = new Date(event.endTime).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
      const coordinates = points
        .filter((point) => point.timestamp >= start && point.timestamp <= end)
        .map(drawnPosition);
      if (coordinates.length < 2) return [];
      const where = event.segment?.name ? ` on ${event.segment.name}` : '';
      return [{
        id: `congestion-${event.id}`,
        coordinates,
        color: CONGESTION_ORANGE,
        width: 10,
        opacity: 0.55,
        label:
          `${severityLabel(event.severity)}${where} — ${formatDuration(event.duration)}` +
          ` at ${(event.avgSpeed * 2.23694).toFixed(1)} mph`,
      }];
    });
  }, [congestionEvents, mode, points]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!points.length) return [];
    return [
      { id: 'start', lng: points[0].lng, lat: points[0].lat, color: '#16a34a', label: 'Start' },
      { id: 'end', lng: points[points.length - 1].lng, lat: points[points.length - 1].lat, color: '#dc2626', label: 'End' },
    ...stops.map((stop) => ({
      id: stop.id,
      lng: stop.location.lng,
      lat: stop.location.lat,
      color: '#dc2626',
      size: Math.min(40, 20 + Math.round(stop.duration / 5_000) * 2),
      selected: stop.id === selectedTrafficFeatureId,
      label: `Detected stop — ${formatDuration(stop.duration)} (unclassified)`,
    })),
    ];
  }, [points, selectedTrafficFeatureId, stops]);

  if (!points.length) {
    return <div className="flex h-[400px] items-center justify-center rounded-lg border bg-gray-50 text-gray-400">No GPS data</div>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <MapboxLineMap
          // Congestion first so its band sits beneath the route rather than hiding it.
          lines={[...congestionLines, ...lines, ...trafficLines]}
          markers={markers}
          selectedMarkerId={selectedTrafficFeatureId}
          onMarkerClick={onTrafficFeatureSelect}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        {matchedGeometry ? (
          <>
            <span><span className="mr-1 inline-block h-1 w-4 bg-blue-600" />Matched route</span>
            <span><span className="mr-1 inline-block h-1 w-4 border-t border-dashed border-gray-400" />Raw GPS</span>
          </>
        ) : (
          <span>{mode === 'TRAFFIC' ? 'Route colored by recorded speed.' : 'Route colored by road roughness.'}</span>
        )}
        {congestionLines.length > 0 && (
          <span>
            <span
              className="mr-1 inline-block h-2.5 w-4 rounded-sm align-middle"
              style={{ background: CONGESTION_ORANGE, opacity: 0.55 }}
            />
            Congestion event
          </span>
        )}
      </div>
    </div>
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function severityLabel(severity: CongestionOverlay['severity']): string {
  const labels: Record<CongestionOverlay['severity'], string> = {
    FREE_FLOW: 'Free flow',
    SLOW: 'Slow',
    CONGESTED: 'Congested',
    HEAVY: 'Heavy traffic',
    GRIDLOCK: 'Gridlock',
  };
  return labels[severity];
}
