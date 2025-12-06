'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoadSegmentResponse } from '@/types/segments';

const ROAD_TYPES = [
  { value: '', label: 'Not specified' },
  { value: 'HIGHWAY', label: 'Highway' },
  { value: 'ARTERIAL', label: 'Arterial' },
  { value: 'COLLECTOR', label: 'Collector' },
  { value: 'LOCAL', label: 'Local' },
  { value: 'RESIDENTIAL', label: 'Residential' },
];

interface SegmentFormProps {
  segment: RoadSegmentResponse | null;
  isNewSegment: boolean;
  pendingGeometry: GeoJSON.LineString | null;
  onSave: (data: { name: string; description: string; roadType: string | null; geometry?: GeoJSON.LineString }) => void;
  onDelete: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function SegmentForm({
  segment,
  isNewSegment,
  pendingGeometry,
  onSave,
  onDelete,
  onCancel,
  isSaving,
}: SegmentFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [roadType, setRoadType] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset form when segment changes
  useEffect(() => {
    if (segment) {
      setName(segment.name);
      setDescription(segment.description || '');
      setRoadType(segment.roadType || '');
    } else if (isNewSegment) {
      setName('');
      setDescription('');
      setRoadType('');
    }
    setShowDeleteConfirm(false);
  }, [segment, isNewSegment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const data: { name: string; description: string; roadType: string | null; geometry?: GeoJSON.LineString } = {
      name: name.trim(),
      description: description.trim(),
      roadType: roadType || null,
    };

    if (isNewSegment && pendingGeometry) {
      data.geometry = pendingGeometry;
    }

    onSave(data);
  };

  if (!segment && !isNewSegment) {
    return (
      <div className="text-center text-sm text-gray-500 py-4">
        Select a segment to edit, or draw a new one.
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">
        {isNewSegment ? 'New Segment' : 'Edit Segment'}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-gray-600 mb-1">
            Name
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
            placeholder="e.g., Main Street North"
            required
          />
        </div>

        {/* Road Type */}
        <div>
          <label htmlFor="roadType" className="block text-xs font-medium text-gray-600 mb-1">
            Road Type
          </label>
          <select
            id="roadType"
            value={roadType}
            onChange={(e) => setRoadType(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 bg-white"
          >
            {ROAD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-xs font-medium text-gray-600 mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 resize-none"
            placeholder="Optional notes..."
          />
        </div>

        {/* Segment Info (for existing segments) */}
        {segment && (
          <div className="pt-2 border-t border-gray-200">
            <div className="text-xs text-gray-500 space-y-1">
              <p>Points: {segment.geometry.coordinates.length}</p>
              {segment.eventCount !== undefined && segment.eventCount > 0 && (
                <p className="flex items-center gap-1">
                  Events: 
                  <Badge variant="outline" className="text-xs border-gray-300">
                    {segment.eventCount}
                  </Badge>
                </p>
              )}
              <p className="capitalize">Source: {segment.source.toLowerCase()}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || isSaving}
            className="flex-1 bg-gray-900 hover:bg-gray-800 text-white"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
            className="border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Button>
        </div>

        {/* Delete (only for existing segments) */}
        {segment && !isNewSegment && (
          <div className="pt-2 border-t border-gray-200">
            {!showDeleteConfirm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full text-red-600 border-red-200 hover:bg-red-50"
                disabled={isSaving}
              >
                Delete Segment
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-red-600">
                  Delete this segment and all associated events?
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={onDelete}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    disabled={isSaving}
                  >
                    Delete
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isSaving}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
