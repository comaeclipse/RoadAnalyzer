# RoadAnalyzer - Implementation TODO

## 📊 Project Status Overview

**Overall Progress: ~80% Complete**

| Phase | Status | Completion | Key Achievement |
|-------|--------|------------|-----------------|
| Phase 1: Core Recording | ✅ Complete | 100% | Full recording pipeline with buffering and error recovery |
| Phase 2: Retrieval & Display | ✅ Complete | 95% | All pages built (list, detail, multi-route map) |
| Phase 3: Analysis Features | ✅ Mostly Complete | 85% | Road quality algorithm fully implemented |
| Phase 4: Export & Polish | 🔄 In Progress | 30% | Basic polish done, export not yet implemented |

### What's Working Now:
- ✅ Record drives with accelerometer and GPS data
- ✅ View all recordings with statistics and quality scores
- ✅ Detailed drive analysis with roughness breakdown
- ✅ Interactive maps with color-coded road quality
- ✅ Multi-route overlay map with selection UI
- ✅ Road quality scoring algorithm (0-100 scale)
- ✅ Delete recordings with confirmation
- ✅ Mobile-responsive design

### What's Missing:
- ❌ Export functionality (JSON/CSV/GPX)
- ❌ Drive comparison feature
- ❌ Search and filter UI
- ❌ Edit drive metadata UI
- ❌ Advanced accessibility features

---

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

## ✅ Phase 2: Retrieval & Display (COMPLETED)

### API Endpoints
- [x] GET /api/recordings - List all drives (50 max) with full metadata
  - Returns drive metadata with statistics and roughness scores
  - Supports sorting by various fields
- [x] GET /api/recordings/[driveId] - Get drive metadata
  - Returns single drive with all GPS and accelerometer data
- [x] GET /api/recordings/all-routes - Get all completed drives with GPS paths
  - Special endpoint for map overlay visualization
- [ ] PATCH /api/recordings/[driveId] - Update drive metadata
  - Backend endpoint exists but not yet wired to UI
  - Allow editing name, description, tags
- [x] DELETE /api/recordings/[driveId] - Delete a drive
  - Cascade delete all sensor samples
  - Confirmation dialog in UI

### UI Pages & Components
- [x] Create RecordingsList page (/recordings)
  - Card layout displaying all drives
  - Summary statistics: total recordings, distance, time, samples
  - Each card shows: name, date, duration, distance, max speed, sample count
  - Road quality badge with color-coded roughness score (0-100)
  - Status badges (COMPLETED, RECORDING, FAILED)
  - Click to navigate to detail page
- [x] Create RecordingDetail page (/recordings/[driveId])
  - Full drive metadata display
  - Road Quality Score card with breakdown percentages (smooth/light/moderate/rough/veryRough)
  - Statistics grid: duration, distance, max speed, sample count
  - RouteMap component showing GPS path colored by roughness
  - SensorTimeline component with roughness over time chart
  - Delete button with confirmation dialog
  - Navigation breadcrumbs
- [x] Create RouteMap component
  - Display GPS path on interactive Leaflet map
  - Color-code path segments by roughness (green=smooth, red=rough)
  - Start/end markers with speed info in popups
  - Road quality legend showing classification scale
  - Auto-fit bounds to route
- [x] Create AllRoutesMap page (/map)
  - Shows all completed routes overlaid on OpenStreetMap
  - Routes color-coded by road quality score
  - Colorful route palette (8 colors) for routes without roughness data
  - Click routes to select/highlight
  - Selected route shows in charcoal with thicker line
  - Sidebar with road quality legend and scrollable route list
  - Total distance and recording count in header
- [x] Add navigation to recordings pages from dashboard

### Phase 2 Features Implemented:
- Full drive listing with statistics
- Individual drive detail views
- Interactive map visualization with roughness-based coloring
- Multi-route overlay map with selection UI
- Delete functionality with confirmation
- Road quality legend and breakdown visualization

---

## ✅ Phase 3: Analysis Features (85% COMPLETED)

### Road Quality Analysis Algorithm (FULLY IMPLEMENTED)
- [x] Implement roughness analysis engine (lib/roughness.ts)
  - Rolling standard deviation of Z-axis acceleration (15-sample window)
  - 5-category classification: Smooth (<0.5), Light (0.5-1.5), Moderate (1.5-3.0), Rough (3.0-5.0), Very Rough (>5.0)
  - Weighted 0-100 scoring system (100 = smoothest road)
  - Breakdown percentages for each category
  - Automatic calculation on recording stop
  - Haversine distance calculation for GPS accuracy
- [x] Store roughness data in database
  - roughnessScore field (0-100) on Drive table
  - roughnessBreakdown JSON field with category percentages
- [x] Display road quality scores
  - Color-coded badges on recordings list (green/lime/yellow/orange/red)
  - Detailed breakdown cards on detail page
  - Visual percentage indicators for each category

### Charts & Visualization
- [x] Create SensorTimeline component
  - Area chart showing roughness over time
  - Average roughness reference line
  - Peak value indicator
  - Time-based X-axis with minute:second formatting
  - Tooltip with roughness classification labels
  - Summary statistics card
