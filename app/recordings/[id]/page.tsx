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
import type { TrafficFeature } from '@/components/recordings/RouteMap';

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

interface TripAnalysis {
  status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  provider: string;
  confidence: number | null;
  coverage: number;
  matchedDistance: number | null;
  matchedGeometry: GeoJSON.LineString | null;
  netDirection: string | null;
  dominantDirection: string | null;
  directionBreakdown: Record<string, number> | null;
  trafficContext: {
    provider: 'mapbox';
    analyzedAt: string;
    speedLimitAverage: number | null;
    speedLimitCoverage: number;
    congestionScore: number | null;
    congestionLevel: 'LOW' | 'MODERATE' | 'HEAVY' | 'SEVERE' | 'UNKNOWN';
    observedAverageSpeed: number | null;
    observedSpeedRatio: number | null;
    roadCondition: 'NORMAL_FOR_ROAD' | 'SLOW_FOR_ROAD' | 'LOW_FOR_ROAD' | 'INSUFFICIENT_CONTEXT';
    snapshotOnly: boolean;
  } | null;
  errorCode: string | null;
}

interface Maneuver {
  sequence: number;
  turnType: string;
  instruction: string;
  fromRoad: string | null;
  toRoad: string | null;
  angleDegrees: number | null;
  confidence: number | null;
}

type TrafficTagKind = 'RED_LIGHT' | 'STOP_SIGN' | 'INTERSECTION' | 'TRAFFIC' | 'PARKING' | 'OTHER';

interface TrafficTag {
  id: string;
  featureKey: string;
  kind: TrafficTagKind;
  note: string | null;
}

