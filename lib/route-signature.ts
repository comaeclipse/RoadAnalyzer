/**
 * A drive as an ordered sequence of the roads it used.
 *
 * Route identity used to be geometry: subsample a drive to ~20 points and call
 * it a match when 75% of them land within 75 m of a stored centreline. That
 * tolerance is wider than the roads themselves, so two parallel routes a block
 * apart both satisfy it, and a ±30% distance band was doing the discrimination
 * the geometry test could not.
 *
 * Since segments became durable tiles (lib/segment-identity.ts), a drive
 * already is a sequence of stable ids. Comparing those sequences is exact where
 * it should be exact, and it can say *where* two routes diverge rather than
 * only how much.
 */

/** One run of consecutive samples on a single segment. */
export interface RouteStep {
  segmentId: string;
  /** Metres of the drive spent on this segment during this run. */
  meters: number;
  /** Samples in the run, used to judge whether a step is substantial. */
  sampleCount: number;
}

/** A GpsSegmentMatch, reduced to what route identity depends on. */
export interface MatchedSample {
  segmentId: string;
  /** Epoch milliseconds. Ordering follows this, never row order. */
  timestamp: number;
  /** Metres travelled since the previous sample of the drive. */
  distanceFromPrev: number | null;
}

/**
 * Samples that flip between two segments before settling count as noise below
 * this many metres. At a tile boundary the nearest tile alternates for a few
 * fixes, and left alone that produces A -> B -> A -> B where the drive simply
 * crossed from A to B once.
 */
const MIN_STEP_METERS = 25;

/**
 * The ordered runs a drive spent on each segment.
 *
 * Consecutive samples on one segment collapse into a single step: a drive
 * dwelling on one road produces hundreds of matches for one edge, and the
 * sequence is about which roads in which order, not how many fixes landed.
 *
 * A genuine revisit is preserved. Driving a loop that returns to a road really
 * is that road twice, and flattening it would make a loop indistinguishable
 * from an out-and-back.
 */
export function routeSteps(samples: MatchedSample[]): RouteStep[] {
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const runs: RouteStep[] = [];

  for (const sample of ordered) {
    const last = runs[runs.length - 1];
    if (last && last.segmentId === sample.segmentId) {
      last.meters += sample.distanceFromPrev ?? 0;
      last.sampleCount++;
      continue;
    }
    runs.push({
      segmentId: sample.segmentId,
      meters: sample.distanceFromPrev ?? 0,
      sampleCount: 1,
    });
  }

  return collapseFlapping(runs);
}

/**
 * Drop steps too short to be a real traversal, merging them into whichever
 * neighbour they interrupted.
 *
 * Only a step sandwiched between two runs of the same segment is treated as
 * flapping. A short step between two *different* segments is a real, if brief,
 * traversal — a short connector counts.
 */
function collapseFlapping(runs: RouteStep[]): RouteStep[] {
  const kept: RouteStep[] = [];

  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    const previous = kept[kept.length - 1];
    const next = runs[index + 1];
    const interrupts = previous && next &&
      previous.segmentId === next.segmentId &&
      run.meters < MIN_STEP_METERS;

    if (interrupts) {
      previous.meters += run.meters;
      previous.sampleCount += run.sampleCount;
      continue;
    }
    if (previous && previous.segmentId === run.segmentId) {
      previous.meters += run.meters;
      previous.sampleCount += run.sampleCount;
      continue;
    }
    kept.push({ ...run });
  }

  return kept;
}

/** Total ground the sequence accounts for. */
export function routeLength(steps: RouteStep[]): number {
  return steps.reduce((total, step) => total + step.meters, 0);
}

/** How alike two drives are, and where they stopped agreeing. */
export interface RouteSimilarity {
  /**
   * Metres the two routes share, over the metres they cover between them.
   * Weighted by distance rather than by step count so that a dozen short
   * residential stubs cannot outvote the arterial that is most of the drive.
   */
  score: number;
  /** Metres of common ground. */
  sharedMeters: number;
  /**
   * The first segment each route took where they parted, or null when one is a
   * prefix of the other or they never agree at all. This is the answer to
   * "where do these two routes differ", which a scalar score cannot give.
   */
  divergence: { at: number; left: string | null; right: string | null } | null;
}

/**
 * Length-weighted similarity between two edge sequences.
 *
 * The shared quantity is the longest common subsequence measured in metres, so
 * order counts: two drives over the same roads in a different sequence are not
 * the same route. A short detour costs only the detour; diverging for half the
 * drive costs half the drive. That is the property the old point-counting got
 * wrong -- it scored both by how many sampled points happened to sit near a
 * line.
 */
export function routeSimilarity(left: RouteStep[], right: RouteStep[]): RouteSimilarity {
  const leftTotal = routeLength(left);
  const rightTotal = routeLength(right);
  if (leftTotal <= 0 || rightTotal <= 0) {
    return { score: 0, sharedMeters: 0, divergence: { at: 0, left: left[0]?.segmentId ?? null, right: right[0]?.segmentId ?? null } };
  }

  // Longest common subsequence, scored in metres. A matched pair contributes
  // the shorter of the two runs: agreeing about a road is worth what both
  // drives actually spent on it.
  const rows = left.length;
  const columns = right.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      table[i][j] = left[i - 1].segmentId === right[j - 1].segmentId
        ? table[i - 1][j - 1] + Math.min(left[i - 1].meters, right[j - 1].meters)
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const sharedMeters = table[rows][columns];
  // Symmetric by construction: both routes are measured against the same union.
  const score = sharedMeters / (leftTotal + rightTotal - sharedMeters);

  return { score, sharedMeters, divergence: firstDivergence(left, right) };
}

/** The first step at which the two sequences stop agreeing. */
function firstDivergence(
  left: RouteStep[],
  right: RouteStep[]
): RouteSimilarity['divergence'] {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    if (left[index].segmentId !== right[index].segmentId) {
      return { at: index, left: left[index].segmentId, right: right[index].segmentId };
    }
  }
  // One ran out first. That is a prefix, not a disagreement about direction.
  return null;
}
