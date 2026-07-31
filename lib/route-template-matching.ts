import * as turf from '@turf/turf';

type Template = { id: string; geometry: unknown; distance: number; direction: string | null };

export function findMatchingRouteTemplate(
  geometry: GeoJSON.LineString,
  distance: number,
  direction: string | null,
  templates: Template[]
): string | null {
  if (geometry.coordinates.length < 2 || distance <= 0) return null;
  const route = turf.lineString(geometry.coordinates);
  for (const template of templates) {
    if (template.direction && direction && template.direction !== direction) continue;
    if (distance < template.distance * 0.7 || distance > template.distance * 1.3) continue;
    const candidate = template.geometry as GeoJSON.LineString;
    if (candidate?.type !== 'LineString' || candidate.coordinates.length < 2) continue;
    const reference = turf.lineString(candidate.coordinates);
    const samples = geometry.coordinates.filter((_, index) => index % Math.max(1, Math.floor(geometry.coordinates.length / 20)) === 0);
    const nearby = samples.filter((point) => Number(turf.nearestPointOnLine(reference, turf.point(point), { units: 'meters' }).properties.dist) <= 75);
    if (samples.length > 0 && nearby.length / samples.length >= 0.75) return template.id;
  }
  return null;
}
