'use client';

import { useSensorContext } from '@/components/providers/SensorProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { NumericDisplay } from './NumericDisplay';
import { ChartDisplay } from './ChartDisplay';
import { MapWrapper } from './MapWrapper';
import { RecordingControls } from '@/components/recordings/RecordingControls';
import { Activity, Smartphone, MapPin, History } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function SensorDashboard() {
  const { isEnabled, accelerometer, gps } = useSensorContext();

  const hasAccelData = accelerometer.data !== null;
  const hasGPSData = gps.data !== null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Road Analyzer</h1>
            <p className="text-muted-foreground mt-2">
              Live iOS sensor visualization dashboard
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/recordings">
              <Button variant="outline" size="sm" className="gap-2">
                <History className="w-4 h-4" />
                Recordings
              </Button>
            </Link>
            <Badge variant={isEnabled ? 'default' : 'outline'} className="text-sm">
              <Activity className="w-4 h-4 mr-1" />
              {isEnabled ? 'Active' : 'Inactive'}
            </Badge>
            <Badge variant={hasAccelData ? 'default' : 'outline'} className="text-sm">
              <Smartphone className="w-4 h-4 mr-1" />
              Accelerometer
            </Badge>
            <Badge variant={hasGPSData ? 'default' : 'outline'} className="text-sm">
              <MapPin className="w-4 h-4 mr-1" />
              GPS
            </Badge>
          </div>
        </div>

        {/* Recording Controls */}
        <RecordingControls />

        {/* Tabs for different visualizations */}
        <Tabs defaultValue="numeric" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="numeric">Numeric</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>

          <TabsContent value="numeric">
            <NumericDisplay />
          </TabsContent>

          <TabsContent value="charts">
            <ChartDisplay />
          </TabsContent>

          <TabsContent value="map">
            <MapWrapper />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
