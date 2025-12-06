'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Plus, Pencil } from 'lucide-react';
import { Navigation } from '@/components/layout/Navigation';
import { SegmentEditorMap } from '@/components/segments/SegmentEditorWrapper';
import { SegmentForm } from '@/components/segments/SegmentForm';
import { SegmentList } from '@/components/segments/SegmentList';
import { RoadSegmentResponse } from '@/types/segments';

type EditMode = 'view' | 'draw' | 'edit';

export default function SegmentsPage() {
  const [segments, setSegments] = useState<RoadSegmentResponse[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('view');
  const [pendingGeometry, setPendingGeometry] = useState<GeoJSON.LineString | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch segments on mount
  useEffect(() => {
    fetchSegments();
  }, []);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const fetchSegments = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/segments');
      if (!response.ok) throw new Error('Failed to fetch segments');
      const data = await response.json();
      setSegments(data.segments);
    } catch (err) {
      setError('Failed to load segments');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSegmentSelect = useCallback((id: string | null) => {
    setSelectedSegmentId(id);
    setEditMode('view');
    setPendingGeometry(null);
    setError(null);
  }, []);

  const handleSegmentCreated = useCallback((geometry: GeoJSON.LineString) => {
    setPendingGeometry(geometry);
    setSelectedSegmentId(null);
  }, []);

  const handleSegmentUpdated = useCallback(
    async (id: string, geometry: GeoJSON.LineString) => {
      try {
        setIsSaving(true);
        const response = await fetch(`/api/segments/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geometry }),
        });

        if (!response.ok) throw new Error('Failed to update segment');

        await fetchSegments();
        setEditMode('view');
        setSuccessMessage('Segment geometry updated');
      } catch (err) {
        setError('Failed to update segment geometry');
        console.error(err);
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const handleSave = async (data: {
    name: string;
    description: string;
    roadType: string | null;
    geometry?: GeoJSON.LineString;
  }) => {
    try {
      setIsSaving(true);
      setError(null);

      if (pendingGeometry) {
        // Create new segment
        const response = await fetch('/api/segments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            description: data.description || undefined,
            roadType: data.roadType || undefined,
            geometry: pendingGeometry,
          }),
        });

        if (!response.ok) throw new Error('Failed to create segment');

        const { segment } = await response.json();
        await fetchSegments();
        setSelectedSegmentId(segment.id);
        setPendingGeometry(null);
        setEditMode('view');
        setSuccessMessage('Segment created');
      } else if (selectedSegmentId) {
        // Update existing segment
        const response = await fetch(`/api/segments/${selectedSegmentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.name,
            description: data.description || null,
            roadType: data.roadType || null,
          }),
        });

        if (!response.ok) throw new Error('Failed to update segment');

        await fetchSegments();
        setSuccessMessage('Segment updated');
      }
    } catch (err) {
      setError(pendingGeometry ? 'Failed to create segment' : 'Failed to update segment');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSegmentId) return;

    try {
      setIsSaving(true);
      setError(null);

      const response = await fetch(`/api/segments/${selectedSegmentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete segment');

      await fetchSegments();
      setSelectedSegmentId(null);
      setEditMode('view');
      setSuccessMessage('Segment deleted');
    } catch (err) {
      setError('Failed to delete segment');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setPendingGeometry(null);
    setEditMode('view');
    setError(null);
  };

  const selectedSegment = selectedSegmentId
    ? segments.find((s) => s.id === selectedSegmentId) || null
    : null;

  return (
    <div className="h-screen flex flex-col bg-white">
      <Navigation />
      
      {/* Sub-header for segment actions */}
      <div className="border-b border-gray-200 px-4 py-2 flex items-center justify-between bg-gray-50">
        <p className="text-sm text-gray-600">{segments.length} segments</p>
        <div className="flex items-center gap-2">
          {editMode === 'view' && (
            <>
              <Button
                onClick={() => setEditMode('draw')}
                size="sm"
                className="gap-2 bg-gray-900 hover:bg-gray-800 text-white"
              >
                <Plus className="w-4 h-4" />
                Draw Segment
              </Button>
              {selectedSegmentId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditMode('edit')}
                  className="gap-2 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  <Pencil className="w-4 h-4" />
                  Edit Geometry
                </Button>
              )}
            </>
          )}
          {editMode !== 'view' && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setEditMode('view')}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Success/Error Messages */}
      {(error || successMessage) && (
        <div className="px-4 py-2 border-b border-gray-200">
          {error && (
            <Alert variant="destructive" className="text-sm border-red-200 bg-red-50 text-red-600">
              {error}
            </Alert>
          )}
          {successMessage && (
            <Alert className="text-sm bg-emerald-50 text-emerald-700 border-emerald-200">
              {successMessage}
            </Alert>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 border-r border-gray-200 flex flex-col">
          {/* Segment List */}
          <div className="flex-1 overflow-hidden">
            <SegmentList
              segments={segments}
              selectedSegmentId={selectedSegmentId}
              onSegmentSelect={handleSegmentSelect}
              isLoading={isLoading}
            />
          </div>

          {/* Form */}
          <div className="border-t border-gray-200 p-4 max-h-[50%] overflow-auto">
            <SegmentForm
              segment={selectedSegment}
              isNewSegment={!!pendingGeometry}
              pendingGeometry={pendingGeometry}
              onSave={handleSave}
              onDelete={handleDelete}
              onCancel={handleCancel}
              isSaving={isSaving}
            />
          </div>
        </div>

        {/* Map */}
        <div className="flex-1">
          <SegmentEditorMap
            segments={segments}
            selectedSegmentId={selectedSegmentId}
            onSegmentSelect={handleSegmentSelect}
            onSegmentCreated={handleSegmentCreated}
            onSegmentUpdated={handleSegmentUpdated}
            editMode={editMode}
          />
        </div>
      </div>
    </div>
  );
}
