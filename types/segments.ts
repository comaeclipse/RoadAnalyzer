/**
 * TypeScript types for road segments
 */

import { RoadType, SegmentSource } from '@prisma/client';

export interface CreateSegmentRequest {
  name: string;
  description?: string;
  geometry: GeoJSON.LineString;
  roadType?: RoadType;
}

export interface UpdateSegmentRequest {
  name?: string;
  description?: string;
  geometry?: GeoJSON.LineString;
  roadType?: RoadType;
}

export interface RoadSegmentResponse {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  description: string | null;
  geometry: GeoJSON.LineString;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  roadType: RoadType | null;
  source: SegmentSource;
  sourceId: string | null;
  eventCount?: number;
}

export interface SegmentListResponse {
  segments: RoadSegmentResponse[];
}
