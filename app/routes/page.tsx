'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapboxLineMap, type MapLine, type MapMarker } from '@/components/maps/MapboxLineMap';
import { PageLayout } from '@/components/layout/PageLayout';
import { Clock, Gauge, MapPin, Repeat, TrafficCone } from 'lucide-react';

interface RouteRun {
  id: string;
  name: string | null;
  startTime: string;
  duration: number | null;
  distance: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  source: 'WEB' | 'IOS';
  congestionEvents: number;
  trafficTags: number;
  isReference: boolean;
}

interface RouteStats {
  runCount: number;
  fastestDuration: number | null;
  slowestDuration: number | null;
  medianDuration: number | null;
  avgDuration: number | null;
  durationSpread: number | null;
  avgSpeed: number | null;
  avgCongestionEvents: number | null;
  lastRunAt: string | null;
  fastestRunId: string | null;
}

interface RouteTemplate {
  id: string;
  name: string;
  distance: number;
  direction: string | null;
  isActive: boolean;
  createdAt: string;
  referenceDriveId: string;
  geometry: GeoJSON.LineString | null;
  stats: RouteStats;
  runs: RouteRun[];
}

const ROUTE_COLORS = ['#2563eb', '#9333ea', '#0d9488', '#ea580c', '#dc2626', '#65a30d'];

