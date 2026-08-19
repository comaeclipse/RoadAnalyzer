/**
 * Intersection Stop Analysis
 *
 * Answers "how often do I actually get stopped here?" for the places a route
 * passes through repeatedly.
 *
 * The probability is only meaningful with a denominator: being stopped at a
 * light four times means nothing until you know whether you passed it four
 * times or forty. So every cluster counts both the stops and the traversals.
 *
 * Approach direction is part of a cluster's identity. The two stop lines of one
 * intersection sit tens of metres apart on opposite sides and face different
 * signal phases, so merging them would average two unrelated things together.
 */

export interface AnalysisPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
  /** Matched road name, when trip analysis produced one. */
  roadName?: string | null;
}

export interface AnalysisTag {
  lat: number;
  lng: number;
  kind: string;
  /**
   * Approach heading when the driver placed the tag, degrees clockwise from
   * north. Null when unknown, in which case the tag is only trusted very close
   * to a cluster centre.
   */
  bearing?: number | null;
  /**
   * When the tag was placed. Used to recover a bearing from the drive's own
   * trace for tags that carry none.
   */
  timestamp?: number | null;
}

export interface AnalysisDrive {
  id: string;
  name: string | null;
  startTime: string;
  points: AnalysisPoint[];
  tags?: AnalysisTag[];
}

export interface StopEvent {
  driveId: string;
  driveName: string | null;
  driveStartTime: string;
  lat: number;
  lng: number;
  timestamp: number;
  /** Milliseconds stationary. */
  duration: number;
  /** Direction of travel on approach, degrees clockwise from north. */
  bearing: number;
  roadName: string | null;
}

export interface IntersectionApproach {
  id: string;
  lat: number;
  lng: number;
  bearing: number;
  direction: string;
  roadName: string | null;
  kind: string;
  /** Traversals in this direction, stopped or not. The denominator. */
  passes: number;
  /**
   * True when traversals had to be raised to meet the stop count, meaning the
   * denominator could not be measured directly and the rate is a floor.
   */
  passesClamped: boolean;
  stopCount: number;
  probability: number;
  /** Wilson 95% interval, so a 2-of-2 does not read as a certainty. */
  confidenceLow: number;
  confidenceHigh: number;
  medianDelay: number;
  maxDelay: number;
  totalDelay: number;
  /**
   * Time this approach costs on an average traversal: probability x median
   * delay. The ranking metric, because neither half answers the question alone
   * -- a light you always catch but that releases you in 10 s costs less than
   * one you catch a third of the time and then sit at for 90 s, and total delay
   * just measures how often you have driven the road.
   */
  expectedDelay: number;
  stops: StopEvent[];
}

export interface AnalysisOptions {
  /** Speed at or below which a sample counts as stationary (m/s). */
  stoppedSpeed: number;
  /** Shortest stationary period that counts as a stop (ms). */
  minStopDuration: number;
  /** Stops within this distance may share a cluster (m). */
  clusterRadius: number;
  /** Distance within which a drive counts as traversing the cluster (m). */
  passRadius: number;
  /** Approach headings within this many degrees are the same direction. */
  bearingTolerance: number;
  /** Distance back along the trace used to measure approach heading (m). */
  approachLookback: number;
  /**
   * Longest stationary period that can still be a traffic control (ms).
   * Anything longer is the car parked, not the car waiting.
   */
  maxStopDuration: number;
  /**
   * Radius within which a tag carrying no approach heading may still label a
   * cluster (m). Tighter than clusterRadius because without a heading, position
   * is the only evidence that the tag belongs to this approach.
   */
  taglessRadius: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  stoppedSpeed: 0.5,
  // Matches StopDetector.minStopDuration on the phone. These two must agree:
  // the phone prompts for a tag at 2 s, so a higher gate here would attach
  // "Stop sign" labels to approaches whose stop count was measured with a
  // threshold that excludes stop-sign stops. At 5 s a 1.5-3.5 s stop-sign stop
  // was invisible to this half, and those rows read as low-probability however
  // reliably the driver stopped.
  minStopDuration: 2_000,
  // Queues at major signals can extend beyond a single car length. 60 m keeps
  // successive move-and-stop samples at one approach together without merging
  // opposing approaches.
  clusterRadius: 60,
  passRadius: 45,
  bearingTolerance: 60,
  approachLookback: 60,
  // Signal cycles top out near 150 s even on the worst arterials, and the
  // longest stop in the current dataset that is plausibly a light is 149 s.
  // The one period above this bound is 17 minutes -- the car parked partway
  // through a drive. Left in, it ranked first by total delay and would rank
  // first by expected delay too, describing an errand as the worst light on
  // the commute. The traversal still counts in the denominator; only the
  // stationary period is discarded.
  maxStopDuration: 300_000,
  taglessRadius: 25,
};

