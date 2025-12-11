'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, Gauge, Clock, Activity, Trash2, MapPinPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import dynamic from 'next/dynamic';
import { SensorTimeline } from '@/components/recordings/SensorTimeline';
import { PageLayout } from '@/components/layout/PageLayout';

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
  recordingMode: 'ROAD_QUALITY' | 'TRAFFIC';
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

interface CongestionEvent {
  id: string;
  startTime: string;
  endTime: string;
  duration: number;
  severity: 'FREE_FLOW' | 'SLOW' | 'CONGESTED' | 'HEAVY' | 'GRIDLOCK';
  avgSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  distance: number;
  segment: {
    id: string;
    name: string;
    geometry: any;
  };
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

function getSeverityLabel(severity: string): string {
  switch (severity) {
    case 'FREE_FLOW': return 'Free Flow';
    case 'SLOW': return 'Slow';
    case 'CONGESTED': return 'Congested';
    case 'HEAVY': return 'Heavy';
    case 'GRIDLOCK': return 'Gridlock';
    default: return severity;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'FREE_FLOW': return 'text-green-600';
    case 'SLOW': return 'text-yellow-600';
    case 'CONGESTED': return 'text-orange-600';
    case 'HEAVY': return 'text-red-600';
    case 'GRIDLOCK': return 'text-red-900';
    default: return 'text-gray-600';
  }
}

function getSeverityBgColor(severity: string): string {
  switch (severity) {
    case 'FREE_FLOW': return 'bg-green-50 border-green-200';
    case 'SLOW': return 'bg-yellow-50 border-yellow-200';
    case 'CONGESTED': return 'bg-orange-50 border-orange-200';
    case 'HEAVY': return 'bg-red-50 border-red-200';
    case 'GRIDLOCK': return 'bg-red-100 border-red-300';
    default: return 'bg-gray-50 border-gray-200';
  }
}

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [gpsPoints, setGpsPoints] = useState<GpsPoint[]>([]);
  const [accelPoints, setAccelPoints] = useState<AccelPoint[]>([]);
  const [congestionEvents, setCongestionEvents] = useState<CongestionEvent[]>([]);
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
        setCongestionEvents(data.congestionEvents || []);
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

  // Detect stops and slow zones from GPS data
  const detectStopsAndSlowZones = () => {
    const stops: Array<{ start: number; end: number; duration: number; location: GpsPoint }> = [];
    const slowZones: Array<{ start: number; end: number; duration: number; avgSpeed: number; location: GpsPoint }> = [];

    let stopStart: number | null = null;
    let slowStart: number | null = null;
    let slowSpeeds: number[] = [];

    const STOP_THRESHOLD = 0.5; // m/s (~1.1 mph)
    const SLOW_THRESHOLD = 4.5; // m/s (~10 mph)
    const MIN_DURATION = 5000; // 5 seconds minimum

    for (let i = 0; i < gpsPoints.length; i++) {
      const point = gpsPoints[i];
      const speed = point.speed || 0;

      // Detect stops
      if (speed < STOP_THRESHOLD) {
        if (stopStart === null) {
          stopStart = i;
        }
      } else {
        if (stopStart !== null) {
          const duration = point.timestamp - gpsPoints[stopStart].timestamp;
          if (duration >= MIN_DURATION) {
            stops.push({
              start: stopStart,
              end: i - 1,
              duration,
              location: gpsPoints[stopStart],
            });
          }
          stopStart = null;
        }
      }

      // Detect slow zones (moving but slow)
      if (speed >= STOP_THRESHOLD && speed < SLOW_THRESHOLD) {
        if (slowStart === null) {
          slowStart = i;
          slowSpeeds = [speed];
        } else {
          slowSpeeds.push(speed);
        }
      } else {
        if (slowStart !== null) {
          const duration = point.timestamp - gpsPoints[slowStart].timestamp;
          if (duration >= MIN_DURATION) {
            const avgSpeed = slowSpeeds.reduce((a, b) => a + b, 0) / slowSpeeds.length;
            slowZones.push({
              start: slowStart,
              end: i - 1,
              duration,
              avgSpeed,
              location: gpsPoints[slowStart],
            });
          }
          slowStart = null;
          slowSpeeds = [];
        }
      }
    }

    // Handle ongoing stop/slow at end
    if (stopStart !== null) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      const duration = lastPoint.timestamp - gpsPoints[stopStart].timestamp;
      if (duration >= MIN_DURATION) {
        stops.push({
          start: stopStart,
          end: gpsPoints.length - 1,
          duration,
          location: gpsPoints[stopStart],
        });
      }
    }

