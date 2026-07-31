import * as turf from '@turf/turf';
import type { CardinalDirection } from '@prisma/client';

export type DirectionBreakdown = Record<Lowercase<CardinalDirection>, number>;

const DIRECTIONS: CardinalDirection[] = [
  'NORTH',
  'NORTHEAST',
  'EAST',
  'SOUTHEAST',
  'SOUTH',
  'SOUTHWEST',
  'WEST',
  'NORTHWEST',
];

export function cardinalDirection(bearing: number): CardinalDirection {
  const normalized = ((bearing % 360) + 360) % 360;
  return DIRECTIONS[Math.floor((normalized + 22.5) / 45) % DIRECTIONS.length];
}

export function analyzeDirections(geometry: GeoJSON.LineString): {
  netDirection: CardinalDirection | null;
  dominantDirection: CardinalDirection | null;
  directionBreakdown: DirectionBreakdown;
} {
  const totals = Object.fromEntries(
    DIRECTIONS.map((direction) => [direction.toLowerCase(), 0])
  ) as DirectionBreakdown;
  const coordinates = geometry.coordinates;

  for (let index = 0; index < coordinates.length - 1; index++) {
    const start = turf.point(coordinates[index]);
    const end = turf.point(coordinates[index + 1]);
    const distance = turf.distance(start, end, { units: 'meters' });
    if (!Number.isFinite(distance) || distance <= 0) continue;
    const direction = cardinalDirection(turf.bearing(start, end)).toLowerCase() as keyof DirectionBreakdown;
    totals[direction] += distance;
  }

  const totalDistance = Object.values(totals).reduce((sum, distance) => sum + distance, 0);
  if (totalDistance > 0) {
    for (const direction of Object.keys(totals) as Array<keyof DirectionBreakdown>) {
      totals[direction] = totals[direction] / totalDistance;
    }
  }

  const dominantEntry = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  const endpointDistance = coordinates.length >= 2
    ? turf.distance(turf.point(coordinates[0]), turf.point(coordinates[coordinates.length - 1]), { units: 'meters' })
    : 0;
  const netDirection = endpointDistance >= 20
    ? cardinalDirection(turf.bearing(turf.point(coordinates[0]), turf.point(coordinates[coordinates.length - 1])))
    : null;
  return {
    netDirection,
    dominantDirection: dominantEntry?.[1] > 0 ? dominantEntry[0].toUpperCase() as CardinalDirection : null,
    directionBreakdown: totals,
  };
}
