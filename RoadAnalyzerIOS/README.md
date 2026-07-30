# RoadAnalyzer iOS

Native iPhone traffic recorder. Open `RoadAnalyzer.xcodeproj` in Xcode 15+ and set a unique Development Team and bundle identifier.

Before installing, replace `RoadAnalyzerAPIBaseURL` in `RoadAnalyzer/Info.plist` with the HTTPS URL of the deployed Next.js dashboard (without `/api/mobile-reports`). The app persists active and pending sessions in Application Support, records background GPS only while a manually started drive is active, and retries finalized uploads on Wi-Fi or cellular.

The ingest endpoint is intentionally unauthenticated for this personal-sideload prototype. Do not publish this build or URL without adding writer authentication and rate limiting.
