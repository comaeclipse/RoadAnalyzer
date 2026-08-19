'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapboxLineMap, type MapLine, type MapMarker } from '@/components/maps/MapboxLineMap';
import { PageLayout } from '@/components/layout/PageLayout';
import { TrafficCone, Clock, Repeat, Hourglass, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

interface StopEvent {
  driveId: string;
  driveName: string | null;
  driveStartTime: string;
  lat: number;
  lng: number;
  timestamp: number;
  duration: number;
  bearing: number;
  roadName: string | null;
}

interface Approach {
  id: string;
  lat: number;
  lng: number;
  bearing: number;
  direction: string;
  roadName: string | null;
  kind: string;
  passes: number;
  passesClamped: boolean;
  stopCount: number;
  probability: number;
  confidenceLow: number;
  confidenceHigh: number;
  medianDelay: number;
  maxDelay: number;
  totalDelay: number;
  expectedDelay: number;
  stops: StopEvent[];
  /**
   * The control OpenStreetMap places ahead of this approach, when there is one.
   * Kept separate from `kind`, which is the driver's own label: a human
   * confirming what happened at the moment it happened is stronger evidence
   * than a map, and merging the two would cost us the better one.
   */
  osm: { nodeId: number; kind: string | null; distance: number } | null;
}

interface Summary {
  driveCount: number;
  approachCount: number;
  stopCount: number;
  totalDelay: number;
  clampedCount: number;
  osmControls: {
    onDrivenRoad: number;
    associated: number;
    neverStopped: number;
    lastFetchedAt: string | null;
  };
  thresholds: {
    stoppedSpeedMph: number;
    minStopSeconds: number;
    clusterRadiusMeters: number;
    bearingToleranceDegrees: number;
  };
}

function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    RED_LIGHT: 'Red light',
    STOP_SIGN: 'Stop sign',
    INTERSECTION: 'Intersection',
    TRAFFIC: 'Traffic',
    PARKING: 'Parking',
    OTHER: 'Other',
    UNCLASSIFIED: 'Untagged',
  };
  return labels[kind] ?? kind;
}

type SortKey = 'road' | 'stopped' | 'chance' | 'median' | 'expected' | 'total';
type SortDir = 'asc' | 'desc';

const SORT_COLUMNS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'road', label: 'Approach', defaultDir: 'asc' },
  { key: 'stopped', label: 'Stopped', defaultDir: 'desc' },
  { key: 'chance', label: 'Chance', defaultDir: 'desc' },
  { key: 'median', label: 'Median', defaultDir: 'desc' },
  { key: 'expected', label: 'Cost / trip', defaultDir: 'desc' },
  { key: 'total', label: 'Total', defaultDir: 'desc' },
];

function sortValue(approach: Approach, key: SortKey): number | string {
  switch (key) {
    case 'road':
      return (approach.roadName ?? 'Unnamed road').toLowerCase();
    case 'stopped':
      return approach.stopCount;
    case 'chance':
      return approach.probability;
    case 'median':
      return approach.medianDelay;
    case 'expected':
      return approach.expectedDelay;
    case 'total':
      return approach.totalDelay;
  }
}

function probabilityColor(probability: number): string {
  if (probability >= 0.75) return '#dc2626';
  if (probability >= 0.5) return '#f97316';
  if (probability >= 0.25) return '#eab308';
  return '#22c55e';
}

/** Point roughly `meters` back along the approach bearing, for drawing the arrow. */
function upstreamOf(approach: Approach, meters: number): [number, number] {
  const reverse = ((approach.bearing + 180) % 360) * (Math.PI / 180);
  const dLat = (meters * Math.cos(reverse)) / 111_320;
  const dLng =
    (meters * Math.sin(reverse)) / (111_320 * Math.cos(approach.lat * (Math.PI / 180)));
  return [approach.lng + dLng, approach.lat + dLat];
}

