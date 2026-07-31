'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { Button } from '@/components/ui/button';
import type { RoadSegmentResponse } from '@/types/segments';

interface Props {
  segments: RoadSegmentResponse[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
  onSegmentCreated: (geometry: GeoJSON.LineString) => void;
  onSegmentUpdated: (id: string, geometry: GeoJSON.LineString) => void;
  editMode: 'view' | 'draw' | 'edit';
}

const COLORS: Record<string, string> = {
  HIGHWAY: '#dc2626',
  ARTERIAL: '#ea580c',
  COLLECTOR: '#eab308',
  LOCAL: '#2563eb',
  RESIDENTIAL: '#6b7280',
};

export default function SegmentEditorMap({
  segments,
  selectedSegmentId,
  onSegmentSelect,
  onSegmentCreated,
  onSegmentUpdated,
  editMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [editingPoints, setEditingPoints] = useState<[number, number][]>([]);
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (editMode === 'edit' && selectedSegmentId) {
      const segment = segments.find((item) => item.id === selectedSegmentId);
      setEditingPoints(segment?.geometry.coordinates.map((coordinate) => [coordinate[0], coordinate[1]] as [number, number]) ?? []);
    } else {
      setEditingPoints([]);
    }
    if (editMode !== 'draw') setDrawingPoints([]);
  }, [editMode, segments, selectedSegmentId]);

  useEffect(() => {
    if (!containerRef.current || !token) return;
    mapboxgl.accessToken = token;
    const first = segments[0]?.geometry.coordinates[0] as [number, number] | undefined;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: viewRef.current?.center ?? first ?? [-87.2169, 30.4213],
      zoom: viewRef.current?.zoom ?? 13,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      const bounds = new mapboxgl.LngLatBounds();
      segments.forEach((segment, index) => {
        if (editMode === 'edit' && segment.id === selectedSegmentId) return;
        const source = `segment-source-${index}`;
        const layer = `segment-line-${index}`;
        map.addSource(source, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: segment.geometry },
        });
        map.addLayer({
          id: layer,
          type: 'line',
          source,
          paint: {
            'line-color': segment.id === selectedSegmentId
              ? '#111827'
              : segment.source === 'MAPBOX'
                ? '#2563eb'
                : COLORS[segment.roadType ?? ''] ?? '#8b5cf6',
            'line-width': segment.id === selectedSegmentId ? 6 : 3,
            'line-opacity': selectedSegmentId && segment.id !== selectedSegmentId ? 0.4 : 0.9,
          },
        });
        if (editMode === 'view') {
          map.on('click', layer, (event) => {
            event.preventDefault();
            onSegmentSelect(segment.id === selectedSegmentId ? null : segment.id);
          });
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
        }
        segment.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate as [number, number]));
      });

      const activePoints = editMode === 'draw' ? drawingPoints : editingPoints;
      if (activePoints.length >= 2) {
        map.addSource('active-line-source', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: activePoints } },
        });
        map.addLayer({
          id: 'active-line',
          type: 'line',
          source: 'active-line-source',
          paint: { 'line-color': editMode === 'draw' ? '#2563eb' : '#f59e0b', 'line-width': 4, 'line-dasharray': editMode === 'draw' ? [2, 2] : [1, 0] },
        });
      }

      if (editMode === 'edit') {
        editingPoints.forEach((coordinate, index) => {
          const marker = new mapboxgl.Marker({ draggable: true, color: '#f59e0b' })
            .setLngLat(coordinate)
            .on('dragend', () => {
              const next = [...editingPoints];
              const position = marker.getLngLat();
              next[index] = [position.lng, position.lat];
              setEditingPoints(next);
            })
            .addTo(map);
          bounds.extend(coordinate);
        });
      }

      if (!viewRef.current && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 17, duration: 0 });
      }
    });
    if (editMode === 'draw') {
      map.on('click', (event) => setDrawingPoints((current) => [...current, [event.lngLat.lng, event.lngLat.lat]]));
    }
    return () => {
      const center = map.getCenter();
      viewRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
      map.remove();
    };
  }, [drawingPoints, editMode, editingPoints, onSegmentSelect, segments, selectedSegmentId, token]);

  const finishDrawing = useCallback(() => {
    if (drawingPoints.length >= 2) {
      onSegmentCreated({ type: 'LineString', coordinates: drawingPoints });
      setDrawingPoints([]);
    }
  }, [drawingPoints, onSegmentCreated]);

  const saveEdit = useCallback(() => {
    if (selectedSegmentId && editingPoints.length >= 2) {
      onSegmentUpdated(selectedSegmentId, { type: 'LineString', coordinates: editingPoints });
    }
  }, [editingPoints, onSegmentUpdated, selectedSegmentId]);

  if (!token) {
    return <div className="flex h-full items-center justify-center bg-amber-50 text-sm text-amber-800">Configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to manage segments.</div>;
  }

  return (
    <div className="relative h-full">
      {editMode === 'draw' && (
        <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-white px-4 py-2 shadow">
          <span className="text-sm text-gray-500">{drawingPoints.length ? `${drawingPoints.length} points` : 'Click the map to draw'}</span>
          <Button size="sm" variant="outline" onClick={() => setDrawingPoints((points) => points.slice(0, -1))} disabled={!drawingPoints.length}>Undo</Button>
          <Button size="sm" onClick={finishDrawing} disabled={drawingPoints.length < 2}>Finish</Button>
        </div>
      )}
      {editMode === 'edit' && (
        <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg border bg-white px-4 py-2 shadow">
          <Button size="sm" onClick={saveEdit} disabled={editingPoints.length < 2}>Save Changes</Button>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
