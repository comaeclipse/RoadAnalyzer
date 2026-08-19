import * as turf from '@turf/turf';
import { routeLength, routeSimilarity, type RouteStep } from './route-signature';

type Template = { id: string; geometry: unknown; distance: number; direction: string | null };

/**
 * Least similarity that still counts as the same route.
 *
 * Tuned against every historical drive rather than guessed: see
 * scripts/diff-route-matching.ts. Over 30 drives, every one the old matcher
 * assigned scores 0.50 or better against its template, and every drive it left
 * unassigned scores 0.36 or worse. This sits in that gap. The separation is not
 * marginal -- each drive's runner-up template scores 0.26 or less, so nothing
 * is close to being matched to the wrong route.
 */
export const ROUTE_MATCH_THRESHOLD = 0.45;

/** A route template with the edge sequence its reference drive took. */
export interface TemplateSignature extends Template {
  steps: RouteStep[];
}

export interface RouteMatch {
  templateId: string;
  /** Length-weighted sequence similarity, or null when geometry decided it. */
  score: number | null;
  method: 'sequence' | 'geometry';
  /** Where the drive parted from the template it matched, when it did at all. */
  divergence: { at: number; left: string | null; right: string | null } | null;
}

/**
 * The template a drive belongs to.
 *
 * Preferred path is the edge sequence: a drive is an ordered list of durable
 * segment ids, and comparing those is exact where it should be exact. Geometry
 * proximity remains for drives whose sequence is too thin to judge -- a failed
 * or partial match leaves few segments, and a drive is better placed by fuzzy
 * geometry than not placed at all.
 */
export function matchRouteTemplate(
  drive: {
    steps: RouteStep[];
    geometry: GeoJSON.LineString;
    distance: number;
    direction: string | null;
  },
  templates: TemplateSignature[]
): RouteMatch | null {
  if (usableSequence(drive.steps, drive.distance)) {
    let best: RouteMatch | null = null;
    for (const template of templates) {
      // No direction gate here. The sequence is ordered, so a route driven the
      // other way scores low on its own merits -- and the gate was actively
      // wrong: it vetoed a drive matching its template at 0.80 because the
      // dominant cardinal direction of that day's trace came out west rather
      // than south.
      if (!usableSequence(template.steps, template.distance)) continue;
      const similarity = routeSimilarity(drive.steps, template.steps);
      if (similarity.score < ROUTE_MATCH_THRESHOLD) continue;
      if (!best || similarity.score > (best.score ?? 0)) {
        best = {
          templateId: template.id,
          score: similarity.score,
          method: 'sequence',
          divergence: similarity.divergence,
        };
      }
    }
    // A usable sequence that matches nothing is a real answer: this is a route
    // the driver has not taken before. Falling through to geometry here is what
    // would force a novel route onto an existing template.
    return best;
  }

  const templateId = findMatchingRouteTemplate(drive.geometry, drive.distance, drive.direction, templates);
  return templateId ? { templateId, score: null, method: 'geometry', divergence: null } : null;
}

/**
 * Whether an edge sequence covers enough of a drive to identify it.
 *
 * Both halves matter. Too few steps and any two drives down one arterial look
 * identical; too little of the drive's distance accounted for and the sequence
 * describes a fragment of a journey whose remainder could have gone anywhere.
 */
function usableSequence(steps: RouteStep[], distance: number): boolean {
  if (steps.length < 3) return false;
  return distance <= 0 || routeLength(steps) >= distance * 0.5;
}

/**
 * The original geometry matcher, kept as the fallback for drives whose segment
 * matching is too sparse to compare as a sequence.
 *
 * Its weaknesses are why it is no longer the primary: 75 m is wider than the
 * roads, so two parallel routes a block apart both pass; twenty subsampled
 * points miss a detour shorter than the sampling interval; and nothing about it
 * knows what order the roads came in.
 */
export function findMatchingRouteTemplate(
  geometry: GeoJSON.LineString,
  distance: number,
  direction: string | null,
  templates: Template[]
): string | null {
  if (geometry.coordinates.length < 2 || distance <= 0) return null;
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
