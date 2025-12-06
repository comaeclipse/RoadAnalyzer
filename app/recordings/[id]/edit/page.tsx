'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import dynamic from 'next/dynamic';
import { MapPin, Undo2, ClipboardCheck, Loader2, Save } from 'lucide-react';

const RouteEditorMap = dynamic(
  () => import('@/components/recordings/RouteEditorMap').then((m) => ({ default: m.RouteEditorMap })),
  { ssr: false }
);

interface Drive {
  id: string;
  name: string | null;
  status: 'RECORDING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
}

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

export default function RouteEditPage() {
  const params = useParams();
  const router = useRouter();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const [editedPoints, setEditedPoints] = useState<GpsPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/recordings/${params.id}/route`);
        if (!res.ok) throw new Error('Failed to load route');
        const data = await res.json();
        setDrive(data.drive);
        setGpsPoints(data.gpsPoints);
        setEditedPoints(data.gpsPoints);
      } catch (err) {
        console.error(err);
        setError('Failed to load recording route');
      } finally {
        setLoading(false);
      }
    }
    if (params.id) load();
  }, [params.id]);

  const pointCount = editedPoints.length;

  const geoJson = useMemo(() => {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: editedPoints.map((p) => [p.lng, p.lat]),
      },
      properties: {
        driveId: drive?.id,
        name: drive?.name,
      },
    };
  }, [editedPoints, drive]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(geoJson, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
      setError('Failed to copy to clipboard');
    }
  };

  const handleReset = () => {
    setEditedPoints(gpsPoints);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const resp = await fetch(`/api/recordings/${params.id}/route`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: editedPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        }),
      });
      if (!resp.ok) {
        const msg = await resp.json().catch(() => ({}));
        throw new Error(msg.error || 'Failed to save route');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to save route');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageLayout maxWidth="4xl">
        <div className="flex items-center justify-center py-16 text-gray-600">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading route...
        </div>
      </PageLayout>
    );
  }

  if (error || !drive) {
    return (
      <PageLayout maxWidth="4xl">
        <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-700">
          {error || 'Recording not found'}
        </Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="4xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Edit Route</h1>
            <p className="text-sm text-gray-500">{drive.name || 'Untitled drive'}</p>
          </div>
          <Badge variant="outline" className="border-gray-300 text-gray-700">
            {pointCount} points
          </Badge>
        </div>

        <Alert className="border-gray-200 bg-gray-50 text-gray-700">
          Drag the markers to adjust the route. Changes are local only; copy the GeoJSON to save/export.
        </Alert>

        <Card className="border-gray-200">
          <CardHeader className="pb-2 flex items-center justify-between">
            <CardTitle className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-600" />
              Route geometry
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                <Undo2 className="w-4 h-4 mr-1" />
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="bg-gray-900 hover:bg-gray-800 text-white">
                <Save className="w-4 h-4 mr-1" />
                {saving ? 'Saving...' : 'Save to DB'}
              </Button>
              <Button size="sm" onClick={handleCopy} className="bg-gray-900 hover:bg-gray-800 text-white">
                <ClipboardCheck className="w-4 h-4 mr-1" />
                {copied ? 'Copied' : 'Copy GeoJSON'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <RouteEditorMap
              points={editedPoints.map((p) => ({ lat: p.lat, lng: p.lng }))}
              onChange={(pts) =>
                setEditedPoints(
                  pts.map((p, idx) => ({
                    ...p,
                    timestamp: editedPoints[idx]?.timestamp ?? Date.now(),
                    speed: editedPoints[idx]?.speed ?? null,
                  }))
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}

