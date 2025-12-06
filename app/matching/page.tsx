'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import * as turf from '@turf/turf';
import dynamic from 'next/dynamic';

const MatchMap = dynamic(() => import('@/components/matching/MatchMap').then((m) => ({ default: m.MatchMap })), {
  ssr: false,
});

interface Segment {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  eventCount?: number;
}

interface Route {
  id: string;
  name: string | null;
  points: { lat: number; lng: number }[];
}

const MATCH_THRESHOLD_METERS = 50; // match radius

export default function MatchingPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [segRes, routeRes] = await Promise.all([
          fetch('/api/segments'),
          fetch('/api/recordings/all-routes'),
        ]);
        if (!segRes.ok) throw new Error('Failed to load segments');
        if (!routeRes.ok) throw new Error('Failed to load routes');
        const segData = await segRes.json();
        const routeData = await routeRes.json();
        setSegments(segData.segments);
        setRoutes(routeData.routes);
      } catch (err) {
        console.error(err);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const matches = useMemo(() => {
    if (!segments.length || !routes.length) return [];

    return segments.map((segment) => {
      const line = turf.lineString(segment.geometry.coordinates as [number, number][]);

      const matchingRoutes: { id: string; name: string | null }[] = [];

      for (const route of routes) {
        if (!route.points?.length) continue;
        const hasMatch = route.points.some((p) => {
          const pt = turf.point([p.lng, p.lat]);
          const d = turf.pointToLineDistance(pt, line, { units: 'meters' });
          return d <= MATCH_THRESHOLD_METERS;
        });
        if (hasMatch) {
          matchingRoutes.push({ id: route.id, name: route.name });
        }
      }

      return {
        segment,
        matches: matchingRoutes,
      };
    });
  }, [segments, routes]);

  const anyMatches = matches.some((m) => m.matches.length > 0);

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Matching Tester</h1>
            <p className="text-sm text-gray-500">
              Check which recordings pass within {MATCH_THRESHOLD_METERS}m of your segments.
            </p>
          </div>
          <Badge variant="outline" className="border-gray-300 text-gray-700">
            {segments.length} segments • {routes.length} recordings
          </Badge>
        </div>

        {error && (
          <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-700">
            {error}
          </Alert>
        )}

        {loading && (
          <Card className="border-gray-200">
            <CardContent className="py-8 text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-3"></div>
              Loading segments and recordings...
            </CardContent>
          </Card>
        )}

        {!loading && !error && (
          <div className="space-y-4">
            {matches.map(({ segment, matches }) => (
              <Card key={segment.id} className="border-gray-200">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg font-medium text-gray-900">
                        {segment.name || 'Untitled segment'}
                      </CardTitle>
                      <p className="text-xs text-gray-500 break-all">{segment.id}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs ${matches.length ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-gray-200 text-gray-600 bg-gray-50'}`}
                    >
                      {matches.length ? `${matches.length} recording(s)` : 'No matches'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Showing recordings within {MATCH_THRESHOLD_METERS}m of this segment.
                  </p>
                </CardHeader>
                <CardContent className="pt-2">
                  {matches.length === 0 ? (
                    <p className="text-sm text-gray-500">No recordings within {MATCH_THRESHOLD_METERS}m.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {matches.map((m) => (
                        <div key={m.id} className="rounded-lg border border-gray-200 p-3 bg-white">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{m.name || 'Untitled drive'}</p>
                              <p className="text-xs text-gray-500 break-all">{m.id}</p>
                            </div>
                            <Badge variant="outline" className="text-xs border-gray-200 text-gray-600 bg-gray-50">
                              Match
                            </Badge>
                          </div>
                          <MatchMap
                            points={routes.find((r) => r.id === m.id)?.points || []}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {!anyMatches && matches.length > 0 && (
              <Alert className="border-gray-200 bg-gray-50 text-gray-700">
                No existing recordings fall within {MATCH_THRESHOLD_METERS}m of your segments. Try recording along
                the new segment or re-running matching on past recordings.
              </Alert>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

