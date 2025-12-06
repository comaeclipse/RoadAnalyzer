'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { HeatmapSegment } from '@/types/congestion';

const AllRoutesMap = dynamic(() => import('@/components/map/AllRoutesMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100vh-12rem)] bg-gray-50 rounded-lg flex items-center justify-center border border-gray-200">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
    </div>
  ),
});

const CongestionHeatmap = dynamic(() => import('@/components/map/CongestionHeatmap'), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100vh-12rem)] bg-gray-50 rounded-lg flex items-center justify-center border border-gray-200">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
    </div>
  ),
});

interface Route {
  id: string;
  name: string | null;
  createdAt: string;
  distance: number | null;
  roughnessScore: number | null;
  points: { lat: number; lng: number }[];
}

export default function MapPage() {
  const [viewMode, setViewMode] = useState<'quality' | 'congestion'>('quality');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [segments, setSegments] = useState<HeatmapSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRoutes() {
      try {
        const res = await fetch('/api/recordings/all-routes');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setRoutes(data.routes);
      } catch (err) {
        setError('Failed to load routes');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchRoutes();
  }, []);

  useEffect(() => {
    async function fetchHeatmap() {
      if (viewMode === 'congestion') {
        try {
          const res = await fetch('/api/congestion/heatmap');
          if (!res.ok) throw new Error('Failed to fetch');
          const data = await res.json();
          setSegments(data.heatmap);
        } catch (err) {
          console.error('Failed to load heatmap:', err);
        }
      }
    }
    fetchHeatmap();
  }, [viewMode]);

  const totalDistance = routes.reduce((sum, r) => sum + (r.distance || 0), 0);
  const formatDistance = (meters: number) => {
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)} mi`;
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-900 hover:bg-gray-100">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">All Routes</h1>
              <p className="text-sm text-gray-500">
                {routes.length} recordings • {formatDistance(totalDistance)} total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
              <Button
                variant={viewMode === 'quality' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('quality')}
                className={viewMode === 'quality' ? '' : 'text-gray-600 hover:text-gray-900'}
              >
                Road Quality
              </Button>
              <Button
                variant={viewMode === 'congestion' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('congestion')}
                className={viewMode === 'congestion' ? '' : 'text-gray-600 hover:text-gray-900'}
              >
                Congestion
              </Button>
            </div>
            <Link href="/recordings">
              <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">
                View List
              </Button>
            </Link>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
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

        {!loading && !error && routes.length === 0 && (
          <Card className="border-gray-200">
            <CardContent className="py-12 text-center text-gray-500">
              No recordings yet. Start a recording from the dashboard!
            </CardContent>
          </Card>
        )}

        {!loading && !error && (routes.length > 0 || segments.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Map */}
            <div className="lg:col-span-3">
              <Card className="border-gray-200 overflow-hidden">
                <CardContent className="p-0">
                  {viewMode === 'quality' && routes.length > 0 && (
                    <AllRoutesMap
                      routes={routes}
                      selectedRouteId={selectedRouteId}
                      onRouteSelect={setSelectedRouteId}
                    />
                  )}
                  {viewMode === 'congestion' && segments.length > 0 && (
                    <CongestionHeatmap
                      segments={segments}
                      selectedSegmentId={selectedSegmentId}
                      onSegmentSelect={setSelectedSegmentId}
                    />
                  )}
                  {viewMode === 'congestion' && segments.length === 0 && (
                    <div className="h-[calc(100vh-12rem)] flex items-center justify-center text-gray-500">
                      No congestion data yet. Create road segments and record drives to see congestion patterns.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              {/* Legend */}
              <Card className="border-gray-200">
                <CardContent className="p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                    {viewMode === 'quality' ? 'Road Quality' : 'Congestion Score'}
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded-full bg-green-500"></div>
                      <span className="text-xs text-gray-600">
                        {viewMode === 'quality' ? '90+ Excellent' : '80-100 Free Flow'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded-full bg-lime-500"></div>
                      <span className="text-xs text-gray-600">
                        {viewMode === 'quality' ? '75-89 Good' : '60-79 Good'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded-full bg-yellow-500"></div>
                      <span className="text-xs text-gray-600">
                        {viewMode === 'quality' ? '50-74 Fair' : '40-59 Moderate'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded-full bg-orange-500"></div>
                      <span className="text-xs text-gray-600">
                        {viewMode === 'quality' ? '25-49 Poor' : '20-39 Heavy'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-1 rounded-full bg-red-500"></div>
                      <span className="text-xs text-gray-600">
                        {viewMode === 'quality' ? '0-24 Very Poor' : '0-19 Gridlock'}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Route/Segment list */}
              <Card className="border-gray-200">
                <CardContent className="p-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Recordings</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {routes.map((route) => (
                      <button
                        key={route.id}
                        onClick={() => setSelectedRouteId(selectedRouteId === route.id ? null : route.id)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                          selectedRouteId === route.id
                            ? 'border-gray-400 bg-gray-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {route.name || 'Untitled'}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                          <span>{formatDistance(route.distance || 0)}</span>
                          {route.roughnessScore !== null && (
                            <span className={getRoughnessColor(route.roughnessScore)}>
                              {Math.round(route.roughnessScore)}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getRoughnessColor(score: number): string {
  if (score >= 90) return 'text-green-600';
  if (score >= 75) return 'text-lime-600';
  if (score >= 50) return 'text-yellow-600';
  if (score >= 25) return 'text-orange-600';
  return 'text-red-600';
}

