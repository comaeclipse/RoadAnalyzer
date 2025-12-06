/**
 * TypeScript types for congestion analysis
 */

import { CongestionSeverity } from '@prisma/client';

export interface CongestionEventResponse {
  id: string;
  createdAt: Date;
  driveId: string;
  segmentId: string;
  segmentName?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  dayOfWeek: number;
  hourOfDay: number;
  weekOfYear: number;
  severity: CongestionSeverity;
  avgSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  distance: number;
}

export interface SegmentStatisticsResponse {
  id: string;
  updatedAt: Date;
  segmentId: string;
  segmentName?: string;
  dayOfWeek: number | null;
  hourOfDay: number | null;
  weekStart: Date | null;
  sampleCount: number;
  eventCount: number;
  totalDuration: number;
  avgSpeed: number | null;
  avgCongestionSpeed: number | null;
  pctFreeFlow: number;
  pctSlow: number;
  pctCongested: number;
  pctHeavy: number;
  pctGridlock: number;
  congestionScore: number | null;
}

export interface HeatmapSegment {
  segmentId: string;
  name: string;
  geometry: GeoJSON.LineString;
  congestionScore: number | null;
  eventCount: number;
  avgSpeed: number | null;
  severityBreakdown: {
    freeFlow: number;
    slow: number;
    congested: number;
    heavy: number;
    gridlock: number;
  };
}

export interface HeatmapResponse {
  heatmap: HeatmapSegment[];
}

export interface TrendsResponse {
  trends: SegmentStatisticsResponse[];
}

export interface EventsResponse {
  events: CongestionEventResponse[];
}

export interface StatisticsResponse {
  statistics: SegmentStatisticsResponse[];
}
