# Road Analyzer - iOS Sensor Dashboard

A Next.js application that displays live iOS sensor data (accelerometer and GPS) in the browser with three visualization modes: numeric values, live charts, and an interactive map.

## Features

- **Real-time Accelerometer Data**: Display X, Y, Z axis readings with magnitude calculation
- **GPS Tracking**: Show latitude, longitude, altitude, speed, and heading
- **Three Visualization Modes**:
  - Numeric: Raw sensor values with color-coded displays
  - Charts: Live time-series graphs using Recharts
  - Map: Interactive OpenStreetMap with position tracking and path history
- **iOS Safari Compatible**: Proper permission handling for iOS 13+
- **Responsive Design**: Works on both portrait and landscape orientations
- **shadcn/ui Theming**: Professional, modern UI components

## Requirements

- Node.js 20+
- HTTPS connection (required for iOS sensor access)
- iOS 13+ device with Safari browser
- Location and motion sensor permissions

## Installation

```bash
# Install dependencies
npm install

# Run development server with HTTPS (required for iOS)
npm run dev -- --experimental-https

# Or for production build
npm run build
npm start
```

## Usage

1. Open the app on your iOS device using Safari over HTTPS
2. Click "Grant Sensor Access" button
3. Allow motion and location permissions when prompted
4. View sensor data in three different modes using the tabs

## Development

### Project Structure

```
├── app/                    # Next.js App Router pages
├── components/
│   ├── ui/                # shadcn/ui components
│   ├── sensors/           # Sensor visualization components
│   └── providers/         # React Context providers
├── hooks/                 # Custom React hooks
├── lib/                   # Utility functions and constants
├── types/                 # TypeScript type definitions
└── public/                # Static assets
```

### Key Components

- **SensorProvider**: Context provider that manages all sensor state
- **useSensorPermissions**: Hook for iOS permission handling
- **useAccelerometer**: Hook for device motion events
- **useGeolocation**: Hook for GPS tracking
- **PermissionGate**: UI for requesting sensor permissions
- **SensorDashboard**: Main dashboard with tab navigation
- **NumericDisplay**: Displays raw sensor values
- **ChartDisplay**: Time-series charts with Recharts
- **MapDisplay**: Leaflet map with position and path

## iOS Safari Notes

- **HTTPS Required**: iOS Safari silently denies sensor permissions over HTTP
- **User Gesture**: Permission request must be triggered by user action (button click)
- **Permission Caching**: Safari caches permission state across page reloads
- **Battery Usage**: Sensor polling is throttled to minimize battery drain (10Hz accelerometer, 1Hz GPS)

## Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

Vercel provides automatic HTTPS and seamless Next.js integration.

### Other Platforms

Any platform that supports Next.js and provides HTTPS will work (Netlify, Railway, etc.)

## Configuration

Key configuration constants are in `lib/constants.ts`:

- `ACCELEROMETER_INTERVAL`: 100ms (10 Hz)
- `GPS_INTERVAL`: 1000ms (1 Hz)
- `MAX_HISTORY_LENGTH`: 50 readings
- `DEFAULT_MAP_ZOOM`: 15

## Troubleshooting

**Permission request not showing:**
- Ensure you're on HTTPS
- Check iOS version (must be 13+)
- Clear Safari website data and retry

**Map not rendering:**
- Verify MapWrapper uses dynamic import with `ssr: false`
- Check browser console for errors
- Ensure Leaflet CSS is imported

**Sensor data not updating:**
- Check permission state in UI
- Look for errors in browser console
- Try reloading the page

## License

MIT
