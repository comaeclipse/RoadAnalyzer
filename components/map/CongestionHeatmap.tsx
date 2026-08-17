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
    const isRoute = segment.kind === 'route';
    // Raw per-drive traces are a faint dashed underlay: thin and low-opacity so
    // many overlapping drives read as context, not a stack that buries the
    // aggregated, scored segments drawn on top of them.
    if (isRoute && !selected) {
      return {
        id: segment.segmentId,
        coordinates: segment.geometry.coordinates,
        color: congestionColor(segment.congestionScore),
        width: 2,
        opacity: selectedSegmentId ? 0.15 : 0.3,
        dashed: true,
        label: `Individual drive · ${segment.avgSpeed == null ? 'No speed' : `${(segment.avgSpeed * 2.23694).toFixed(0)} mph avg`}`,
      };
    }
    return {
      id: segment.segmentId,
      coordinates: segment.geometry.coordinates,
      color: selected ? '#1f2937' : congestionColor(segment.congestionScore),
      width: selected ? 6 : 4,
      opacity: selectedSegmentId && !selected ? 0.4 : 0.9,
      label: isRoute
        ? `Individual drive · ${segment.avgSpeed == null ? 'No speed' : `${(segment.avgSpeed * 2.23694).toFixed(0)} mph avg`}`
        : `${segment.name} · ${segment.congestionScore == null ? 'No score' : `${Math.round(segment.congestionScore)}/100`} · ${segment.eventCount} events`,
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
