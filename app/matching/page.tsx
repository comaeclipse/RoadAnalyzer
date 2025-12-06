'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import * as turf from '@turf/turf';

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
          <div className="space-y-3">
            {matches.map(({ segment, matches }) => (
              <Card key={segment.id} className="border-gray-200">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-medium text-gray-900">
                      {segment.name || 'Untitled segment'}
                    </CardTitle>
                    <p className="text-xs text-gray-500">{segment.id}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${matches.length ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-gray-200 text-gray-600 bg-gray-50'}`}
                  >
                    {matches.length ? `${matches.length} recording(s)` : 'No matches'}
                  </Badge>
                </CardHeader>
                <CardContent className="pt-2">
                  {matches.length === 0 ? (
                    <p className="text-sm text-gray-500">No recordings within {MATCH_THRESHOLD_METERS}m.</p>
                  ) : (
                    <ul className="space-y-1">
                      {matches.map((m) => (
                        <li key={m.id} className="text-sm text-gray-800">
                          <span className="font-medium">{m.name || 'Untitled drive'}</span>{' '}
                          <span className="text-xs text-gray-500">({m.id})</span>
                        </li>
                      ))}
                    </ul>
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

