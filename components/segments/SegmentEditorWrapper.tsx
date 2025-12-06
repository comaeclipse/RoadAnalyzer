'use client';

import dynamic from 'next/dynamic';
import { RoadSegmentResponse } from '@/types/segments';

interface SegmentEditorMapProps {
  segments: RoadSegmentResponse[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
  onSegmentCreated: (geometry: GeoJSON.LineString) => void;
  onSegmentUpdated: (id: string, geometry: GeoJSON.LineString) => void;
  editMode: 'view' | 'draw' | 'edit';
}

// Dynamic import to prevent SSR issues with Leaflet
const SegmentEditorMap = dynamic<SegmentEditorMapProps>(
  () => import('./SegmentEditorMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-gray-100 text-gray-500">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-2"></div>
          <p>Loading map...</p>
        </div>
      </div>
    ),
  }
);

export { SegmentEditorMap };

