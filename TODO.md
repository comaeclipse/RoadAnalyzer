# RoadAnalyzer - Implementation TODO

## ✅ Phase 1: Core Recording (COMPLETED)

- [x] Set up Prisma with Neon Postgres
- [x] Create database schema (Drive, AccelerometerSample, GpsSample)
- [x] Create Prisma client singleton with Neon adapter
- [x] Create recording types
- [x] Implement API routes:
  - [x] POST /api/recordings/start
  - [x] POST /api/recordings/stop
  - [x] POST /api/recordings/sensor-data
- [x] Create RecordingProvider with buffer logic
- [x] Create RecordingControls UI component
- [x] Integrate recording controls into dashboard
- [x] Test complete record → save → stop flow

### Phase 1 Features Implemented:
- Client-side buffering (50 accel samples, 10 GPS samples)
- Automatic flush every 10 seconds (~6KB payloads)
- Network error retry with exponential backoff
- navigator.sendBeacon for data safety on page unload
- Recording timer and buffer status display
- Denormalized fields for query performance (magnitude, distance)

---

## 🔄 Phase 2: Retrieval & Display (NEXT)

### API Endpoints
- [ ] GET /api/recordings/list - List all drives with pagination
  - Query parameters: page, limit, sortBy, order
  - Return drive metadata with statistics
- [ ] GET /api/recordings/[driveId] - Get drive metadata
  - Return single drive with full details
- [ ] PATCH /api/recordings/[driveId] - Update drive metadata
  - Allow editing name, description, tags
- [ ] GET /api/recordings/[driveId]/accelerometer - Get accelerometer data
  - Pagination support
  - Time range filtering
- [ ] GET /api/recordings/[driveId]/gps - Get GPS data
  - Pagination support
  - Time range filtering
- [ ] DELETE /api/recordings/[driveId] - Delete a drive
  - Cascade delete all sensor samples

### UI Components
- [ ] Create DriveList component
  - Display drives in a card/table layout
  - Show duration, distance, date, speed stats
  - Search and filter by name/tags/date
  - Sort by date, duration, distance
  - Quick actions (view, delete)
- [ ] Create DriveDetail page (/recordings/[driveId])
  - Show drive metadata (editable)
  - Tab interface for different views
- [ ] Create MapReplay component
  - Display GPS path on interactive map
  - Play/pause route animation
  - Show speed/time at each point
  - Color-code path by speed/acceleration
- [ ] Add navigation to recordings page from dashboard

---

## 📊 Phase 3: Analysis Features

### Charts & Visualization
- [ ] Create AccelerometerChart component
  - Line chart showing x, y, z acceleration over time
  - Magnitude chart for bump detection
  - Identify rough road segments (high magnitude spikes)
- [ ] Create GPSCharts component
  - Speed over time chart
  - Altitude profile chart
  - Heading/direction visualization
- [ ] Create DriveStatistics component
  - Summary cards: total distance, duration, avg speed, max speed
  - Acceleration statistics (max, avg, bump count)
  - Route map with statistics overlay

### Drive Comparison
- [ ] Create DriveComparison page
  - Select multiple drives to compare
  - Side-by-side statistics
  - Overlaid charts
  - Map overlay showing multiple routes

### Search & Filtering
- [ ] Add advanced search functionality
  - Filter by date range
  - Filter by distance/duration
  - Filter by tags
  - Search by name/description
- [ ] Add sorting options
  - By date (newest/oldest)
  - By distance (longest/shortest)
  - By duration (longest/shortest)

---

## 📤 Phase 4: Export & Polish

### Export Functionality
- [ ] Implement GET /api/recordings/[driveId]/export
  - Support JSON format (structured data)
  - Support CSV format (Excel-compatible)
  - Support GPX format (GPS tracking standard)
- [ ] Create ExportButton component
  - Format selection dropdown
  - Progress indicator for large exports
  - Streaming response for large datasets
- [ ] Optimize export for large drives
  - Use streaming API for >10,000 samples
  - Client-side chunking with Web Workers
  - Download progress tracking

### Error Recovery & Resilience
- [ ] Implement IndexedDB fallback
  - Store failed batches locally
  - Auto-sync when connection restored
  - Show sync status in UI