export default function IntersectionsPage() {
  const [approaches, setApproaches] = useState<Approach[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minPasses, setMinPasses] = useState(3);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/intersections?minPasses=${minPasses}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = (await response.json()) as { approaches: Approach[]; summary: Summary };
      setApproaches(data.approaches);
      setSummary(data.summary);
      setSelectedId((current) =>
        current && data.approaches.some((a) => a.id === current)
          ? current
          : data.approaches[0]?.id ?? null
      );
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load intersection analysis');
    } finally {
      setLoading(false);
    }
  }, [minPasses]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => approaches.find((a) => a.id === selectedId) ?? null,
    [approaches, selectedId]
  );

  const sortedApproaches = useMemo(() => {
    if (!sort) return approaches;
    const { key, dir } = sort;
    const factor = dir === 'asc' ? 1 : -1;
    return [...approaches].sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [approaches, sort]);

  const handleSort = useCallback((key: SortKey) => {
    setSort((current) => {
      if (current?.key === key) {
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      }
      const column = SORT_COLUMNS.find((c) => c.key === key);
      return { key, dir: column?.defaultDir ?? 'asc' };
    });
  }, []);

  const markers = useMemo<MapMarker[]>(
    () =>
      approaches.map((approach) => ({
        id: approach.id,
        lat: approach.lat,
        lng: approach.lng,
        color: probabilityColor(approach.probability),
        size: Math.min(34, 14 + approach.stopCount * 5),
        selected: approach.id === selectedId,
        label: `${approach.roadName ?? 'Unnamed road'} ${approach.direction} — stopped ${approach.stopCount} of ${approach.passes}`,
      })),
    [approaches, selectedId]
  );

  // Short arrow showing which way you are travelling on this approach.
  const lines = useMemo<MapLine[]>(() => {
    if (!selected) return [];
    return [{
      id: `approach-vector-${selected.id}`,
      coordinates: [upstreamOf(selected, 120), [selected.lng, selected.lat]],
      color: probabilityColor(selected.probability),
      width: 5,
      opacity: 0.85,
      label: `Approaching ${selected.direction}`,
    }];
  }, [selected]);

  const thin = approaches.filter((a) => a.passes < 3).length;

  return (
    <PageLayout maxWidth="7xl">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">Intersections</h1>
          <label className="text-sm text-gray-600">
            Minimum traversals
            <select
              value={minPasses}
              onChange={(event) => setMinPasses(Number(event.target.value))}
              className="ml-2 rounded-md border border-gray-300 px-2 py-1"
            >
              <option value={1}>Show all</option>
              <option value={2}>Seen 2+ times</option>
              <option value={3}>Seen 3+ times</option>
              <option value={5}>Seen 5+ times</option>
            </select>
          </label>
        </div>
        <p className="mb-6 text-sm text-gray-500">
          Places you stop, grouped by approach direction. The two sides of one intersection face
          different signals, so they are counted separately. Ranked by cost per trip — how much
          time an approach takes out of an average traversal, which is its chance of stopping you
          multiplied by how long it holds you when it does.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-400" />
          </div>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 text-center text-red-600">{error}</CardContent>
          </Card>
        )}

        {!loading && !error && approaches.length === 0 && (
          <Card className="border-gray-200">
            <CardContent className="py-12 text-center text-gray-500">
              <p>No repeated stops found yet.</p>
              <p className="mt-2 text-sm">
                Record the same route a few times and the intersections that actually cost you
                time will show up here.
              </p>
              <Link href="/recordings" className="mt-4 inline-block text-gray-700 underline">
                Browse recordings
              </Link>
            </CardContent>
          </Card>
        )}

        {!loading && !error && approaches.length > 0 && summary && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                  <TrafficCone className="h-3.5 w-3.5" /> Approaches
                </p>
                <p className="text-xl font-semibold text-gray-900">{summary.approachCount}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                  <Repeat className="h-3.5 w-3.5" /> Stops
                </p>
                <p className="text-xl font-semibold text-gray-900">{summary.stopCount}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                  <Hourglass className="h-3.5 w-3.5" /> Time stopped
                </p>
                <p className="text-xl font-semibold text-gray-900">{formatSeconds(summary.totalDelay)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                  <Clock className="h-3.5 w-3.5" /> Drives
                </p>
                <p className="text-xl font-semibold text-gray-900">{summary.driveCount}</p>
              </div>
            </div>

            {thin > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span className="font-medium">{thin}</span> of these approaches have been
                travelled fewer than 3 times. A percentage from one or two traversals is barely
                evidence — the range after each figure is a 95% confidence interval, and it stays
                wide until you have repeated a route many times.
              </div>
            )}

            {summary.osmControls.neverStopped > 0 && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <span className="font-medium">{summary.osmControls.neverStopped}</span> of the{' '}
                {summary.osmControls.onDrivenRoad} traffic controls OpenStreetMap places on roads
                you drive never appear above, because this table is built from places you stopped.
                Those are the ones you get through — the signals costing you least are the ones
                there is least to say about.
              </div>
            )}

            {summary.clampedCount > 0 && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <span className="font-medium">{summary.clampedCount}</span> of these approaches
                recorded more stops than measured traversals, so their traversal count was raised
                to match. Those percentages are floors rather than measurements.
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      {SORT_COLUMNS.map((column) => {
                        const isActive = sort?.key === column.key;
                        const Icon = isActive
                          ? sort?.dir === 'asc'
                            ? ArrowUp
                            : ArrowDown
                          : ArrowUpDown;
                        return (
                          <th key={column.key} className="px-3 py-2 font-medium">
                            <button
                              type="button"
                              onClick={() => handleSort(column.key)}
                              className={`flex items-center gap-1 hover:text-gray-700 ${
                                isActive ? 'text-gray-900' : ''
                              }`}
                            >
                              {column.label}
                              <Icon className={`h-3 w-3 ${isActive ? '' : 'opacity-40'}`} />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedApproaches.map((approach) => {
                      const isSelected = approach.id === selectedId;
                      return (
                        <tr
                          key={approach.id}
                          onClick={() => setSelectedId(approach.id)}
                          className={`cursor-pointer ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ background: probabilityColor(approach.probability) }}
                              />
                              <span className="font-medium text-gray-900">
                                {approach.roadName ?? 'Unnamed road'}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 pl-[18px] text-xs text-gray-500">
                              <span>{approach.direction}</span>
                              {approach.kind !== 'UNCLASSIFIED' ? (
                                <Badge
                                  variant="outline"
                                  className="border-gray-200 text-gray-600"
                                  title="You tagged this from the phone."
                                >
                                  {kindLabel(approach.kind)}
                                </Badge>
                              ) : approach.osm?.kind ? (
                                // Deliberately not the same badge. A dashed
                                // outline and the source in the label so that
                                // "you told me this is a stop sign" never reads
                                // the same as "OSM says there is one here".
                                <Badge
                                  variant="outline"
                                  className="border-dashed border-gray-300 font-normal text-gray-400"
                                  title={`OpenStreetMap has a control ${Math.round(approach.osm.distance)} m ahead of this approach. You have not tagged it.`}
                                >
                                  {kindLabel(approach.osm.kind)} · OSM
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                            {approach.stopCount} of {approach.passes}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="font-medium text-gray-900">
                              {Math.round(approach.probability * 100)}%
                            </span>
                            <span className="ml-1 text-xs text-gray-400">
                              {Math.round(approach.confidenceLow * 100)}–
                              {Math.round(approach.confidenceHigh * 100)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                            {formatSeconds(approach.medianDelay)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-medium text-gray-900">
                            {formatSeconds(approach.expectedDelay)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                            {formatSeconds(approach.totalDelay)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4">
                <Card className="overflow-hidden border-gray-200">
                  <MapboxLineMap
                    lines={lines}
                    markers={markers}
                    onMarkerClick={setSelectedId}
                    selectedMarkerId={selectedId}
                    className="h-[320px] w-full"
                  />
                </Card>

                {selected && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h2 className="font-medium text-gray-900">
                      {selected.roadName ?? 'Unnamed road'}
                    </h2>
                    <p className="text-sm text-gray-500">
                      Travelling {selected.direction} · {kindLabel(selected.kind)}
                    </p>

                    <p className="mt-3 text-sm text-gray-700">
                      Stopped <span className="font-medium">{selected.stopCount}</span> of{' '}
                      <span className="font-medium">{selected.passes}</span> times through here —
                      about <span className="font-medium">{Math.round(selected.probability * 100)}%</span>,
                      though with this little data the true rate is somewhere between{' '}
                      {Math.round(selected.confidenceLow * 100)}% and{' '}
                      {Math.round(selected.confidenceHigh * 100)}%.
                    </p>
                    <p className="mt-2 text-sm text-gray-700">
                      When stopped, typically {formatSeconds(selected.medianDelay)} (worst{' '}
                      {formatSeconds(selected.maxDelay)}). {formatSeconds(selected.totalDelay)} lost
                      here in total.
                    </p>

                    <p className="mt-4 mb-1 text-xs uppercase tracking-wide text-gray-500">
                      Every stop here
                    </p>
                    <ul className="space-y-1 text-sm">
                      {selected.stops.map((stop) => (
                        <li key={`${stop.driveId}-${stop.timestamp}`} className="flex justify-between gap-3">
                          <Link
                            href={`/recordings/${stop.driveId}`}
                            className="truncate text-gray-700 hover:underline"
                          >
                            {stop.driveName ?? 'Untitled drive'}
                          </Link>
                          <span className="shrink-0 text-gray-500">
                            {formatSeconds(stop.duration)} ·{' '}
                            {formatDistanceToNow(new Date(stop.timestamp), { addSuffix: true })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs leading-relaxed text-gray-500">
                  A stop means at or below {summary.thresholds.stoppedSpeedMph.toFixed(1)} mph for at
                  least {summary.thresholds.minStopSeconds}s. Stops within{' '}
                  {summary.thresholds.clusterRadiusMeters} m of each other are treated as the same
                  place when headings agree to within {summary.thresholds.bearingToleranceDegrees}°.
                  A traversal counts whenever a drive passed through, stopped or not — that is the
                  denominator.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
}
