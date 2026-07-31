'use client';

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

export type EditMode = 'individual' | 'moveAll';

interface RouteEditorMapProps {
  points: { lat: number; lng: number }[];
  onChange: (points: { lat: number; lng: number }[]) => void;
  editMode: EditMode;
}

export function RouteEditorMap({ points, onChange, editMode }: RouteEditorMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (!containerRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: points[0] ? [points[0].lng, points[0].lat] : [-87.2169, 30.4213],
      zoom: 15,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    const mutable = points.map((point) => ({ ...point }));
    const markers: mapboxgl.Marker[] = [];

    const updateLine = () => {
      const source = map.getSource('route') as mapboxgl.GeoJSONSource | undefined;
      source?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: mutable.map((point) => [point.lng, point.lat]) },
      });
    };

    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: mutable.map((point) => [point.lng, point.lat]) } },
      });
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: { 'line-color': editMode === 'moveAll' ? '#2563eb' : '#111827', 'line-width': 4 },
      });

      mutable.forEach((point, index) => {
        let dragStart = { ...point };
        const element = document.createElement('div');
        element.style.cssText = `width:12px;height:12px;border-radius:50%;background:${editMode === 'moveAll' ? '#2563eb' : '#111827'};border:2px solid white;box-shadow:0 1px 3px #0006;`;
        const marker = new mapboxgl.Marker({ element, draggable: true })
          .setLngLat([point.lng, point.lat])
          .on('dragstart', () => {
            const position = marker.getLngLat();
            dragStart = { lat: position.lat, lng: position.lng };
          })
          .on('drag', () => {
            const position = marker.getLngLat();
            if (editMode === 'individual') {
              mutable[index] = { lat: position.lat, lng: position.lng };
              updateLine();
            }
          })
          .on('dragend', () => {
            const position = marker.getLngLat();
            if (editMode === 'moveAll') {
              const deltaLat = position.lat - dragStart.lat;
              const deltaLng = position.lng - dragStart.lng;
              mutable.forEach((item, itemIndex) => {
                mutable[itemIndex] = { lat: item.lat + deltaLat, lng: item.lng + deltaLng };
                markers[itemIndex].setLngLat([mutable[itemIndex].lng, mutable[itemIndex].lat]);
              });
            } else {
              mutable[index] = { lat: position.lat, lng: position.lng };
            }
            updateLine();
            onChangeRef.current(mutable.map((item) => ({ ...item })));
          })
          .addTo(map);
        markers.push(marker);
      });

      if (mutable.length) {
        const bounds = new mapboxgl.LngLatBounds();
        mutable.forEach((point) => bounds.extend([point.lng, point.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 0 });
      }
    });
    return () => map.remove();
  }, [editMode, points, token]);

  if (!token) {
    return <div className="flex h-[420px] items-center justify-center rounded-lg border bg-amber-50 text-sm text-amber-800">Configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to edit routes.</div>;
  }
  return <div ref={containerRef} className="h-[420px] w-full overflow-hidden rounded-lg border border-gray-200" />;
}