/**
 * Force the pass bubble to contain the cluster bubble.
 *
 * The numerator and denominator must be measured over the same ground. If
 * clusterRadius exceeds passRadius there is an annulus where a stop joins a
 * cluster but the very drive that produced it fails the traversal test, so
 * probabilities are biased upward — an approach that should read "3 of 7"
 * reads "3 of 3". Widening passRadius to match is the safe direction: it can
 * only ever add traversals to the denominator.
 */
export function resolveOptions(options: AnalysisOptions): AnalysisOptions {
  return options.passRadius >= options.clusterRadius
    ? options
    : { ...options, passRadius: options.clusterRadius };
}

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Fewest metres one degree of latitude can be worth. Great-circle distance is
 * never less than the north-south separation, so a pair further apart than this
 * in latitude alone is further apart than the radius, whatever the longitude
 * does.
 */
const MIN_METERS_PER_DEGREE_LAT = 110_574;

/**
 * Cheap, exact rejection for a point that cannot be within `meters`.
 *
 * The expensive half of this module is asking whether each sample of each drive
 * is inside each cluster -- clusters x drives x points haversines, the term that
 * grows fastest as history accumulates. A drive spans tens of kilometres of
 * latitude and a cluster is 90 m across, so nearly every pair is rejected by one
 * subtraction. Never rejects a pair haversine would have accepted, so it changes
 * no result.
 */