- [ ] Add session recovery
  - Detect interrupted recordings on app restart
  - Prompt user to resume or discard
  - Auto-save recording state to localStorage
- [ ] Improve error messages
  - User-friendly error descriptions
  - Recovery suggestions
  - Network status indicator

### Performance Optimizations
- [ ] Database query optimization
  - Add missing indexes if needed
  - Implement query result caching
  - Use database aggregations for statistics
- [ ] Frontend optimization
  - Implement virtual scrolling for drive list
  - Lazy load chart data
  - Optimize map rendering for large paths
- [ ] API optimization
  - Implement rate limiting
  - Add response compression
  - Consider edge runtime for simple endpoints

### Polish & UX
- [ ] Add loading states
  - Skeleton screens for drive list
  - Loading spinners for data fetching
  - Progress bars for exports
- [ ] Add empty states
  - "No drives yet" message with CTA
  - "No data" states for charts
- [ ] Add confirmation dialogs
  - Confirm before deleting drives
  - Confirm before stopping recording
- [ ] Improve mobile responsiveness
  - Optimize layouts for small screens
  - Touch-friendly controls
  - Mobile-optimized charts
- [ ] Add keyboard shortcuts
  - Start/stop recording
  - Navigate between views
- [ ] Add accessibility improvements
  - ARIA labels
  - Keyboard navigation
  - Screen reader support

---

## 🚀 Future Enhancements (Optional)

### Advanced Analytics
- [ ] Road quality scoring algorithm
  - Analyze accelerometer data for bumps/potholes
  - Generate road quality heatmap
- [ ] Route recommendation
  - Suggest smoothest routes between points
  - Highlight scenic routes
- [ ] Drive insights
  - Identify driving patterns
  - Speed distribution analysis
  - Rough road segments report

### Collaboration Features
- [ ] Add user authentication (NextAuth.js)
  - User accounts and private drives
  - Shared drives with view/edit permissions
- [ ] Public drive sharing
  - Generate shareable links
  - Embed map widget
- [ ] Comments and annotations
  - Add notes to specific points on route
  - Tag locations of interest

### Integration
- [ ] Export to popular mapping services
  - Strava integration
  - Google Maps import
  - Apple Maps integration
- [ ] Webhooks for drive completion
  - Notify external services
  - Trigger automated analysis
- [ ] API for third-party apps
  - RESTful API documentation
  - API key management

### Mobile App
- [ ] PWA improvements
  - Offline functionality
  - Background recording
  - Push notifications
- [ ] Native mobile app (React Native)
  - Better sensor access
  - Background recording
  - Battery optimization

---

## 📝 Current Architecture

### Database Schema
```
Drive (main session table)
├── AccelerometerSample (5 Hz data)
└── GpsSample (1 Hz data)
```

### Data Flow
```
Sensors → Client Buffer → Batch API → Database
   ↓           ↓              ↓          ↓
 5Hz/1Hz   Accumulate     Every 10s  Bulk Insert
```

### API Structure
```
/api/recordings/
├── start/
├── stop/
├── sensor-data/
├── list/
└── [driveId]/
    ├── route.ts (GET, PATCH)
    ├── accelerometer/
    ├── gps/
    └── export/
```

---

## 🎯 Immediate Next Steps

1. **Implement Drive List** (Phase 2)
   - Create GET /api/recordings/list endpoint
   - Build DriveList component
   - Add navigation from dashboard

2. **Create Drive Detail Page** (Phase 2)
   - Implement GET /api/recordings/[driveId] endpoints
   - Build basic detail view with metadata
   - Add map replay functionality

3. **Add Charts** (Phase 3)
   - Implement accelerometer and GPS charts
   - Add interactive features (zoom, pan, tooltips)

4. **Export Feature** (Phase 4)
   - Implement export API endpoint
   - Add export button with format options
   - Test with sample drives

---

## 💾 Storage Estimates

**Per Hour of Driving:**
- Accelerometer: 18,000 samples × 80 bytes = 1.4 MB
- GPS: 3,600 samples × 100 bytes = 0.36 MB
- **Total: ~1.8 MB/hour**

**Monthly Usage (20 drives, 30 min avg):**
- 20 drives × 0.9 MB = **18 MB/month**
- Neon Free Tier: 512 MB storage (enough for ~280 hours of driving)