    if (slowStart !== null) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      const duration = lastPoint.timestamp - gpsPoints[slowStart].timestamp;
      if (duration >= MIN_DURATION) {
        const avgSpeed = slowSpeeds.reduce((a, b) => a + b, 0) / slowSpeeds.length;
        slowZones.push({
          start: slowStart,
          end: gpsPoints.length - 1,
          duration,
          avgSpeed,
          location: gpsPoints[slowStart],
        });
      }
    }

    return { stops, slowZones };
  };

  const { stops, slowZones } = gpsPoints.length > 0 ? detectStopsAndSlowZones() : { stops: [], slowZones: [] };

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
      <PageLayout maxWidth="4xl">
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
        </div>
      </PageLayout>
    );
  }

  if (error || !drive) {
    return (
      <PageLayout maxWidth="4xl">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-center text-red-600">
            {error || 'Recording not found'}
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout maxWidth="4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {drive.name || 'Untitled Drive'}
          </h1>
          <p className="text-sm text-gray-500">
            {formatDistanceToNow(new Date(drive.createdAt), { addSuffix: true })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/recordings/${drive.id}/edit`)}
              className="gap-2 border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <MapPinPen className="h-4 w-4" />
              Edit Route
            </Button>
            {getStatusBadge(drive.status)}
          </div>
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
      </div>

      {/* Traffic Analysis Summary */}
      {drive.recordingMode === 'TRAFFIC' && (
        <>
          {congestionEvents.length > 0 ? (
            <Card className="mb-6 bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">Traffic Analysis</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-blue-600">
                        {congestionEvents.length}
                      </span>
                      <span className="text-lg text-blue-600">
                        Congestion Event{congestionEvents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs">
                    {['GRIDLOCK', 'HEAVY', 'CONGESTED', 'SLOW', 'FREE_FLOW'].map((severity) => {
                      const count = congestionEvents.filter(e => e.severity === severity).length;
                      if (count === 0) return null;
                      return (
                        <div key={severity} className="text-center">
                          <div className={`px-2 py-1 rounded ${getSeverityBgColor(severity)}`}>
                            <div className={`font-bold ${getSeverityColor(severity)}`}>{count}</div>
                          </div>
                          <span className="text-gray-500 mt-1 block">{getSeverityLabel(severity)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="mb-6 bg-amber-50 border-amber-200">
              <CardContent className="p-4">
                <p className="text-sm text-gray-700 mb-2">
                  <strong>No traffic analysis available.</strong>
                </p>
                <p className="text-sm text-gray-600">
                  Traffic analysis requires road segments to be defined. Visit the{' '}
                  <button
                    onClick={() => router.push('/segments')}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Segments page
                  </button>
                  {' '}to create road segments, then record a new traffic session.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Stops & Slow Zones (works without segments) */}
          {(stops.length > 0 || slowZones.length > 0) && (
            <Card className="mb-6 bg-purple-50 border-purple-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-medium text-gray-900">Stops & Slow Zones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
                    <div className="text-3xl font-bold text-red-600">{stops.length}</div>
                    <div className="text-sm text-gray-600">Stops (≥5s)</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Total: {formatDuration(stops.reduce((sum, s) => sum + s.duration, 0))}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="text-3xl font-bold text-yellow-600">{slowZones.length}</div>
                    <div className="text-sm text-gray-600">Slow Zones (&lt;10 mph)</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Total: {formatDuration(slowZones.reduce((sum, s) => sum + s.duration, 0))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {stops.slice(0, 5).map((stop, idx) => (
                    <div key={`stop-${idx}`} className="p-2 bg-red-50 rounded border border-red-200 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                            Stop {idx + 1}
                          </Badge>
                          <span className="text-gray-600">
                            {formatDuration(stop.duration)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {stop.location.lat.toFixed(5)}, {stop.location.lng.toFixed(5)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {stops.length > 5 && (
                    <p className="text-xs text-gray-500 text-center">
                      ... and {stops.length - 5} more stops
                    </p>
                  )}

                  {slowZones.slice(0, 3).map((zone, idx) => (
                    <div key={`slow-${idx}`} className="p-2 bg-yellow-50 rounded border border-yellow-200 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-300">
                            Slow {idx + 1}
                          </Badge>
                          <span className="text-gray-600">
                            {formatDuration(zone.duration)} @ {formatSpeed(zone.avgSpeed)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {zone.location.lat.toFixed(5)}, {zone.location.lng.toFixed(5)}
                        </span>
                      </div>
                    </div>
                  ))}
                  {slowZones.length > 3 && (
                    <p className="text-xs text-gray-500 text-center">
                      ... and {slowZones.length - 3} more slow zones
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Road Quality Score */}
      {drive.recordingMode === 'ROAD_QUALITY' && drive.roughnessScore !== null && (
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

      {/* Traffic Events Details */}
      {drive.recordingMode === 'TRAFFIC' && congestionEvents.length > 0 && (
        <Card className="border-gray-200 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-medium text-gray-900">Congestion Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {congestionEvents.map((event, idx) => (
                <div key={event.id} className={`p-3 rounded-lg border ${getSeverityBgColor(event.severity)}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900">Event {idx + 1}</span>
                        <Badge variant="outline" className={`${getSeverityColor(event.severity)} border-current`}>
                          {getSeverityLabel(event.severity)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{event.segment.name}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">Duration:</span>
                          <span className="ml-1 font-medium">{formatDuration(event.duration)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Distance:</span>
                          <span className="ml-1 font-medium">{formatDistance(event.distance)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Avg Speed:</span>
                          <span className="ml-1 font-medium">{formatSpeed(event.avgSpeed)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Min Speed:</span>
                          <span className="ml-1 font-medium">{formatSpeed(event.minSpeed)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Road Roughness Timeline */}
      {drive.recordingMode === 'ROAD_QUALITY' && (
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
      )}
    </PageLayout>
  );
}
