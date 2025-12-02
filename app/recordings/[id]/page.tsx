'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, MapPin, Gauge, Clock, Activity, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import dynamic from 'next/dynamic';
import { SensorTimeline } from '@/components/recordings/SensorTimeline';

// Dynamically import the map to avoid SSR issues
const RouteMap = dynamic(() => import('@/components/recordings/RouteMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] bg-gray-50 rounded-lg flex items-center justify-center border border-gray-200">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
    </div>
  ),
});

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

interface GpsPoint {
  lat: number;
  lng: number;
  speed: number | null;
  timestamp: number;
}

interface AccelPoint {
  x: number;
  y: number;
  z: number;
  magnitude: number;
  timestamp: number;
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

function getRoughnessBgColor(score: number): string {
  if (score >= 90) return 'bg-green-50 border-green-200';
  if (score >= 75) return 'bg-lime-50 border-lime-200';
  if (score >= 50) return 'bg-yellow-50 border-yellow-200';
  if (score >= 25) return 'bg-orange-50 border-orange-200';
  return 'bg-red-50 border-red-200';
}

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const [accelPoints, setAccelPoints] = useState<AccelPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
      return;
    }
    
    setDeleting(true);
    try {
      const res = await fetch(`/api/recordings/${params.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      router.push('/recordings');
    } catch (err) {
      console.error('Failed to delete:', err);
      alert('Failed to delete recording');
      setDeleting(false);
    }
  };

  useEffect(() => {
    async function fetchDrive() {
      try {
        const res = await fetch(`/api/recordings/${params.id}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setDrive(data.drive);
        setGpsPoints(data.gpsPoints);
        setAccelPoints(data.accelPoints || []);
      } catch (err) {
        setError('Failed to load recording');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    if (params.id) {
      fetchDrive();
    }
  }, [params.id]);

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

  // Get the earliest timestamp for the timeline
  const startTime = Math.min(
    ...(gpsPoints.length > 0 ? [gpsPoints[0].timestamp] : [Date.now()]),
    ...(accelPoints.length > 0 ? [accelPoints[0].timestamp] : [Date.now()])
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
      </div>
    );
  }

  if (error || !drive) {
    return (
      <div className="min-h-screen bg-white p-4">
        <div className="max-w-4xl mx-auto">
          <Link href="/recordings">
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 mb-4">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-4 text-center text-red-600">
              {error || 'Recording not found'}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/recordings">
            <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-900 hover:bg-gray-100">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-gray-900">
              {drive.name || 'Untitled Drive'}
            </h1>
            <p className="text-sm text-gray-500">
              {formatDistanceToNow(new Date(drive.createdAt), { addSuffix: true })}
            </p>
          </div>
          {getStatusBadge(drive.status)}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={deleting}
            className="text-gray-400 hover:text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>

        {/* Road Quality Score */}
        {drive.roughnessScore !== null && (
          <Card className={`mb-6 ${getRoughnessBgColor(drive.roughnessScore)}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Road Quality Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold ${getRoughnessColor(drive.roughnessScore)}`}>
                      {Math.round(drive.roughnessScore)}
                    </span>
                    <span className={`text-lg ${getRoughnessColor(drive.roughnessScore)}`}>
                      {getRoughnessLabel(drive.roughnessScore)}
                    </span>
                  </div>
                </div>
                {drive.roughnessBreakdown && (
                  <div className="flex gap-3 text-xs">
                    <div className="text-center">
                      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-medium mb-1">
                        {drive.roughnessBreakdown.smooth}%
                      </div>
                      <span className="text-gray-500">Smooth</span>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 rounded-full bg-lime-100 flex items-center justify-center text-lime-700 font-medium mb-1">
                        {drive.roughnessBreakdown.light}%
                      </div>
                      <span className="text-gray-500">Light</span>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-medium mb-1">
                        {drive.roughnessBreakdown.moderate}%
                      </div>
                      <span className="text-gray-500">Mod</span>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-medium mb-1">
                        {drive.roughnessBreakdown.rough}%
                      </div>
                      <span className="text-gray-500">Rough</span>
                    </div>
                    <div className="text-center">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-700 font-medium mb-1">
                        {drive.roughnessBreakdown.veryRough}%
                      </div>
                      <span className="text-gray-500">V.Rough</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Card className="border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">Duration</span>
              </div>
              <p className="text-xl font-semibold text-gray-900">
                {formatDuration(drive.duration)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <MapPin className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">Distance</span>
              </div>
              <p className="text-xl font-semibold text-gray-900">
                {formatDistance(drive.distance)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Gauge className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">Max Speed</span>
              </div>
              <p className="text-xl font-semibold text-gray-900">
                {formatSpeed(drive.maxSpeed)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-gray-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Activity className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wide">Samples</span>
              </div>
              <p className="text-xl font-semibold text-gray-900">
                {drive.sampleCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Map */}
        <Card className="border-gray-200 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-gray-900">Route</CardTitle>
          </CardHeader>
          <CardContent>
            {gpsPoints.length > 0 ? (
              <RouteMap points={gpsPoints} accelPoints={accelPoints} />
            ) : (
              <div className="h-[400px] bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 border border-gray-200">
                No GPS data available for this drive
              </div>
            )}
          </CardContent>
        </Card>

        {/* Road Roughness Timeline */}
        <Card className="border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-gray-900">Roughness Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <SensorTimeline
              accelPoints={accelPoints}
              startTime={startTime}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
