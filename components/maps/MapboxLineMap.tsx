'use client';

import { useEffect, useMemo, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

export interface MapLine {
  id: string;
  coordinates: GeoJSON.Position[];
  color: string;
  width?: number;
  opacity?: number;
  dashed?: boolean;
  label?: string;
}

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  color: string;
  label?: string;
  size?: number;
  selected?: boolean;
}

interface MapboxLineMapProps {
  lines: MapLine[];
  className?: string;
  interactive?: boolean;
  onLineClick?: (id: string) => void;
  markers?: MapMarker[];
  selectedMarkerId?: string | null;
  onMarkerClick?: (id: string) => void;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * A coordinate we can safely fit the map to. Rejects non-finite values,
 * out-of-range lat/lng (e.g. a swapped [lat, lng] pair), and Null Island
 * [0, 0] — the sentinel a missing GPS fix leaves behind. A single stray
 * point of any of these kinds would otherwise blow the bounding box out to
 * span the country and zoom the whole map out.
 */
function isFittableCoordinate(position: GeoJSON.Position): position is [number, number] {
  const [lng, lat] = position;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  if (lng === 0 && lat === 0) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Bounds that frame where the data actually clusters, ignoring geographic
 * outliers. A drive recorded in another city is a perfectly valid coordinate,
 * so isFittableCoordinate lets it through — but including it in the box zooms
 * the map out to span both cities. We keep only points within median ± k·MAD
 * of the cluster on each axis (MAD = median absolute deviation, an
 * outlier-resistant spread), with a degree floor so a tight single-metro
 * cluster is never over-trimmed. Returns null when there is nothing to fit.
 */
function clusterBounds(coordinates: [number, number][]): mapboxgl.LngLatBounds | null {
  if (coordinates.length === 0) return null;

  const lngs = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  const medLng = median(lngs);
  const medLat = median(lats);
  // ~1.5° (~100 mi) floor: never tighter than a metro's spread, but far below
  // the many-degree gap to an out-of-town stray.
  const spanLng = Math.max(1.5, median(lngs.map((v) => Math.abs(v - medLng))) * 6);
  const spanLat = Math.max(1.5, median(lats.map((v) => Math.abs(v - medLat))) * 6);

  const bounds = new mapboxgl.LngLatBounds();
  for (const [lng, lat] of coordinates) {
    if (Math.abs(lng - medLng) <= spanLng && Math.abs(lat - medLat) <= spanLat) {
      bounds.extend([lng, lat]);
    }
  }
  return bounds.isEmpty() ? null : bounds;
}

export function MapboxLineMap({
  lines,
  className = 'h-[400px] w-full',
  interactive = true,
  onLineClick,
  markers = [],
  selectedMarkerId,
  onMarkerClick,
}: MapboxLineMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const stableLines = useMemo(() => lines, [lines]);
  const stableMarkers = useMemo(() => markers, [markers]);

  useEffect(() => {
    if (!containerRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-87.2169, 30.4213],
      zoom: 12,
      interactive,
    });
    if (interactive) map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      const fitCoordinates: [number, number][] = [];
      let selectedMarker: { marker: mapboxgl.Marker; lng: number; lat: number } | null = null;
      for (const line of stableLines) {
        if (line.coordinates.length < 2) continue;
        const sourceId = `source-${safeId(line.id)}`;
        const layerId = `line-${safeId(line.id)}`;
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: { id: line.id }, geometry: { type: 'LineString', coordinates: line.coordinates } },
        });
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': line.color,
            'line-width': line.width ?? 4,
            'line-opacity': line.opacity ?? 0.9,
            ...(line.dashed ? { 'line-dasharray': [2, 2] } : {}),
          },
        });
        for (const coordinate of line.coordinates) {
          if (isFittableCoordinate(coordinate)) fitCoordinates.push(coordinate);
        }
        if (onLineClick) {
          map.on('click', layerId, () => onLineClick(line.id));
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
        }
        if (line.label) {
          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
          map.on('mouseenter', layerId, (event) => {
            popup
              .setLngLat(event.lngLat)
              .setText(line.label!)
              .addTo(map);
          });
          map.on('mouseleave', layerId, () => popup.remove());
        }
      }
      for (const marker of stableMarkers) {
        const element = document.createElement('div');
        const size = marker.size ?? 14;
        element.style.width = `${size}px`;
        element.style.height = `${size}px`;
        element.style.borderRadius = '9999px';
        element.style.background = marker.color;
        element.style.border = marker.selected ? '3px solid #111827' : '2px solid white';
        element.style.boxShadow = marker.selected ? '0 0 0 4px rgba(239,68,68,.3)' : '0 1px 4px rgba(0,0,0,.35)';
        element.style.cursor = marker.label ? 'pointer' : 'default';
        const mapMarker = new mapboxgl.Marker({ element }).setLngLat([marker.lng, marker.lat]);
        if (marker.label) mapMarker.setPopup(new mapboxgl.Popup().setText(marker.label));
        mapMarker.addTo(map);
        if (onMarkerClick) element.addEventListener('click', () => onMarkerClick(marker.id));
        if (isFittableCoordinate([marker.lng, marker.lat])) fitCoordinates.push([marker.lng, marker.lat]);
        if (marker.id === selectedMarkerId) {
          selectedMarker = { marker: mapMarker, lng: marker.lng, lat: marker.lat };
        }
      }
      const bounds = clusterBounds(fitCoordinates);
      if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
      if (selectedMarker) {
        map.flyTo({ center: [selectedMarker.lng, selectedMarker.lat], zoom: 17, duration: 450 });
        selectedMarker.marker.togglePopup();
      }
    });

    return () => map.remove();
  }, [interactive, onLineClick, onMarkerClick, selectedMarkerId, stableLines, stableMarkers, token]);

  if (!token) {
    return (
      <div className={`${className} flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-6 text-center text-sm text-amber-800`}>
        Map unavailable: configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.
      </div>
    );
  }
  return <div ref={containerRef} className={className} />;
}
