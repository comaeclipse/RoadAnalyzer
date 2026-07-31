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

interface MapboxLineMapProps {
  lines: MapLine[];
  className?: string;
  interactive?: boolean;
  onLineClick?: (id: string) => void;
  markers?: Array<{ id: string; lng: number; lat: number; color: string; label?: string }>;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function MapboxLineMap({
  lines,
  className = 'h-[400px] w-full',
  interactive = true,
  onLineClick,
  markers = [],
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
      const bounds = new mapboxgl.LngLatBounds();
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
          bounds.extend(coordinate as [number, number]);
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
        element.style.width = '14px';
        element.style.height = '14px';
        element.style.borderRadius = '9999px';
        element.style.background = marker.color;
        element.style.border = '2px solid white';
        element.style.boxShadow = '0 1px 4px rgba(0,0,0,.35)';
        const mapMarker = new mapboxgl.Marker({ element }).setLngLat([marker.lng, marker.lat]);
        if (marker.label) mapMarker.setPopup(new mapboxgl.Popup().setText(marker.label));
        mapMarker.addTo(map);
        bounds.extend([marker.lng, marker.lat]);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
    });

    return () => map.remove();
  }, [interactive, onLineClick, stableLines, stableMarkers, token]);

  if (!token) {
    return (
      <div className={`${className} flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-6 text-center text-sm text-amber-800`}>
        Map unavailable: configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.
      </div>
    );
  }
  return <div ref={containerRef} className={className} />;
}
