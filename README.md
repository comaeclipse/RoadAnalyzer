# RoadAnalyzer

A mobile-first Next.js application for analyzing road conditions and traffic patterns using smartphone sensors. Record drives to detect road surface quality using accelerometer data or monitor traffic congestion using GPS speed data.

## Features

### Native iPhone Traffic Recorder

The browser dashboard is now the public congestion viewer. A native SwiftUI recorder lives in [`RoadAnalyzerIOS`](RoadAnalyzerIOS) and captures manually started drives with background GPS, heading, motion diagnostics, battery state, and network-aware upload retries. Point its `RoadAnalyzerAPIBaseURL` setting at the deployed dashboard before sideloading from Xcode.

Completed iPhone sessions upload to `POST /api/mobile-reports`. The endpoint is deliberately unauthenticated for a personal-sideload prototype, so it must not be exposed as a production public writer without adding authentication and rate limiting.

### Two Recording Modes

- **🟢 Road Quality Analysis**: Uses accelerometer data to detect bumps, potholes, and road roughness. Generates a road quality score (0-100 scale).
- **🟠 Traffic Analysis**: Uses GPS speed data to detect congestion events with severity levels (Free Flow → Gridlock).

### Real-time Sensor Dashboard

- **Numeric View**: Live sensor values with color-coded displays
- **Charts View**: Time-series graphs for accelerometer and speed data
- **Map View**: Interactive Mapbox maps with live position tracking, raw traces, and matched routes

### Drive Recording & Playback

- Record drives with automatic sensor data buffering
- View recorded routes on interactive maps
- Sensor timeline visualization with accelerometer magnitude graphs
- Automatic calculation of drive statistics (distance, duration, avg/max speed)

### Road Quality Analysis

- Accelerometer-based bump detection
- Roughness classification: Smooth, Light, Moderate, Rough, Very Rough
- Overall road quality score (0-100)
- Baseline calibration for accurate readings

### Traffic/Congestion Analysis

- GPS-based speed monitoring
- Congestion severity levels: Free Flow, Slow, Congested, Heavy, Gridlock
- Trace-level Mapbox road matching with OpenLR-backed segment identity
- Net/dominant direction analysis and named turn maneuvers
- Pre-aggregated statistics by time of day and day of week
- Heatmap visualization of congestion hotspots

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **UI**: Tailwind CSS + shadcn/ui components
- **Maps**: Mapbox GL JS
- **Charts**: Recharts
- **Geospatial**: Turf.js
- **Deployment**: Vercel

## Requirements

- Node.js 20+
- PostgreSQL database (Neon recommended for serverless)
- HTTPS connection (required for iOS sensor access)
- iOS 13+ or Android device with motion sensors and GPS

## Installation