function beyondLatitudeBand(
  a: { lat: number },
  b: { lat: number },
  meters: number
): boolean {
  return Math.abs(a.lat - b.lat) * MIN_METERS_PER_DEGREE_LAT > meters;
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDegrees(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two bearings, in [0, 180]. */
export function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function cardinal(bearing: number): string {
  return COMPASS[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

export function directionLabel(bearing: number): string {
  const names: Record<string, string> = {
    N: 'northbound', NE: 'northeast-bound', E: 'eastbound', SE: 'southeast-bound',
    S: 'southbound', SW: 'southwest-bound', W: 'westbound', NW: 'northwest-bound',
  };
  return names[cardinal(bearing)];
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Preferred over the normal approximation because the counts here are tiny and
 * often land on 0 or 1, where the simple interval collapses to zero width and
 * claims a certainty the data does not support.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): {
  low: number;
  high: number;
} {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = (p + (z * z) / (2 * trials)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denominator;
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Direction of travel arriving at points[index].
 *
 * Walks back along the trace until roughly lookbackMeters of ground has been
 * covered, so the bearing reflects the approach rather than GPS jitter between
 * two adjacent samples while stationary.
 */
export function approachBearing(
  points: AnalysisPoint[],
  index: number,
  lookbackMeters: number
): number | null {
  const target = points[index];
  let travelled = 0;
  for (let i = index; i > 0; i--) {
    travelled += haversineMeters(points[i - 1], points[i]);
    if (travelled >= lookbackMeters) return bearingDegrees(points[i - 1], target);
  }
  // Trace starts inside the lookback window; use whatever is available.
  return points.length > 1 && travelled > 5 ? bearingDegrees(points[0], target) : null;
}

/**
 * Speed at a sample, or null when it cannot be established.
 *
 * A missing Doppler speed is missing information, not zero. Coalescing it to
 * zero fires a stop every time GPS quality dips at highway speed, which is the
 * failure StopDetector.effectiveSpeed on the phone exists to avoid. Positions
 * survive dropouts that speed does not, so fall back to differencing them, and
 * return null rather than a guess when even that is unusable.
 *
 * CoreLocation reports -1 for an invalid speed, so negatives are rejected
 * alongside nulls.
 */
export function effectiveSpeed(
  point: AnalysisPoint,
  previous: AnalysisPoint | null
): number | null {
  if (point.speed !== null && point.speed !== undefined && point.speed >= 0) {
    return point.speed;
  }
  if (!previous) return null;
  const dtSeconds = (point.timestamp - previous.timestamp) / 1000;
  // Too short and jitter dominates; too long and the gap says nothing about
  // whether the vehicle was moving throughout it.
  if (dtSeconds < 0.2 || dtSeconds > 10) return null;
  return haversineMeters(previous, point) / dtSeconds;
}

/** Contiguous stationary periods long enough to count as a stop. */
export function detectStops(
  drive: AnalysisDrive,
  options: AnalysisOptions = DEFAULT_OPTIONS
): StopEvent[] {
  const { points } = drive;
  const events: StopEvent[] = [];
  let start: number | null = null;

  const flush = (endIndex: number) => {
    if (start === null) return;
    const duration = points[endIndex].timestamp - points[start].timestamp;
    // Bounded at both ends. Below minStopDuration is a crawl rather than a
    // stop; above maxStopDuration is parking, which no signal explains and
    // which would otherwise dominate every delay figure it touches.
    if (duration >= options.minStopDuration && duration <= options.maxStopDuration) {
      const bearing = approachBearing(points, start, options.approachLookback);
      if (bearing !== null) {
        events.push({
          driveId: drive.id,
          driveName: drive.name,
          driveStartTime: drive.startTime,
          lat: points[start].lat,
          lng: points[start].lng,
          timestamp: points[start].timestamp,
          duration,
          bearing,
          roadName: points[start].roadName ?? null,
        });
      }
    }
    start = null;
  };

  for (let i = 0; i < points.length; i++) {
    const speed = effectiveSpeed(points[i], i > 0 ? points[i - 1] : null);
    // Unknown speed ends any open stop rather than extending it. Splitting one
    // real stop across a dropout costs a stop; treating the dropout as
    // stationary invents them wherever reception is poor.
    if (speed === null) {
      if (start !== null) flush(i - 1);
      continue;
    }
    const stopped = speed <= options.stoppedSpeed;
    if (stopped && start === null) start = i;
    if (!stopped && start !== null) flush(i - 1);
  }
  if (start !== null) flush(points.length - 1);

  return events;
}

/** One continuous period a drive spent inside a cluster. */
export interface ClusterVisit {
  /** Timestamp of the first sample inside the cluster on this visit. */
  startTimestamp: number;
  /** Timestamp of the last sample inside the cluster on this visit. */
  endTimestamp: number;
  /** Whether the heading nearest the centre matched the cluster's. */
  matchesApproach: boolean;
}

/**
 * The separate occasions a drive passed through a cluster.
 *
 * A drive may pass the same spot more than once, so contiguous runs of nearby
 * samples are collapsed into one visit each.
 *
 * This is the unit both halves of the ratio are counted in. The denominator
 * counts qualifying visits; the numerator counts visits on which the driver
 * was stopped, which is why the stops themselves are matched back to a visit
 * rather than tallied individually.
 */
export function findVisits(
  drive: AnalysisDrive,
  cluster: { lat: number; lng: number; bearing: number },
  rawOptions: AnalysisOptions = DEFAULT_OPTIONS
): ClusterVisit[] {
  const options = resolveOptions(rawOptions);
  const { points } = drive;
  const visits: ClusterVisit[] = [];
  let insideSince: number | null = null;

  const closeVisit = (endIndex: number) => {
    if (insideSince === null) return;
    // Heading measured at the point nearest the cluster centre in this visit.
    let nearest = insideSince;
    let nearestDistance = Infinity;
    for (let i = insideSince; i <= endIndex; i++) {
      const distance = haversineMeters(points[i], cluster);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = i;
      }
    }
    const bearing = approachBearing(points, nearest, options.approachLookback);
    visits.push({
      startTimestamp: points[insideSince].timestamp,
      endTimestamp: points[endIndex].timestamp,
      matchesApproach:
        bearing !== null && bearingDelta(bearing, cluster.bearing) <= options.bearingTolerance,
    });
    insideSince = null;
  };

  for (let i = 0; i < points.length; i++) {
    const inside = !beyondLatitudeBand(points[i], cluster, options.passRadius) &&
      haversineMeters(points[i], cluster) <= options.passRadius;
    if (inside && insideSince === null) insideSince = i;
    if (!inside && insideSince !== null) closeVisit(i - 1);
  }
  if (insideSince !== null) closeVisit(points.length - 1);

  return visits;
}

/**
 * Count traversals of a location in a given direction.
 *
 * A visit counts only if the drive was heading the same way as the cluster.
 */
export function countPasses(
  drive: AnalysisDrive,
  cluster: { lat: number; lng: number; bearing: number },
  rawOptions: AnalysisOptions = DEFAULT_OPTIONS
): number {
  return findVisits(drive, cluster, rawOptions).filter((visit) => visit.matchesApproach).length;
}

/**
 * One stopped traversal, described by its longest stationary fragment.
 *
 * Duration is the sum, because what the approach cost on that pass is the
 * whole time spent stationary there, not the longest single fragment of it.
 */
function combineStops(group: StopEvent[]): StopEvent {
  if (group.length === 1) return group[0];
  const longest = group.reduce((a, b) => (b.duration > a.duration ? b : a));
  return {
    ...longest,
    timestamp: Math.min(...group.map((stop) => stop.timestamp)),
    duration: group.reduce((total, stop) => total + stop.duration, 0),
  };
}

/**
 * Collapse stops made on a single traversal into one stopped visit.
 *
 * Creeping forward in a queue produces several stationary periods, but a visit
 * is one traversal however many times the queue moved. Left separate they
 * count one stopped pass several times over against a denominator that counted
 * it once, and report a median describing a fragment of the wait rather than
 * the wait.
 *
 * Grouping is by visit rather than by drive, so a genuine second approach later
 * in the same drive stays its own stop.
 */
function mergeStopsPerVisit(
  stops: StopEvent[],
  visitsByDrive: Map<string, ClusterVisit[]>
): StopEvent[] {
  const groups = new Map<string, StopEvent[]>();

  stops.forEach((stop, index) => {
    const visits = visitsByDrive.get(stop.driveId) ?? [];
    const visitIndex = visits.findIndex(
      (visit) => stop.timestamp >= visit.startTimestamp && stop.timestamp <= visit.endTimestamp
    );
    // A stop matching no visit keeps its own identity rather than being folded
    // into an unrelated one.
    const key = visitIndex === -1 ? `${stop.driveId}:orphan:${index}` : `${stop.driveId}:${visitIndex}`;
    const existing = groups.get(key);
    if (existing) existing.push(stop);
    else groups.set(key, [stop]);
  });

  return Array.from(groups.values(), combineStops);
}

/**
 * Mean of a set of bearings, in [0, 360).
 *
 * Bearings wrap, so averaging them arithmetically puts the mean of 350 and 10
 * at 180 — pointing the opposite way. Averaging the unit vectors instead keeps
 * the result on the correct side of north.
 *
 * Returns null when the vectors cancel, which means the set has no central
 * direction to speak of; callers keep whatever they had.
 */
export function circularMeanBearing(bearings: number[]): number | null {
  if (bearings.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const bearing of bearings) {
    const radians = toRadians(bearing);
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Approach heading of the drive at `timestamp`, or null when the trace has
 * nothing usable near it.
 *
 * Tags placed on the phone carry the heading the driver was travelling; older
 * ones, and any placed in the web UI, do not. Since the tag names a moment in a
 * drive we already hold, the heading can be read back off the trace instead of
 * being treated as unknown.
 */
export function bearingAtTime(
  drive: AnalysisDrive,
  timestamp: number | null,
  options: AnalysisOptions = DEFAULT_OPTIONS
): number | null {
  if (timestamp == null || drive.points.length < 2) return null;
  let nearest = -1;
  let nearestGap = Infinity;
  drive.points.forEach((point, index) => {
    const gap = Math.abs(point.timestamp - timestamp);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = index;
    }
  });
  // Beyond this the nearest fix says nothing about where the car was pointing
  // when the tag was placed.
  if (nearest < 0 || nearestGap > 15_000) return null;
  return approachBearing(drive.points, nearest, options.approachLookback);
}

/**
 * Deterministic identity for an approach: where it is, and which way you are
 * going through it. Rounded to about 11 m, which is inside the cluster radius,
 * so the same approach keeps its id as its centroid drifts with new stops.
 */
export function approachId(lat: number, lng: number, bearing: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}:${cardinal(bearing)}`;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Group stops into approach clusters, then measure each against how often the
 * same approach was traversed at all.
 *
 * Results are ranked by expected delay per traversal, which is the only one of
 * the available figures that answers "which of these costs my commute the most
 * time?". Stop probability alone over-weights a light you always catch but that
 * releases you quickly; total delay alone is confounded by exposure, since an
 * approach driven 40 times out-ranks one driven 4 times whatever happens at
 * either. Exposure is still worth filtering on separately: an approach measured
 * over one traversal can report a large expected delay on no evidence.
 */
export function analyzeIntersections(
  drives: AnalysisDrive[],
  rawOptions: AnalysisOptions = DEFAULT_OPTIONS
): IntersectionApproach[] {
  const options = resolveOptions(rawOptions);
  const allStops = drives.flatMap((drive) => detectStops(drive, options));

  // Greedy clustering on position and heading together. Each cluster carries a
  // running centre and mean heading, so membership is tested against the group
  // as a whole rather than against whichever stop happened to seed it. With a
  // frozen seed a slightly skewed first stop drags the accepted cone with it,
  // and at 60 degrees of tolerance that cone can end up well off the heading
  // the group actually represents.
  const clusters: {
    stops: StopEvent[];
    lat: number;
    lng: number;
    bearing: number;
  }[] = [];

  for (const stop of allStops) {
    // Nearest acceptable cluster, not the first one found. Where two clusters
    // are both in range, taking the first makes membership depend on the order
    // the groups happened to be created in.
    let match: (typeof clusters)[number] | null = null;
    let matchDistance = Infinity;
    for (const cluster of clusters) {
      if (beyondLatitudeBand(stop, cluster, options.clusterRadius)) continue;
      const distance = haversineMeters(stop, cluster);
      if (distance > options.clusterRadius || distance >= matchDistance) continue;
      if (bearingDelta(stop.bearing, cluster.bearing) > options.bearingTolerance) continue;
      match = cluster;
      matchDistance = distance;
    }
    if (match) {
      match.stops.push(stop);
      match.lat = match.stops.reduce((sum, s) => sum + s.lat, 0) / match.stops.length;
      match.lng = match.stops.reduce((sum, s) => sum + s.lng, 0) / match.stops.length;
      match.bearing = circularMeanBearing(match.stops.map((s) => s.bearing)) ?? match.bearing;
    } else {
      clusters.push({ stops: [stop], lat: stop.lat, lng: stop.lng, bearing: stop.bearing });
    }
  }

  // A tag's own approach heading, recovered from the drive's trace when the
  // tag did not carry one. Without it a tag on the opposing stop line labels
  // this approach: at a 60 m cluster radius both stop lines of an ordinary
  // intersection sit inside the bubble, which is exactly the merge the rest of
  // this module refuses to make.
  const taggedPoints: AnalysisTag[] = drives.flatMap((drive) =>
    (drive.tags ?? []).map((tag) => ({
      ...tag,
      bearing: tag.bearing ?? bearingAtTime(drive, tag.timestamp ?? null, options),
    }))
  );

  return clusters
    .map((cluster) => {
      const { lat, lng, bearing } = cluster;
      const centre = { lat, lng, bearing };

      // Visits are the unit both halves are counted in, so derive them once and
      // measure the denominator and the numerator against the same list.
      const visitsByDrive = new Map(
        drives.map((drive) => [drive.id, findVisits(drive, centre, options)] as const)
      );
      const passes = Array.from(visitsByDrive.values()).reduce(
        (total, visits) => total + visits.filter((visit) => visit.matchesApproach).length,
        0
      );
      const group = mergeStopsPerVisit(cluster.stops, visitsByDrive);
      // Both halves are now counted in visits, and resolveOptions keeps every
      // clustered stop inside the pass bubble, so passes should cover
      // stopCount. The residual case is a stop whose own approach bearing
      // matched the cluster while the bearing measured at the nearest point of
      // its visit did not, leaving the visit unqualified. Clamping keeps the
      // ratio possible; passesClamped marks the row as measured on shakier
      // ground rather than hiding the disagreement behind a tidy percentage.
      const stopCount = group.length;
      const passesClamped = passes < stopCount;
      const trials = Math.max(passes, stopCount);

      const durations = group.map((s) => s.duration);
      const nearbyKinds = taggedPoints
        .filter((tag) => {
          const distance = haversineMeters(tag, { lat, lng });
          if (tag.bearing == null) return distance <= options.taglessRadius;
          return distance <= options.clusterRadius &&
            bearingDelta(tag.bearing, bearing) <= options.bearingTolerance;
        })
        .map((tag) => tag.kind);

      const { low, high } = wilsonInterval(stopCount, trials);
      const probability = trials === 0 ? 0 : stopCount / trials;
      const medianDelay = median(durations);

      return {
        // Identity follows the place, not the sort order. Loop indices were
        // reassigned by rank whenever a drive was added, so the page's attempt
        // to hold a selection across a refetch could silently re-point at a
        // different intersection.
        id: approachId(lat, lng, bearing),
        lat,
        lng,
        bearing,
        direction: directionLabel(bearing),
        roadName: mostCommon(group.flatMap((s) => (s.roadName ? [s.roadName] : []))),
        kind: mostCommon(nearbyKinds) ?? 'UNCLASSIFIED',
        passes: trials,
        passesClamped,
        stopCount,
        probability,
        confidenceLow: low,
        confidenceHigh: high,
        medianDelay,
        maxDelay: Math.max(...durations),
        totalDelay: durations.reduce((sum, value) => sum + value, 0),
        expectedDelay: probability * medianDelay,
        stops: [...group].sort((a, b) => b.timestamp - a.timestamp),
      };
    })
    .sort((a, b) => b.expectedDelay - a.expectedDelay);
}
