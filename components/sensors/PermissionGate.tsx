'use client';

import { useSensorContext } from '@/components/providers/SensorProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Smartphone, MapPin, AlertCircle } from 'lucide-react';

export function PermissionGate({ children }: { children: React.ReactNode }) {
  const { permissions, requestAllPermissions, permissionError } = useSensorContext();

  // If both permissions are granted, render children
  if (permissions.motion === 'granted' && permissions.location === 'granted') {
    return <>{children}</>;
  }

  // Otherwise, show permission request UI
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Sensor Access Required</CardTitle>
          <CardDescription>
            This app requires access to your device&apos;s motion sensors and location to function.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Motion Sensor</span>
              </div>
              <Badge variant={permissions.motion === 'granted' ? 'default' : 'outline'}>
                {permissions.motion === 'pending' ? 'Pending' : permissions.motion}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">Location</span>
              </div>
              <Badge variant={permissions.location === 'granted' ? 'default' : 'outline'}>
                {permissions.location === 'pending' ? 'Pending' : permissions.location}
              </Badge>
            </div>
          </div>

          {permissionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Permission Error</AlertTitle>
              <AlertDescription>{permissionError}</AlertDescription>
            </Alert>
          )}

          {permissions.motion === 'unsupported' || permissions.location === 'unsupported' ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Device Not Supported</AlertTitle>
              <AlertDescription>
                Your device or browser does not support the required sensors.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Button onClick={requestAllPermissions} className="w-full" size="lg">
                Grant Sensor Access
              </Button>

              <div className="text-sm text-muted-foreground space-y-2">
                <p className="font-medium">iOS Safari Users:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>You must be on HTTPS</li>
                  <li>Click the button above</li>
                  <li>Allow motion &amp; orientation</li>
                  <li>Allow location access</li>
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