- [x] Create ChartDisplay component (real-time during recording)
  - Accelerometer: X, Y, Z line chart with color differentiation
  - GPS: Speed and altitude dual-line chart
  - Null value handling for GPS data
  - Responsive 300px height container
- [x] Create DriveStatistics display
  - Summary cards: distance (miles), duration, max speed, avg speed, sample count
  - Road quality score with visual breakdown
  - Integrated into detail page layout
  - Total statistics on recordings list page

### Map Visualization
- [x] Single route map with roughness-colored segments
  - Green for smooth sections, red for rough sections
  - Start/end markers with speed information
  - Road quality legend
- [x] Multi-route overlay map (/map page)
  - All routes displayed simultaneously
  - Color-coded by overall road quality score
  - Selection UI with visual highlighting
  - Auto-fit bounds calculation

### Drive Comparison (NOT YET IMPLEMENTED)
- [ ] Create DriveComparison page
  - Select multiple drives to compare
  - Side-by-side statistics
  - Overlaid charts
  - Map overlay showing multiple routes with different colors

### Search & Filtering (PARTIALLY IMPLEMENTED)
- [ ] Add advanced search UI
  - Filter by date range
  - Filter by distance/duration range
  - Filter by tags
  - Search by name/description
  - Note: API supports filtering but UI not yet built
- [ ] Add sorting UI
  - By date (newest/oldest)
  - By distance (longest/shortest)
  - By duration (longest/shortest)
  - Note: API supports sorting but UI controls not yet built

---

## 🔄 Phase 4: Export & Polish (30% COMPLETED)

### Export Functionality (NOT YET IMPLEMENTED)
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

### Error Recovery & Resilience (PARTIALLY IMPLEMENTED)
- [ ] Implement IndexedDB fallback
  - Store failed batches locally
  - Auto-sync when connection restored
  - Show sync status in UI
- [x] Add session recovery (backend only)
  - Detects interrupted recordings on app restart via localStorage
  - Auto-recovery mechanism in place
  - [ ] Add UI prompt to resume or discard orphaned recordings
- [x] Improve error messages
  - User-friendly error cards with red styling
  - Error display in recordings list and detail pages
  - Network error retry with exponential backoff in recording flow

### Performance Optimizations (PARTIALLY IMPLEMENTED)
- [x] Database query optimization
  - Indexes on (driveId, timestamp) for time-range queries
  - Indexes on createdAt (desc) for listing
  - Indexes on status for filtering
  - Cascade delete configured
  - Denormalized magnitude and distance fields for query performance
- [ ] Frontend optimization
  - [ ] Implement virtual scrolling for drive list (currently limited to 50 max)
  - [ ] Lazy load chart data
  - [ ] Optimize map rendering for large paths
- [ ] API optimization
  - [ ] Implement rate limiting
  - [ ] Add response compression
  - [ ] Consider edge runtime for simple endpoints

### Polish & UX (PARTIALLY IMPLEMENTED)
- [x] Add loading states
  - Loading spinners in various components
  - [ ] Skeleton screens for drive list
  - [ ] Progress bars for exports
- [x] Add empty states
  - "No recordings yet" message with CTA on recordings list
  - "No recordings to display" on map page
  - Empty state handling in components
- [x] Add confirmation dialogs
  - Confirm before deleting drives (with Cancel/Delete buttons)
  - [ ] Confirm before stopping recording
- [x] Improve mobile responsiveness
  - Grid layouts that adapt to screen size
  - Responsive map components
  - Mobile-friendly card layouts
  - Touch-friendly buttons and controls
- [ ] Add keyboard shortcuts
  - Start/stop recording (Space bar, etc.)
  - Navigate between views (arrow keys, etc.)
- [ ] Add accessibility improvements
  - [x] Semantic HTML structure
  - [x] Button elements with proper labels
  - [ ] Comprehensive ARIA labels
  - [ ] Full keyboard navigation support
  - [ ] Screen reader optimization and testing

---

## 🚀 Future Enhancements

### Advanced Analytics

#### COMPLETED:
- [x] Road quality scoring algorithm
  - Analyzes accelerometer data for bumps/potholes using rolling std dev
  - 5-category classification system (Smooth to Very Rough)
  - 0-100 scoring system for overall route quality
  - Visual breakdown percentages displayed on detail page
  - Color-coded segment display on map
  - Road quality legend with 5 quality levels

#### TODO:
- [ ] Route recommendation
  - Suggest smoothest routes between points based on historical roughness data
  - Highlight scenic routes
  - Compare alternative routes by quality score
- [ ] Enhanced drive insights
  - Identify driving patterns (acceleration/braking habits)
  - Speed distribution analysis and histograms
  - Rough road segments report with GPS coordinates for pothole reporting
  - Export rough segments for municipal reporting

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

The application is now fully functional for core use cases (recording drives, viewing drives, analyzing road quality). Here are the recommended next priorities:

### High Priority (Core Features)
1. **Implement Export API** (Phase 4)
   - Create GET /api/recordings/[driveId]/export endpoint
   - Support JSON, CSV, and GPX formats
   - Add ExportButton component with format selection
   - Implement streaming for large datasets (>10k samples)

2. **Wire up PATCH endpoint UI** (Phase 2)
   - Add edit mode to RecordingDetail page
   - Allow users to edit drive name, description, and tags
   - Save button with optimistic UI updates

3. **Add Drive Comparison** (Phase 3)
   - Create /recordings/compare page
   - Multi-select UI on recordings list
   - Side-by-side statistics comparison
   - Overlaid charts for multiple drives
   - Map showing multiple routes with different colors

### Medium Priority (Polish)
4. **Advanced Search & Filter UI** (Phase 3)
   - Search bar on recordings list page
   - Filter panel with date range picker
   - Distance/duration range sliders
   - Tag filter chips
   - Sort dropdown (date/distance/duration/quality)

5. **Session Recovery UI** (Phase 4)
   - Modal dialog on app startup for orphaned recordings
   - "Resume Recording" vs "Discard" buttons
   - Show duration and sample count of interrupted recording

6. **Performance Optimizations** (Phase 4)
   - Virtual scrolling for drive list (when >50 recordings)
   - Lazy loading for map routes
   - Response compression on API
   - Query result caching

### Low Priority (Nice to Have)
7. **Keyboard Shortcuts** (Phase 4)
   - Space bar to start/stop recording
   - Arrow keys to navigate between drives
   - Escape to close modals
   - / to focus search bar

8. **Accessibility Improvements** (Phase 4)
   - Comprehensive ARIA labels
   - Full keyboard navigation testing
   - Screen reader optimization
   - Focus management for modals

9. **IndexedDB Fallback** (Phase 4)
   - Store failed batches locally during network outages
   - Auto-sync when connection restored
   - Sync status indicator in UI

---

## ⭐ Features Implemented Beyond Original Scope

These features were not in the original TODO but have been successfully implemented:

### 1. Road Quality Legend System
- Comprehensive 5-tier quality legend (Excellent/Good/Fair/Poor/Very Poor)
- Color-coded 90-100/75-89/50-74/25-49/0-24 scoring brackets
- Displayed on both individual route maps and multi-route overlay map
- Visual percentage breakdown on detail pages

### 2. Multi-Route Overlay Map (/map page)
- Shows all completed drives simultaneously on one map
- Routes color-coded by overall quality score OR colorful palette
- 8-color palette system for routes without roughness analysis
- Interactive selection with visual highlighting (charcoal + thick line)
- Fade unselected routes to 40% opacity
- Auto-fit bounds to all visible routes
- Sidebar with scrollable route list showing name, date, distance, quality
- Total statistics in header (count + cumulative distance)

### 3. Light Greyscale Map Styling
- CartoDB light_all basemap for professional appearance
- Allows road quality colors to stand out prominently
- Better than default bright colors for data visualization

### 4. Route Palette System
- 8 vibrant colors: indigo, rose, emerald, amber, purple, cyan, pink, lime
- Automatic cycling based on route index
- Fallback for routes recorded before roughness feature was added
- Ensures visual distinction between overlapping routes

### 5. Enhanced Drive Metadata
- Optional name, description, tags fields in database
- Auto-generated names if not provided ("Drive on [date]")
- Backend PATCH endpoint for editing (UI not yet connected)
- Supports future tagging and categorization features

### 6. Session Recovery System
- localStorage tracking of active recording ID
- Automatic detection of orphaned recordings on app restart
- Backend cleanup of interrupted recordings
- Foundation for future UI prompt feature

### 7. Roughness Breakdown Visualization
- Visual percentage cards for each category (Smooth/Light/Moderate/Rough/Very Rough)
- Color-coded circular indicators matching quality scale
- Percentage display with 1 decimal precision
- Integrated prominently on detail page above statistics

### 8. Database Enhancements
- roughnessScore field (0-100 float) on Drive table
- roughnessBreakdown JSON field storing category percentages
- Denormalized magnitude field on AccelerometerSample for faster queries
- Denormalized distanceFromPrev field on GpsSample using Haversine formula
- Comprehensive indexes for optimal query performance

### 9. Responsive Mobile Design
- Touch-friendly button sizes and spacing
- Responsive grid layouts (1-3 columns based on screen width)
- Mobile-optimized map controls
- Cards that stack vertically on small screens
- Readable font sizes and adequate spacing

### 10. Status Badge System
- COMPLETED badge (green) for finished recordings
- RECORDING badge (blue) for active sessions
- FAILED badge (red) for interrupted recordings
- Quality score badges with color coding on list view
- Consistent badge styling across all pages

---

## 💾 Storage Estimates

**Per Hour of Driving:**
- Accelerometer: 18,000 samples × 80 bytes = 1.4 MB
- GPS: 3,600 samples × 100 bytes = 0.36 MB
- **Total: ~1.8 MB/hour**

**Monthly Usage (20 drives, 30 min avg):**
- 20 drives × 0.9 MB = **18 MB/month**
- Neon Free Tier: 512 MB storage (enough for ~280 hours of driving)
