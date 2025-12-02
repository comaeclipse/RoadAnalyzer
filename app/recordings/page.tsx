'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Gauge, Clock, Activity } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface RoughnessBreakdown {
  smooth: number;
  light: number;
  moderate: number;
  rough: number;
  veryRough: number;
}

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
  roughnessScore: number | null;
  roughnessBreakdown: RoughnessBreakdown | null;
}

function getRoughnessLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Very Poor';
}

function getRoughnessColor(score: number): string {
  if (score >= 90) return 'text-green-600';
  if (score >= 75) return 'text-lime-600';
  if (score >= 50) return 'text-yellow-600';
  if (score >= 25) return 'text-orange-600';
  return 'text-red-600';
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

  // Calculate summary stats
  const stats = useMemo(() => {
    const completed = drives.filter((d) => d.status === 'COMPLETED');
    const totalDistance = completed.reduce((sum, d) => sum + (d.distance || 0), 0);
    const totalSamples = completed.reduce((sum, d) => sum + d.sampleCount, 0);
    const totalDuration = completed.reduce((sum, d) => sum + (d.duration || 0), 0);
    
    // Calculate average roughness score
    const drivesWithRoughness = completed.filter((d) => d.roughnessScore !== null);
    const avgRoughness = drivesWithRoughness.length > 0
      ? drivesWithRoughness.reduce((sum, d) => sum + (d.roughnessScore || 0), 0) / drivesWithRoughness.length
      : null;
    
    return {
      totalRecordings: completed.length,
      totalDistance,
      totalSamples,
      totalDuration,
      avgRoughness,
    };
  }, [drives]);

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

  const formatDistanceMiles = (meters: number) => {
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)} mi`;
  };

  const formatSpeed = (mps: number | null) => {
    if (!mps) return '-';
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  };

  const formatTotalDuration = (ms: number) => {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours}h ${mins}m`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Completed</Badge>;
      case 'RECORDING':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Recording</Badge>;
      case 'FAILED':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-900 hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Recordings</h1>
        </div>

        {/* Summary Stats */}
        {!loading && !error && drives.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Recordings</p>
              <p className="text-xl font-semibold text-gray-900">{stats.totalRecordings}</p>
            </div>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Distance</p>
              <p className="text-xl font-semibold text-gray-900">{formatDistanceMiles(stats.totalDistance)}</p>
            </div>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Time</p>
              <p className="text-xl font-semibold text-gray-900">{formatTotalDuration(stats.totalDuration)}</p>
            </div>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Samples</p>
              <p className="text-xl font-semibold text-gray-900">{stats.totalSamples.toLocaleString()}</p>
            </div>
            <div className="px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Quality</p>
              {stats.avgRoughness !== null ? (
                <p className={`text-xl font-semibold ${getRoughnessColor(stats.avgRoughness)}`}>
                  {Math.round(stats.avgRoughness)}
                </p>
              ) : (
                <p className="text-xl font-semibold text-gray-400">-</p>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
          </div>
        )}

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 text-center text-red-600">
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && drives.length === 0 && (
          <Card className="border-gray-200">
            <CardContent className="py-12 text-center text-gray-500">
              No recordings yet. Start a recording from the dashboard!
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-4">
          {drives.map((drive) => (
            <Link key={drive.id} href={`/recordings/${drive.id}`} className="block">
              <Card className="border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg font-medium text-gray-900">
                        {drive.name || 'Untitled Drive'}
                      </CardTitle>
                      <p className="text-sm text-gray-500 mt-1">
                        {formatDistanceToNow(new Date(drive.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {drive.roughnessScore !== null && (
                        <Badge variant="outline" className={`${getRoughnessColor(drive.roughnessScore)} border-gray-200`}>
                          {Math.round(drive.roughnessScore)} — {getRoughnessLabel(drive.roughnessScore)}
                        </Badge>
                      )}
                      {getStatusBadge(drive.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span>{formatDuration(drive.duration)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      <span>{formatDistance(drive.distance)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Gauge className="h-4 w-4 text-gray-400" />
                      <span>{formatSpeed(drive.maxSpeed)} max</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Activity className="h-4 w-4 text-gray-400" />
                      <span>{drive.sampleCount} samples</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
