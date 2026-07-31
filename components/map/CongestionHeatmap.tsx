'use client';

import { useMemo } from 'react';
import { MapboxLineMap } from '@/components/maps/MapboxLineMap';
import type { HeatmapSegment } from '@/types/congestion';

interface CongestionHeatmapProps {
  segments: HeatmapSegment[];
  selectedSegmentId: string | null;
  onSegmentSelect: (id: string | null) => void;
}

function congestionColor(score: number | null): string {
  if (score == null) return '#9ca3af';
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

export default function CongestionHeatmap({
  segments,
  selectedSegmentId,
  onSegmentSelect,
}: CongestionHeatmapProps) {
  const lines = useMemo(() => segments.map((segment) => {
    const selected = segment.segmentId === selectedSegmentId;
    return {
      id: segment.segmentId,
      coordinates: segment.geometry.coordinates,
      color: selected ? '#1f2937' : congestionColor(segment.congestionScore),
      width: selected ? 6 : 4,
      opacity: selectedSegmentId && !selected ? 0.4 : 0.9,
      label: `${segment.name} · ${segment.congestionScore == null ? 'No score' : `${Math.round(segment.congestionScore)}/100`} · ${segment.eventCount} events`,
    };
  }), [segments, selectedSegmentId]);

  return (
    <MapboxLineMap
      lines={lines}
      className="h-[calc(100vh-12rem)] min-h-[400px] w-full"
      onLineClick={(id) => onSegmentSelect(id === selectedSegmentId ? null : id)}
    />
  );
}
