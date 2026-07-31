'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';

const MatchMap = dynamic(
  () => import('@/components/matching/MatchMap').then((module) => module.MatchMap),
  { ssr: false }
);

interface RouteDiagnostic {
  id: string;
  name: string | null;
  points: { lat: number; lng: number }[];
  tripAnalysis: {
    status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
    matchedGeometry: GeoJSON.LineString | null;
    coverage: number;
    confidence: number | null;
    errorCode: string | null;
  } | null;
  matchDiagnostics: {
    matchedPoints: number;
    unmatchedPoints: number;
    manualOverrides: number;
    lowConfidencePoints: number;
  };
}

export default function MatchingPage() {
  const [routes, setRoutes] = useState<RouteDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/recordings/all-routes')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load match diagnostics');
        const data = await response.json();
        setRoutes(data.routes);
      })
      .catch((reason) => {
        console.error(reason);
        setError('Failed to load match diagnostics.');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Match quality</h1>
            <p className="text-sm text-gray-500">Mapbox coverage, ambiguity, and manual overrides for completed drives.</p>
          </div>
          <Badge variant="outline">{routes.length} recordings</Badge>
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}
        {loading && <Card><CardContent className="py-10 text-center text-gray-500">Loading diagnostics…</CardContent></Card>}
        {!loading && !error && routes.length === 0 && (
          <Card><CardContent className="py-10 text-center text-gray-500">No completed recordings are available.</CardContent></Card>
        )}

        {routes.map((route) => {
          const analysis = route.tripAnalysis;
          return (
            <Card key={route.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg"><Link href={`/recordings/${route.id}`} className="hover:underline">{route.name || 'Untitled drive'}</Link></CardTitle>
                    <p className="mt-1 text-xs text-gray-500">{route.id}</p>
                  </div>
                  <Badge variant="outline" className={
                    analysis?.status === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                    analysis?.status === 'PARTIAL' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                    analysis?.status === 'FAILED' ? 'border-red-200 bg-red-50 text-red-700' :
                    'border-gray-200 text-gray-600'
                  }>
                    {analysis?.status ?? 'LEGACY'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <MatchMap points={route.points} matchedGeometry={analysis?.matchedGeometry} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Coverage" value={analysis ? `${Math.round(analysis.coverage * 100)}%` : '—'} />
                  <Metric label="Confidence" value={analysis?.confidence == null ? '—' : `${Math.round(analysis.confidence * 100)}%`} />
                  <Metric label="Unmatched points" value={route.matchDiagnostics.unmatchedPoints} />
                  <Metric label="Low confidence" value={route.matchDiagnostics.lowConfidencePoints} />
                  <Metric label="Manual overrides" value={route.matchDiagnostics.manualOverrides} />
                  <Metric label="Error" value={analysis?.errorCode ?? 'None'} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border bg-gray-50 p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 font-medium text-gray-900">{value}</p></div>;
}