function formatMiles(meters: number | null): string {
  if (meters === null) return '-';
  return `${(meters / 1609.344).toFixed(2)} mi`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatMph(mps: number | null): string {
  if (mps === null) return '-';
  return `${(mps * 2.23694).toFixed(1)} mph`;
}

function formatDirection(direction: string | null): string {
  if (!direction) return 'Unknown';
  return direction.charAt(0) + direction.slice(1).toLowerCase();
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRoutes = useCallback(async () => {
    try {
      const response = await fetch('/api/routes');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = (await response.json()) as { routes: RouteTemplate[] };
      setRoutes(data.routes);
      setSelectedId((current) => {
        if (current && data.routes.some((route) => route.id === current)) return current;
        return data.routes[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load routes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  const selected = useMemo(
    () => routes.find((route) => route.id === selectedId) ?? null,
    [routes, selectedId]
  );

  const colorFor = useCallback(
    (routeId: string) => {
      const index = routes.findIndex((route) => route.id === routeId);
      return ROUTE_COLORS[index < 0 ? 0 : index % ROUTE_COLORS.length];
    },
    [routes]
  );

  // Draw every route faintly for context, with the selected one highlighted on top.
  const lines = useMemo<MapLine[]>(() => {
    return routes
      .filter((route) => (route.geometry?.coordinates?.length ?? 0) >= 2)
      .map((route) => {
        const isSelected = route.id === selectedId;
        return {
          id: route.id,
          coordinates: route.geometry!.coordinates,
          color: colorFor(route.id),
          width: isSelected ? 5 : 2,
          opacity: isSelected ? 0.95 : 0.25,
          label: route.name,
        };
      })
      // Selected last so it paints above the others.
      .sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));
  }, [routes, selectedId, colorFor]);

  const markers = useMemo<MapMarker[]>(() => {
    const coordinates = selected?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return [];
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    return [
      { id: `${selected!.id}-start`, lng: start[0], lat: start[1], color: '#16a34a', label: 'Start', size: 14 },
      { id: `${selected!.id}-end`, lng: end[0], lat: end[1], color: '#dc2626', label: 'End', size: 14 },
    ];
  }, [selected]);

  const handleRename = async (route: RouteTemplate) => {
    const name = window.prompt('Rename this route', route.name);
    if (!name?.trim() || name.trim() === route.name) return;
    setBusyId(route.id);
    try {
      const response = await fetch(`/api/routes/${route.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!response.ok) throw new Error('Failed to rename');
      await loadRoutes();
    } catch (err) {
      console.error(err);
      alert('Could not rename this route.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (route: RouteTemplate) => {
    setBusyId(route.id);
    try {
      const response = await fetch(`/api/routes/${route.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !route.isActive }),
      });
      if (!response.ok) throw new Error('Failed to update');
      await loadRoutes();
    } catch (err) {
      console.error(err);
      alert('Could not update this route.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (route: RouteTemplate) => {
    const confirmed = window.confirm(
      `Delete "${route.name}"?\n\n` +
        `${route.stats.runCount} recording(s) will stay, but will no longer be grouped under this route. ` +
        `This cannot be undone.`
    );
    if (!confirmed) return;
    setBusyId(route.id);
    try {
      const response = await fetch(`/api/routes/${route.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete');
      await loadRoutes();
    } catch (err) {
      console.error(err);
      alert('Could not delete this route.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageLayout maxWidth="7xl">
      <div>
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">Routes</h1>
          {!loading && !error && routes.length > 0 && (
            <p className="text-sm text-gray-500">
              {routes.length} saved {routes.length === 1 ? 'route' : 'routes'} ·{' '}
              {routes.reduce((sum, route) => sum + route.stats.runCount, 0)} total runs
            </p>
          )}
        </div>

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

        {!loading && !error && routes.length === 0 && (
          <Card className="border-gray-200">
            <CardContent className="py-12 text-center text-gray-500">
              <p>No saved routes yet.</p>
              <p className="mt-2 text-sm">
                Open a recording with a completed map match and choose{' '}
                <span className="font-medium text-gray-700">Save as reusable route</span> to
                start comparing runs of the same trip.
              </p>
              <Link href="/recordings" className="mt-4 inline-block">
                <Button variant="outline" size="sm">Browse recordings</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {!loading && !error && routes.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {/* Route list */}
            <div className="flex flex-col gap-3">
              {routes.map((route) => {
                const isSelected = route.id === selectedId;
                return (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => setSelectedId(route.id)}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      isSelected
                        ? 'border-gray-900 bg-gray-50 shadow-sm'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ background: colorFor(route.id) }}
                        />
                        <span className="truncate font-medium text-gray-900">{route.name}</span>
                      </div>
                      {!route.isActive && (
                        <Badge variant="outline" className="shrink-0 border-gray-200 text-gray-500">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>{formatMiles(route.distance)}</span>
                      <span>·</span>
                      <span>{formatDirection(route.direction)}</span>
                      <span>·</span>
                      <span>
                        {route.stats.runCount} {route.stats.runCount === 1 ? 'run' : 'runs'}
                      </span>
                    </div>
                    {route.stats.lastRunAt && (
                      <p className="mt-1 text-xs text-gray-400">
                        Last run {formatDistanceToNow(new Date(route.stats.lastRunAt), { addSuffix: true })}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected route detail */}
            {selected && (
              <div className="flex flex-col gap-4">
                <Card className="overflow-hidden border-gray-200">
                  <MapboxLineMap
                    lines={lines}
                    markers={markers}
                    onLineClick={setSelectedId}
                    className="h-[360px] w-full"
                  />
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-medium text-gray-900">{selected.name}</h2>
                    <p className="text-sm text-gray-500">
                      {formatMiles(selected.distance)} · heading {formatDirection(selected.direction)} ·
                      saved {formatDistanceToNow(new Date(selected.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === selected.id}
                      onClick={() => handleRename(selected)}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === selected.id}
                      onClick={() => handleToggleActive(selected)}
                    >
                      {selected.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={busyId === selected.id}
                      onClick={() => handleDelete(selected)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {!selected.isActive && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    This route is inactive, so new recordings will not be matched to it.
                    Existing runs stay attached.
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                      <Repeat className="h-3.5 w-3.5" /> Runs
                    </p>
                    <p className="text-xl font-semibold text-gray-900">{selected.stats.runCount}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                      <Clock className="h-3.5 w-3.5" /> Best
                    </p>
                    <p className="text-xl font-semibold text-gray-900">
                      {formatDuration(selected.stats.fastestDuration)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                      <Clock className="h-3.5 w-3.5" /> Median
                    </p>
                    <p className="text-xl font-semibold text-gray-900">
                      {formatDuration(selected.stats.medianDuration)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-500">
                      <Gauge className="h-3.5 w-3.5" /> Avg speed
                    </p>
                    <p className="text-xl font-semibold text-gray-900">
                      {formatMph(selected.stats.avgSpeed)}
                    </p>
                  </div>
                </div>

                {selected.stats.runCount < 2 && (
                  <p className="text-sm text-gray-500">
                    Only one run so far — record this route again to compare times.
                  </p>
                )}

                {selected.stats.runCount >= 2 && selected.stats.durationSpread !== null && (
                  <p className="text-sm text-gray-600">
                    Best to worst spread:{' '}
                    <span className="font-medium text-gray-900">
                      {formatDuration(selected.stats.durationSpread)}
                    </span>{' '}
                    across {selected.stats.runCount} runs
                    {selected.stats.avgCongestionEvents !== null && (
                      <>
                        {' '}· {selected.stats.avgCongestionEvents.toFixed(1)} congestion events per run
                        on average
                      </>
                    )}
                    .
                  </p>
                )}

                {/* Run history */}
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Run</th>
                        <th className="px-4 py-2 font-medium">Time</th>
                        <th className="px-4 py-2 font-medium">Distance</th>
                        <th className="px-4 py-2 font-medium">Avg speed</th>
                        <th className="px-4 py-2 font-medium">
                          <span className="flex items-center gap-1.5">
                            <TrafficCone className="h-3.5 w-3.5" /> Stops
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.runs.map((run) => (
                        <tr key={run.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/recordings/${run.id}`}
                              className="font-medium text-gray-900 hover:underline"
                            >
                              {new Date(run.startTime).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </Link>
                            <span className="ml-2 inline-flex gap-1 align-middle">
                              {run.id === selected.stats.fastestRunId &&
                                selected.stats.runCount > 1 && (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-200 bg-emerald-50 text-emerald-700"
                                  >
                                    Fastest
                                  </Badge>
                                )}
                              {run.isReference && (
                                <Badge
                                  variant="outline"
                                  className="border-violet-200 bg-violet-50 text-violet-700"
                                >
                                  Reference
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">{formatDuration(run.duration)}</td>
                          <td className="px-4 py-2.5 text-gray-600">{formatMiles(run.distance)}</td>
                          <td className="px-4 py-2.5 text-gray-600">{formatMph(run.avgSpeed)}</td>
                          <td className="px-4 py-2.5 text-gray-600">{run.congestionEvents}</td>
                        </tr>
                      ))}
                      {selected.runs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                            <span className="flex items-center justify-center gap-2">
                              <MapPin className="h-4 w-4 text-gray-400" />
                              No runs recorded against this route yet.
                            </span>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
