'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Gauge, Clock, Activity } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface Drive {
  id: string;
  name: string | null;
  status: 'RECORDING' | 'COMPLETED' | 'FAILED';
  startTime: string;
  endTime: string | null;
  duration: number | null;
  distance: number | null;
  maxSpeed: number | null;
  avgSpeed: number | null;
  sampleCount: number;
  createdAt: string;
}

export default function RecordingsPage() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDrives() {
      try {
        const res = await fetch('/api/recordings');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setDrives(data.drives);
      } catch (err) {
        setError('Failed to load recordings');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchDrives();
  }, []);

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number | null) => {
    if (!meters) return '-';
    if (meters < 1000) return `${meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatSpeed = (mps: number | null) => {
    if (!mps) return '-';
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'RECORDING':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'FAILED':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      default:
        return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-zinc-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Recordings</h1>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
          </div>
        )}

        {error && (
          <Card className="bg-red-500/10 border-red-500/30">
            <CardContent className="py-4 text-center text-red-400">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && drives.length === 0 && (
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="py-12 text-center text-zinc-500">
              No recordings yet. Start a recording from the dashboard!
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {drives.map((drive) => (
            <Card key={drive.id} className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-medium text-zinc-100">
                      {drive.name || 'Untitled Drive'}
                    </CardTitle>
                    <p className="text-sm text-zinc-500 mt-1">
                      {formatDistanceToNow(new Date(drive.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Badge className={getStatusColor(drive.status)}>
                    {drive.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Clock className="h-4 w-4" />
                    <span>{formatDuration(drive.duration)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <MapPin className="h-4 w-4" />
                    <span>{formatDistance(drive.distance)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Gauge className="h-4 w-4" />
                    <span>{formatSpeed(drive.maxSpeed)} max</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Activity className="h-4 w-4" />
                    <span>{drive.sampleCount} samples</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