const trafficTagOptions: Array<{ value: TrafficTagKind | 'UNCLASSIFIED'; label: string }> = [
  { value: 'UNCLASSIFIED', label: 'Unclassified' },
  { value: 'RED_LIGHT', label: 'Red light' },
  { value: 'STOP_SIGN', label: 'Stop sign' },
  { value: 'INTERSECTION', label: 'Intersection delay' },
  { value: 'TRAFFIC', label: 'Traffic queue' },
  { value: 'PARKING', label: 'Parking / destination' },
  { value: 'OTHER', label: 'Other' },
];

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
  const [tripAnalysis, setTripAnalysis] = useState<TripAnalysis | null>(null);
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);
  const [trafficTags, setTrafficTags] = useState<TrafficTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedTrafficFeatureId, setSelectedTrafficFeatureId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingFeatureKey, setSavingFeatureKey] = useState<string | null>(null);

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
        setTripAnalysis(data.tripAnalysis || null);
        setManeuvers(data.maneuvers || []);
        setTrafficTags(data.trafficTags || []);
        setRouteName(data.drive.name || '');
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

  const saveRouteName = async () => {
    if (!drive) return;
    setSavingName(true);
    try {
      const response = await fetch(`/api/recordings/${drive.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: routeName }),
      });
      if (!response.ok) throw new Error('Failed to save name');
      const data = await response.json();
      setDrive({ ...drive, name: data.drive.name });
      setEditingName(false);
    } catch (error) {
      console.error(error);
      alert('Could not save the route name.');
    } finally {
      setSavingName(false);
    }
  };

  const saveTrafficTag = async (feature: TrafficFeature, value: TrafficTagKind | 'UNCLASSIFIED') => {
    if (!drive) return;
    setSavingFeatureKey(feature.id);
    try {
      if (value === 'UNCLASSIFIED') {
        const response = await fetch(`/api/recordings/${drive.id}/traffic-tags?featureKey=${encodeURIComponent(feature.id)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to clear tag');
        setTrafficTags((current) => current.filter((tag) => tag.featureKey !== feature.id));
      } else {
        const start = gpsPoints[feature.start];
        const end = gpsPoints[feature.end];
        const response = await fetch(`/api/recordings/${drive.id}/traffic-tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            featureKey: feature.id,
            featureType: feature.kind,
            kind: value,
            latitude: feature.location.lat,
            longitude: feature.location.lng,
            startTime: start.timestamp,
            endTime: end.timestamp,
            duration: feature.duration,
          }),
        });
        if (!response.ok) throw new Error('Failed to save tag');
        const { tag } = await response.json() as { tag: TrafficTag };
        setTrafficTags((current) => [...current.filter((item) => item.featureKey !== tag.featureKey), tag]);
      }
    } catch (error) {
      console.error(error);
      alert('Could not save the traffic tag.');
    } finally {
      setSavingFeatureKey(null);
    }
  };

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
    const stops: TrafficFeature[] = [];
    const slowZones: TrafficFeature[] = [];

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
              id: `stop-${gpsPoints[stopStart].timestamp}-${gpsPoints[i - 1].timestamp}`,
              kind: 'stop',
              start: stopStart,
              end: i - 1,
              duration,
              location: gpsPoints[Math.floor((stopStart + i - 1) / 2)],
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
              id: `slow-zone-${gpsPoints[slowStart].timestamp}-${gpsPoints[i - 1].timestamp}`,
              kind: 'slow-zone',
              start: slowStart,
              end: i - 1,
              duration,
              avgSpeed,
              location: gpsPoints[Math.floor((slowStart + i - 1) / 2)],
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
          id: `stop-${gpsPoints[stopStart].timestamp}-${lastPoint.timestamp}`,
          kind: 'stop',
          start: stopStart,
          end: gpsPoints.length - 1,
          duration,
          location: gpsPoints[Math.floor((stopStart + gpsPoints.length - 1) / 2)],
        });
      }
    }

    if (slowStart !== null) {
      const lastPoint = gpsPoints[gpsPoints.length - 1];
      const duration = lastPoint.timestamp - gpsPoints[slowStart].timestamp;
      if (duration >= MIN_DURATION) {
        const avgSpeed = slowSpeeds.reduce((a, b) => a + b, 0) / slowSpeeds.length;
        slowZones.push({
          id: `slow-zone-${gpsPoints[slowStart].timestamp}-${lastPoint.timestamp}`,
          kind: 'slow-zone',
          start: slowStart,
          end: gpsPoints.length - 1,
          duration,
          avgSpeed,
          location: gpsPoints[Math.floor((slowStart + gpsPoints.length - 1) / 2)],
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
          {editingName ? (
            <div className="flex items-center gap-2">
              <input value={routeName} onChange={(event) => setRouteName(event.target.value)} maxLength={120} autoFocus className="h-10 rounded-md border border-gray-300 px-3 text-xl font-semibold text-gray-900" placeholder="Route #1 to work" />
              <Button size="sm" onClick={saveRouteName} disabled={savingName}>{savingName ? 'Saving…' : 'Save'}</Button>
              <Button size="sm" variant="outline" onClick={() => { setRouteName(drive.name || ''); setEditingName(false); }} disabled={savingName}>Cancel</Button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditingName(true)} className="text-left">
              <h1 className="text-2xl font-semibold text-gray-900">{drive.name || 'Name this route'}</h1>
              <span className="text-xs text-gray-500 underline">Rename this recording</span>
            </button>
          )}
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

      {tripAnalysis && (
        <Card className="mb-6 border-blue-200 bg-blue-50/40">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Map-matched trip analysis</CardTitle>
              <Badge variant="outline" className={
                tripAnalysis.status === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                tripAnalysis.status === 'PARTIAL' ? 'border-amber-200 bg-amber-50 text-amber-700' :
                tripAnalysis.status === 'FAILED' ? 'border-red-200 bg-red-50 text-red-700' :
                'border-gray-200'
              }>{tripAnalysis.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <AnalysisMetric label="Coverage" value={`${Math.round(tripAnalysis.coverage * 100)}%`} />
              <AnalysisMetric label="Confidence" value={tripAnalysis.confidence == null ? '—' : `${Math.round(tripAnalysis.confidence * 100)}%`} />
              <AnalysisMetric label="Net direction" value={formatDirection(tripAnalysis.netDirection)} />
              <AnalysisMetric label="Dominant direction" value={formatDirection(tripAnalysis.dominantDirection)} />
            </div>
            {tripAnalysis.directionBreakdown && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Distance by direction</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.entries(tripAnalysis.directionBreakdown)
                    .filter(([, value]) => value > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([direction, value]) => (
                      <div key={direction} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
                        <span className="capitalize">{direction}</span><span>{Math.round(value * 100)}%</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {tripAnalysis.errorCode && <p className="text-sm text-amber-700">Analysis note: {tripAnalysis.errorCode.replaceAll('_', ' ').toLowerCase()}</p>}
          </CardContent>
        </Card>
      )}

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
                  {tripAnalysis?.status === 'FAILED'
                    ? `Road matching failed${tripAnalysis.errorCode ? ` (${tripAnalysis.errorCode})` : ''}. The raw recording is still available.`
                    : tripAnalysis?.status === 'PROCESSING'
                      ? 'Road matching is still processing.'
                      : 'No sustained congestion was detected on this drive.'}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Stops & Slow Zones Summary - Compact Version */}
          {(stops.length > 0 || slowZones.length > 0) && (
            <Card className="mb-6 bg-purple-50 border-purple-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-medium text-gray-900">
                  Stops & Slow Zones Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {/* Total Stops */}
                  <div className="text-center p-3 bg-red-50 rounded-lg border border-red-200">
                    <div className="text-3xl font-bold text-red-600">{stops.length}</div>
                    <div className="text-sm text-gray-600">Stops</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDuration(stops.reduce((sum, s) => sum + s.duration, 0))}
                    </div>
                  </div>

                  {/* Total Slow Zones */}
                  <div className="text-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="text-3xl font-bold text-yellow-600">{slowZones.length}</div>
                    <div className="text-sm text-gray-600">Slow Zones</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDuration(slowZones.reduce((sum, s) => sum + s.duration, 0))}
                    </div>
                  </div>

                  {/* Combined Time & Percentage */}
                  <div className="text-center p-3 bg-purple-100 rounded-lg border border-purple-300">
                    <div className="text-3xl font-bold text-purple-600">
                      {formatDuration(
                        stops.reduce((sum, s) => sum + s.duration, 0) +
                        slowZones.reduce((sum, s) => sum + s.duration, 0)
                      )}
                    </div>
                    <div className="text-sm text-gray-600">Total Time</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {Math.round(
                        (stops.reduce((sum, s) => sum + s.duration, 0) +
                         slowZones.reduce((sum, s) => sum + s.duration, 0)) /
                        (drive.duration || 1) * 100
                      )}% of trip
                    </div>
                  </div>
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
            <RouteMap
              points={gpsPoints}
              accelPoints={accelPoints}
              mode={drive.recordingMode}
              matchedGeometry={tripAnalysis?.matchedGeometry}
              stops={stops}
              slowZones={slowZones}
              selectedTrafficFeatureId={selectedTrafficFeatureId}
              onTrafficFeatureSelect={setSelectedTrafficFeatureId}
            />
          ) : (
            <div className="h-[400px] bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 border border-gray-200">
              No GPS data available for this drive
            </div>
          )}
        </CardContent>
      </Card>

      {drive.recordingMode === 'TRAFFIC' && (stops.length > 0 || slowZones.length > 0) && (
        <Card className="mb-6 border-gray-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Detected traffic features</CardTitle>
            <p className="text-sm text-gray-500">Classify each observation. Tags are saved with this drive and preserve the original GPS evidence.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...stops, ...slowZones].map((feature, index) => {
              const active = feature.id === selectedTrafficFeatureId;
              const isStop = feature.kind === 'stop';
              const tag = trafficTags.find((item) => item.featureKey === feature.id);
              return (
                <div
                  key={feature.id}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-400'}`}
                >
                  <button type="button" onClick={() => setSelectedTrafficFeatureId(active ? null : feature.id)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-medium ${isStop ? 'text-red-700' : 'text-orange-700'}`}>{isStop ? 'Detected stop' : 'Slow zone'} {index + 1}</span>
                      <span className="text-sm text-gray-600">{formatDuration(feature.duration)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{isStop ? 'Stationary GPS observation.' : `Average speed ${(feature.avgSpeed! * 2.23694).toFixed(1)} mph.`} Select to locate it on the map.</p>
                  </button>
                  <label className="mt-3 flex items-center gap-2 text-sm text-gray-600">
                    Tag
                    <select value={tag?.kind ?? 'UNCLASSIFIED'} onChange={(event) => saveTrafficTag(feature, event.target.value as TrafficTagKind | 'UNCLASSIFIED')} disabled={savingFeatureKey === feature.id} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-900">
                      {trafficTagOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    {savingFeatureKey === feature.id && <span className="text-xs">Saving…</span>}
                  </label>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {drive.recordingMode === 'TRAFFIC' && tripAnalysis?.trafficContext && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Road-speed context</CardTitle>
            <p className="text-sm text-gray-600">Compares your recorded speed with Mapbox road-speed data. This is a post-upload traffic snapshot, not historical proof of conditions during the drive.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AnalysisMetric label="Your average" value={tripAnalysis.trafficContext.observedAverageSpeed == null ? '—' : `${(tripAnalysis.trafficContext.observedAverageSpeed * 2.23694).toFixed(1)} mph`} />
            <AnalysisMetric label="Road speed limit" value={tripAnalysis.trafficContext.speedLimitAverage == null ? 'Unavailable' : `${(tripAnalysis.trafficContext.speedLimitAverage * 2.23694).toFixed(0)} mph`} />
            <AnalysisMetric label="Relative pace" value={tripAnalysis.trafficContext.observedSpeedRatio == null ? '—' : `${Math.round(tripAnalysis.trafficContext.observedSpeedRatio * 100)}%`} />
            <AnalysisMetric label="Road condition" value={tripAnalysis.trafficContext.roadCondition.replaceAll('_', ' ').toLowerCase()} />
            <AnalysisMetric label="Mapbox snapshot" value={tripAnalysis.trafficContext.congestionLevel.toLowerCase()} />
            <AnalysisMetric label="Traffic score" value={tripAnalysis.trafficContext.congestionScore == null ? 'Unavailable' : `${Math.round(tripAnalysis.trafficContext.congestionScore)}/100`} />
            <AnalysisMetric label="Speed-limit coverage" value={`${Math.round(tripAnalysis.trafficContext.speedLimitCoverage * 100)}%`} />
            <AnalysisMetric label="Analyzed" value={new Date(tripAnalysis.trafficContext.analyzedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} />
          </CardContent>
        </Card>
      )}

      {maneuvers.length > 0 && (
        <Card className="mb-6 border-gray-200">
          <CardHeader className="pb-2"><CardTitle className="text-lg">Named maneuvers</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {maneuvers.map((maneuver) => (
                <li key={maneuver.sequence} className="flex gap-3 rounded-lg border bg-white p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{maneuver.sequence + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{maneuver.instruction}</p>
                    <p className="text-xs text-gray-500">
                      {maneuver.fromRoad && maneuver.toRoad ? `${maneuver.fromRoad} → ${maneuver.toRoad}` : maneuver.turnType.replaceAll('-', ' ')}
                      {maneuver.angleDegrees != null ? ` · ${Math.round(maneuver.angleDegrees)}°` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

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

function AnalysisMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-white p-3"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 font-semibold capitalize text-gray-900">{value}</p></div>;
}

function formatDirection(direction: string | null): string {
  return direction ? direction.toLowerCase().replaceAll('_', ' ') : '—';
}
