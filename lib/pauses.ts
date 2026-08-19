/**
 * Pause-aware helpers shared by ingest, analysis, and the map UI.
 *
 * A pause is a span the driver removed from the drive. No GPS is recorded
 * across it, so any two samples that straddle one are not neighbours: joining
 * them draws a line down a road that was never driven, and measuring between
 * them counts distance that was never travelled. Everything that walks a trace
 * pairwise has to break at these boundaries.
 */
export interface PauseSpan {
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds, or null/absent for a pause a dead session never closed. */
  endedAt?: number | null;
}

/**
 * True when `timestamp` falls inside any pause. An open pause runs to
 * `fallbackEnd` -- the end of the drive -- since a session that died mid-pause
 * never came back to close it.
 */
export function isWithinPause(
  pauses: readonly PauseSpan[] | undefined,
  timestamp: number,
  fallbackEnd: number
): boolean {
  if (!pauses?.length) return false;
  return pauses.some(
    (pause) => timestamp >= pause.startedAt && timestamp <= Math.min(pause.endedAt ?? fallbackEnd, fallbackEnd)
  );
}

/**
 * True when the leg from `before` to `after` crosses a pause, either because
 * one of its endpoints sits inside one or because a whole pause fits between
 * them. The second case is the common one: with GPS off, the samples bracketing
 * a pause are both outside it.
 */
export function straddlesPause(
  pauses: readonly PauseSpan[] | undefined,
  before: number,
  after: number,
  fallbackEnd: number
): boolean {
  if (!pauses?.length) return false;
  return pauses.some((pause) => {
    const end = Math.min(pause.endedAt ?? fallbackEnd, fallbackEnd);
    return pause.startedAt <= after && end >= before;
  });
}

/**
 * Splits a time-ordered trace into the runs that were actually recorded,
 * dropping anything captured inside a pause. Returns one group per run so
 * callers can draw or measure each independently; a trace with no pauses comes
 * back as a single group.
 */
export function splitAtPauses<T>(
  items: readonly T[],
  pauses: readonly PauseSpan[] | undefined,
  timestampOf: (item: T) => number,
  fallbackEnd: number
): T[][] {
  if (!items.length) return [];
  if (!pauses?.length) return [items.slice()];

  const spans: T[][] = [];
  let current: T[] = [];
  let previous: number | null = null;

  for (const item of items) {
    const timestamp = timestampOf(item);
    // Recorded during a pause at all: a stray fix from before GPS wound down,
    // or from a build that stored significant-change updates while paused.
    if (isWithinPause(pauses, timestamp, fallbackEnd)) continue;
    if (previous != null && straddlesPause(pauses, previous, timestamp, fallbackEnd)) {
      if (current.length) spans.push(current);
      current = [];
    }
    current.push(item);
    previous = timestamp;
  }
  if (current.length) spans.push(current);
  return spans;
}
