'use client';

import { useSensorContext } from '@/components/providers/SensorProvider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { NumericDisplay } from './NumericDisplay';
import { ChartDisplay } from './ChartDisplay';
import { MapWrapper } from './MapWrapper';
import { RecordingControls } from '@/components/recordings/RecordingControls';
import { Activity, Smartphone, MapPin } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';

export function SensorDashboard() {
  const { isEnabled, accelerometer, gps } = useSensorContext();

  const hasAccelData = accelerometer.data !== null;
  const hasGPSData = gps.data !== null;

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">
              Live sensor visualization
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-sm border-gray-300 ${isEnabled ? 'bg-gray-100 text-gray-900' : 'text-gray-500'}`}>
              <Activity className="w-4 h-4 mr-1" />
              {isEnabled ? 'Active' : 'Inactive'}
            </Badge>
            <Badge variant="outline" className={`text-sm border-gray-300 ${hasAccelData ? 'bg-gray-100 text-gray-900' : 'text-gray-500'}`}>
              <Smartphone className="w-4 h-4 mr-1" />
              Accelerometer
            </Badge>
            <Badge variant="outline" className={`text-sm border-gray-300 ${hasGPSData ? 'bg-gray-100 text-gray-900' : 'text-gray-500'}`}>
              <MapPin className="w-4 h-4 mr-1" />
              GPS
            </Badge>
          </div>
        </div>

        {/* Recording Controls */}
        <RecordingControls />

        {/* Tabs for different visualizations */}
        <Tabs defaultValue="numeric" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-gray-100 border border-gray-200">
            <TabsTrigger value="numeric" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">Numeric</TabsTrigger>
            <TabsTrigger value="charts" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">Charts</TabsTrigger>
            <TabsTrigger value="map" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">Map</TabsTrigger>
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
    </PageLayout>
  );
}
