'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HeatmapSegment, HeatmapResponse } from '@/types/congestion';
import { PageLayout } from '@/components/layout/PageLayout';

const CongestionHeatmap = dynamic(() => import('@/components/map/CongestionHeatmap'), {
  ssr: false,
  loading: () => <div className="h-[calc(100vh-16rem)] animate-pulse rounded-lg bg-gray-100" />,
});

const severities = ['FREE_FLOW', 'SLOW', 'CONGESTED', 'HEAVY', 'GRIDLOCK'] as const;

export default function MapPage() {
  const [segments, setSegments] = useState<HeatmapSegment[]>([]);
  const [summary, setSummary] = useState<HeatmapResponse['summary']>();
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [severity, setSeverity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (severity) query.set('severity', severity);
    if (from) query.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) query.set('to', new Date(`${to}T23:59:59`).toISOString());
    setLoading(true);
    fetch(`/api/congestion/heatmap?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load congestion data');
        return response.json() as Promise<HeatmapResponse>;
      })
      .then((data) => {
        setSegments(data.heatmap);
        setSummary(data.summary);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError('Unable to load the public congestion report.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [severity, from, to]);

  const freshness = useMemo(() => {
    if (!summary?.updatedAt) return 'No reports received yet';
    return `Updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(summary.updatedAt))}`;
  }, [summary?.updatedAt]);

  return (
    <PageLayout>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Public traffic report</p>
          <h1 className="text-2xl font-semibold text-gray-900">Congestion map</h1>
          <p className="mt-1 text-sm text-gray-500">Anonymous iPhone traffic reports, aggregated by road segment and route.</p>
        </div>
        <p className="text-sm text-gray-500">{freshness}</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-sm text-gray-600">From<input value={from} onChange={(event) => setFrom(event.target.value)} type="date" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm text-gray-600">To<input value={to} onChange={(event) => setTo(event.target.value)} type="date" className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2" /></label>
        <label className="text-sm text-gray-600">Minimum event severity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"><option value="">All reports</option>{severities.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></label>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Reports" value={summary?.driveCount ?? 0} />
        <Metric label="Congestion events" value={summary?.eventCount ?? 0} />
        <Metric label="Average speed" value={summary?.avgSpeed == null ? '—' : `${(summary.avgSpeed * 2.23694).toFixed(1)} mph`} />
      </div>

      {error ? <Card className="border-red-200 bg-red-50"><CardContent className="py-8 text-center text-red-700">{error}</CardContent></Card> : loading ? <div className="h-[calc(100vh-16rem)] animate-pulse rounded-lg bg-gray-100" /> : segments.length === 0 ? <Card><CardContent className="py-16 text-center text-gray-500">No traffic reports match these filters. Record a drive in the iPhone app, then upload it to populate this map.</CardContent></Card> : <div className="grid grid-cols-1 gap-6 lg:grid-cols-4"><div className="lg:col-span-3 overflow-hidden rounded-lg border border-gray-200"><CongestionHeatmap segments={segments} selectedSegmentId={selectedSegmentId} onSegmentSelect={setSelectedSegmentId} /></div><Legend /></div>}
    </PageLayout>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="py-4"><p className="text-xs uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p></CardContent></Card>;
}

function Legend() {
  return <Card><CardContent className="space-y-3 p-4"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Traffic score</p>{[['80–100', 'bg-green-500'], ['60–79', 'bg-lime-500'], ['40–59', 'bg-yellow-500'], ['20–39', 'bg-orange-500'], ['0–19', 'bg-red-500']].map(([label, color]) => <div key={label} className="flex items-center gap-2 text-sm text-gray-600"><span className={`h-2 w-5 rounded ${color}`} /><span>{label}</span></div>)}<Badge variant="outline" className="mt-3">Anonymous aggregate</Badge></CardContent></Card>;
}