```bash
# Clone the repository
git clone https://github.com/comaeclipse/RoadAnalyzer.git
cd RoadAnalyzer

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

## Environment Variables

```env
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
MAPBOX_ACCESS_TOKEN="pk.server-token-with-navigation-scope"
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="pk.public-url-restricted-token"
```

## Project Structure

```
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── congestion/heatmap/   # Congestion heatmap data
│   │   ├── recordings/           # Drive recording CRUD
│   │   └── segments/             # Road segment management
│   ├── calibration/              # Accelerometer calibration page
│   ├── map/                      # All routes map view
│   ├── recordings/               # Recording list & detail pages
│   └── page.tsx                  # Home - sensor dashboard
├── components/
│   ├── calibration/              # Baseline calibration UI
│   ├── map/                      # Map components (heatmap, routes)
│   ├── providers/                # React Context (sensors, recording)
│   ├── recordings/               # Recording controls, route map
│   ├── sensors/                  # Sensor visualization components
│   └── ui/                       # shadcn/ui components
├── hooks/                        # Custom React hooks
│   ├── useAccelerometer.ts       # Device motion events
│   ├── useGeolocation.ts         # GPS tracking
│   └── useSensorPermissions.ts   # iOS permission handling
├── lib/                          # Core logic
│   ├── baseline.ts               # Accelerometer calibration
│   ├── congestion-detection.ts   # Traffic congestion algorithms
│   ├── post-processing.ts        # Drive analysis pipeline
│   ├── roughness.ts              # Road quality scoring
│   └── segment-matching.ts       # GPS-to-road matching
├── prisma/
│   ├── schema.prisma             # Database schema
│   └── migrations/               # Database migrations
├── scripts/                      # Utility scripts
└── types/                        # TypeScript definitions
```

## Database Schema

### Core Models

- **Drive**: Recording session with metadata and computed statistics
- **AccelerometerSample**: X, Y, Z axis readings with magnitude
- **GpsSample**: Location, speed, heading, altitude data
- **RoadSegment**: Geographic road sections (GeoJSON LineString)
- **TripAnalysis**: Mapbox-matched geometry, coverage, confidence, and directional summary
- **Maneuver**: Ordered named turns, ramps, forks, merges, and roundabouts
- **CongestionEvent**: Detected traffic slowdowns with severity
- **SegmentStatistics**: Pre-aggregated stats by time windows

### Enums

- **RecordingMode**: `ROAD_QUALITY` | `TRAFFIC`
- **CongestionSeverity**: `FREE_FLOW` | `SLOW` | `CONGESTED` | `HEAVY` | `GRIDLOCK`
- **RoadType**: `HIGHWAY` | `ARTERIAL` | `COLLECTOR` | `LOCAL` | `RESIDENTIAL`

## Usage

### Recording a Drive

1. Open the app on your mobile device (HTTPS required)
2. Grant sensor permissions when prompted
3. Choose recording mode:
   - **Road Quality** - for surface condition analysis
   - **Traffic** - for congestion monitoring
4. Press the recording button to start
5. Drive your route
6. Stop recording - analysis runs automatically

### Viewing Results

- **Recordings page**: List of all recorded drives with stats
- **Recording detail**: Route map, sensor timeline, quality/congestion metrics
- **Map page**: All recorded routes overlaid on a map

### Calibration

Visit `/calibration` to calibrate the accelerometer baseline for your device. Place your phone flat and stable, then run calibration to establish a reference point for accurate road quality measurements.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/recordings` | GET | List all recordings |
| `/api/recordings` | POST | Get recording by ID |
| `/api/recordings/start` | POST | Start new recording |
| `/api/recordings/stop` | POST | Stop recording, run analysis |
| `/api/recordings/sensor-data` | POST | Batch upload sensor data |
| `/api/recordings/all-routes` | GET | Get all routes for map |
| `/api/segments` | GET/POST | CRUD for road segments |
| `/api/congestion/heatmap` | GET | Get congestion heatmap data |
| `/api/mobile-reports` | POST | Ingest a finalized native iPhone traffic report |

## iOS Safari Notes

- **HTTPS Required**: iOS Safari silently denies sensor permissions over HTTP
- **User Gesture**: Permission must be triggered by user action (button click)
- **Permission Caching**: Safari caches permission state across reloads
- **Battery Optimization**: Sensors throttled to 10Hz accelerometer, 1Hz GPS

## Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

Set the `DATABASE_URL` environment variable in Vercel project settings.

### Build Command

The build script automatically runs Prisma migrations:

```bash
npm run build
# Runs: prisma generate && prisma migrate deploy && next build
```

## Scripts

```bash
npm run dev              # Development server
npm run build            # Production build
npm run start            # Start production server
npm run lint             # Run ESLint
npm run backfill-roughness  # Recalculate roughness for existing drives
npm run analyze-data     # Run data analysis scripts
```

## Configuration

Key constants in `lib/constants.ts`:

- `ACCELEROMETER_INTERVAL`: 100ms (10 Hz)
- `GPS_INTERVAL`: 1000ms (1 Hz)
- `MAX_HISTORY_LENGTH`: 50 readings
- `DEFAULT_MAP_ZOOM`: 15

## Troubleshooting

**Permission request not showing:**
- Ensure you're on HTTPS
- Check iOS version (must be 13+)
- Clear Safari website data and retry

**Sensor data not recording:**
- Check permission state in UI
- Verify sensors are working in dashboard view first
- Look for errors in browser console

**Map not rendering:**
- Verify `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured and URL-restricted for the deployment
- Check for JavaScript errors in console
- Ensure GPS permissions are granted

## License

MIT
