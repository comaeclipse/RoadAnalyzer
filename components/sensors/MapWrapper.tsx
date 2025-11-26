'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Dynamic import to prevent SSR issues with Leaflet
const MapDisplay = dynamic(
  () => import('./MapDisplay').then((mod) => ({ default: mod.MapDisplay })),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardHeader>
          <CardTitle>GPS Map</CardTitle>
          <CardDescription>Location tracking</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] flex items-center justify-center text-muted-foreground">
            <p>Loading map...</p>
          </div>
        </CardContent>
      </Card>
    ),
  }
);

export { MapDisplay as MapWrapper };
