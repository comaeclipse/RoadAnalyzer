'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { RoadSegmentResponse } from '@/types/segments';

const ROAD_TYPE_COLORS: Record<string, string> = {
  HIGHWAY: 'bg-red-50 text-red-700 border-red-200',
  ARTERIAL: 'bg-orange-50 text-orange-700 border-orange-200',
  COLLECTOR: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  LOCAL: 'bg-blue-50 text-blue-700 border-blue-200',
  RESIDENTIAL: 'bg-gray-50 text-gray-700 border-gray-200',
};

interface SegmentListProps {
  segments: RoadSegmentResponse[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
  isLoading: boolean;
}

export function SegmentList({
  segments,
  selectedSegmentId,
  onSegmentSelect,
  isLoading,
}: SegmentListProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSegments = segments.filter((segment) =>
    segment.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Segments</p>
          <Badge variant="outline" className="text-xs border-gray-300">{segments.length}</Badge>
        </div>
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 bg-gray-50"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 text-center text-gray-500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400 mx-auto mb-2"></div>
            <p className="text-xs">Loading...</p>
          </div>
        ) : filteredSegments.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {searchTerm ? 'No matches found.' : 'No segments yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filteredSegments.map((segment) => {
              const isSelected = segment.id === selectedSegmentId;
              return (
                <li key={segment.id}>
                  <button
                    onClick={() => onSegmentSelect(isSelected ? null : segment.id)}
                    className={`w-full px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-gray-100 border-l-2 border-gray-900' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-gray-900' : 'text-gray-700'}`}>
                          {segment.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {segment.roadType && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs py-0 ${ROAD_TYPE_COLORS[segment.roadType] || 'border-gray-200'}`}
                            >
                              {segment.roadType.toLowerCase()}
                            </Badge>
                          )}
                          {segment.eventCount !== undefined && segment.eventCount > 0 && (
                            <span className="text-xs text-gray-400">
                              {segment.eventCount} events
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-400">
                        {segment.geometry.coordinates.length} pts
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
