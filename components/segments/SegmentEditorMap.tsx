'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, useMapEvents, useMap, Marker } from 'react-leaflet';
import L from 'leaflet';
import { Button } from '@/components/ui/button';
import { RoadSegmentResponse } from '@/types/segments';

// Road type colors
const ROAD_TYPE_COLORS: Record<string, string> = {
  HIGHWAY: '#dc2626',
  ARTERIAL: '#ea580c',
  COLLECTOR: '#eab308',
  LOCAL: '#2563eb',
  RESIDENTIAL: '#6b7280',
  DEFAULT: '#8b5cf6',
};

function getSegmentColor(roadType: string | null, isSelected: boolean): string {
  if (isSelected) return '#1f2937';
  return ROAD_TYPE_COLORS[roadType || 'DEFAULT'] || ROAD_TYPE_COLORS.DEFAULT;
}

// Custom marker icon for drawing points
const pointIcon = new L.DivIcon({
  className: 'drawing-point',
  html: '<div style="width: 12px; height: 12px; background: #2563eb; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const editPointIcon = new L.DivIcon({
  className: 'edit-point',
  html: '<div style="width: 10px; height: 10px; background: #f59e0b; border: 2px solid white; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: grab;"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

interface SegmentEditorMapProps {
  segments: RoadSegmentResponse[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
  onSegmentCreated: (geometry: GeoJSON.LineString) => void;
  onSegmentUpdated: (id: string, geometry: GeoJSON.LineString) => void;
  editMode: 'view' | 'draw' | 'edit';
}

// Component for handling map click events during drawing
function DrawingHandler({
  isDrawing,
  drawingPoints,
  setDrawingPoints,
}: {
  isDrawing: boolean;
  drawingPoints: [number, number][];
  setDrawingPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
}) {
  useMapEvents({
    click: (e) => {
      if (isDrawing) {
        setDrawingPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
      }
    },
  });
  return null;
}

// Component to fit map to segments
function MapController({ segments, selectedSegmentId }: { segments: RoadSegmentResponse[]; selectedSegmentId: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedSegmentId) {
      const segment = segments.find((s) => s.id === selectedSegmentId);
      if (segment && segment.geometry.coordinates.length > 0) {
        const bounds = L.latLngBounds(
          segment.geometry.coordinates.map((c) => [c[1], c[0]] as [number, number])
        );
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else if (segments.length > 0) {
      const allCoords = segments.flatMap((s) => s.geometry.coordinates);
      if (allCoords.length > 0) {
        const bounds = L.latLngBounds(
          allCoords.map((c) => [c[1], c[0]] as [number, number])
        );
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [map, segments, selectedSegmentId]);

  return null;
}

// Draggable marker for editing vertices
function DraggableMarker({
  position,
  index,
  onDragEnd,
}: {
  position: [number, number];
  index: number;
  onDragEnd: (index: number, newPos: [number, number]) => void;
}) {
  const markerRef = useRef<L.Marker>(null);

  const eventHandlers = {
    dragend() {
      const marker = markerRef.current;
      if (marker) {
        const latlng = marker.getLatLng();
        onDragEnd(index, [latlng.lat, latlng.lng]);
      }
    },
  };

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={editPointIcon}
      draggable={true}
      eventHandlers={eventHandlers}
    />
  );
}

export default function SegmentEditorMap({
  segments,
  selectedSegmentId,
  onSegmentSelect,
  onSegmentCreated,
  onSegmentUpdated,
  editMode,
}: SegmentEditorMapProps) {
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [editingPoints, setEditingPoints] = useState<[number, number][]>([]);

  // Initialize editing points when segment is selected in edit mode
  useEffect(() => {
    if (editMode === 'edit' && selectedSegmentId) {
      const segment = segments.find((s) => s.id === selectedSegmentId);
      if (segment) {
        setEditingPoints(
          segment.geometry.coordinates.map((c) => [c[1], c[0]] as [number, number])
        );
      }
    } else {
      setEditingPoints([]);
    }
  }, [editMode, selectedSegmentId, segments]);

  // Clear drawing points when exiting draw mode
  useEffect(() => {
    if (editMode !== 'draw') {
      setDrawingPoints([]);
    }
  }, [editMode]);

  const handleFinishDrawing = useCallback(() => {
    if (drawingPoints.length >= 2) {
      const geometry: GeoJSON.LineString = {
        type: 'LineString',
        coordinates: drawingPoints.map((p) => [p[1], p[0]]), // Convert to [lng, lat]
      };
      onSegmentCreated(geometry);
      setDrawingPoints([]);
    }
  }, [drawingPoints, onSegmentCreated]);

  const handleCancelDrawing = useCallback(() => {
    setDrawingPoints([]);
  }, []);

  const handleUndoPoint = useCallback(() => {
    setDrawingPoints((prev) => prev.slice(0, -1));
  }, []);

  const handleEditDragEnd = useCallback(
    (index: number, newPos: [number, number]) => {
      setEditingPoints((prev) => {
        const updated = [...prev];
        updated[index] = newPos;
        return updated;
      });
    },
    []
  );

  const handleSaveEdit = useCallback(() => {
    if (selectedSegmentId && editingPoints.length >= 2) {
      const geometry: GeoJSON.LineString = {
        type: 'LineString',
        coordinates: editingPoints.map((p) => [p[1], p[0]]),
      };
      onSegmentUpdated(selectedSegmentId, geometry);
    }
  }, [selectedSegmentId, editingPoints, onSegmentUpdated]);

  // Default to Pensacola, FL
  const PENSACOLA_CENTER: [number, number] = [30.4213, -87.2169];
  
  // Calculate initial bounds
  const initialCenter: [number, number] = segments.length > 0 && segments[0].geometry.coordinates.length > 0
    ? [segments[0].geometry.coordinates[0][1], segments[0].geometry.coordinates[0][0]]
    : PENSACOLA_CENTER;

  return (
    <div className="relative h-full">
      {/* Drawing/Edit Controls Overlay */}
      {editMode === 'draw' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-2.5 flex gap-2 items-center">
          <span className="text-sm text-gray-500 mr-2">
            {drawingPoints.length === 0
              ? 'Click on map to start drawing'
              : `${drawingPoints.length} points`}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleUndoPoint}
            disabled={drawingPoints.length === 0}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Undo
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancelDrawing}
            disabled={drawingPoints.length === 0}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleFinishDrawing}
            disabled={drawingPoints.length < 2}
            className="bg-gray-900 hover:bg-gray-800 text-white"
          >
            Finish
          </Button>
        </div>
      )}

      {editMode === 'edit' && selectedSegmentId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-2.5 flex gap-2 items-center">
          <span className="text-sm text-gray-500 mr-2">
            Drag points to edit geometry
          </span>
          <Button
            size="sm"
            onClick={handleSaveEdit}
            className="bg-gray-900 hover:bg-gray-800 text-white"
          >
            Save Changes
          </Button>
        </div>
      )}

      <MapContainer
        center={initialCenter}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <MapController segments={segments} selectedSegmentId={selectedSegmentId} />
        <DrawingHandler
          isDrawing={editMode === 'draw'}
          drawingPoints={drawingPoints}
          setDrawingPoints={setDrawingPoints}
        />

        {/* Existing segments */}
        {segments.map((segment) => {
          const isSelected = segment.id === selectedSegmentId;
          const positions: [number, number][] = segment.geometry.coordinates.map(
            (c) => [c[1], c[0]]
          );

          // Don't render selected segment in edit mode (we render editable version instead)
          if (editMode === 'edit' && isSelected) return null;

          return (
            <Polyline
              key={segment.id}
              positions={positions}
              color={getSegmentColor(segment.roadType, isSelected)}
              weight={isSelected ? 5 : 3}
              opacity={selectedSegmentId && !isSelected ? 0.4 : 0.9}
              eventHandlers={{
                click: (e) => {
                  if (editMode === 'view') {
                    L.DomEvent.stopPropagation(e);
                    onSegmentSelect(isSelected ? null : segment.id);
                  }
                },
              }}
            />
          );
        })}

        {/* Drawing preview line */}
        {editMode === 'draw' && drawingPoints.length > 0 && (
          <>
            <Polyline
              positions={drawingPoints}
              color="#2563eb"
              weight={3}
              dashArray="5, 10"
            />
            {drawingPoints.map((point, idx) => (
              <Marker key={idx} position={point} icon={pointIcon} />
            ))}
          </>
        )}

        {/* Editing mode - draggable vertices */}
        {editMode === 'edit' && editingPoints.length > 0 && (
          <>
            <Polyline positions={editingPoints} color="#f59e0b" weight={4} />
            {editingPoints.map((point, idx) => (
              <DraggableMarker
                key={idx}
                position={point}
                index={idx}
                onDragEnd={handleEditDragEnd}
              />
            ))}
          </>
        )}
      </MapContainer>
    </div>
  );
}

