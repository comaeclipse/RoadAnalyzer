import Foundation
import CoreLocation
import CoreMotion
import Network
import UIKit

/// A stop waiting for the driver's answer. Carries its own deadline so the
/// countdown cannot drift as the view re-renders, and a stable id so SwiftUI
/// can animate one prompt out and the next in.
struct StopPrompt: Identifiable, Equatable {
    let stopEventId: UUID
    let shownAt: Date
    let deadline: Date
    /// What this approach was tagged last time, if it has been seen before.
    let suggestedTag: StopTag?

    var id: UUID { stopEventId }
}

/// The slice of an in-flight drive the UI actually renders, published in place
/// of the session itself. Publishing the session meant every appended sample
/// invalidated every view that read it, and reading a count off a published
/// struct forced a copy-on-write of arrays holding tens of thousands of
/// samples. This is small, `Equatable`, and changes only when something on
/// screen does.
struct LiveStats: Equatable {
    let id: UUID
    let startedAt: Date
    let isPaused: Bool
    let locationCount: Int
    /// Metres, excluding paused spans. Accumulated as samples arrive: walking
    /// the whole trace once a second was O(n) in sorts and CLLocation
    /// allocations for a number that changes by a few metres.
    let distance: Double
    /// Stops the driver was actually asked about; suppressed cluster stops are
    /// excluded, matching the prompt.
    let promptedStops: Int
    let taggedStops: Int
    let pauses: [PausedInterval]

    func pausedDuration(asOf now: Date) -> TimeInterval {
        pauses.reduce(0) { $0 + $1.duration(asOf: now) }
    }
}

/// Motion arrives at 10 Hz. Delivering it straight to the main queue cost ten
/// main-actor hops and ten session mutations a second; it is buffered off-thread
/// here and drained once a second by the tick instead.
private final class MotionBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [MotionSample] = []

    func append(_ sample: MotionSample) {
        lock.lock()
        samples.append(sample)
        lock.unlock()
    }

    func drain() -> [MotionSample] {
        lock.lock()
        defer { lock.unlock() }
        let drained = samples
        samples.removeAll(keepingCapacity: true)
        return drained
    }
}

@MainActor
final class RecordingStore: NSObject, ObservableObject {
    /// How long the prompt stays up before it gives up and hands the stop to
    /// the post-trip review.
    static let promptTimeout: TimeInterval = 20
    /// A pause still open after this long was abandoned, not deliberate.
    static let abandonedPauseAge: TimeInterval = 6 * 3600
    /// A review left unfinished this long must not keep blocking uploads.
    static let staleReviewAge: TimeInterval = 24 * 3600

    @Published private(set) var live: LiveStats?
    /// Route geometry for the map, maintained incrementally. Rebuilding it from
    /// the whole trace on every publish was the single most expensive thing the
    /// app did.
    @Published private(set) var routeSpans: [[CLLocationCoordinate2D]] = []
    @Published private(set) var locationStatus: CLAuthorizationStatus = .notDetermined
    @Published private(set) var networkType = "offline"
    @Published private(set) var statusMessage = "Ready to record"
    @Published private(set) var pendingUploads = 0
    @Published private(set) var rejectedUploads = 0
    @Published private(set) var activePrompt: StopPrompt?
    /// A finished drive held back from upload until its stops are tagged.
    @Published private(set) var reviewSession: RecordingSession?

    /// Derived, never stored: the open interval on disk *is* the paused state,
    /// so a restored session cannot disagree with a separate flag.
    var isPaused: Bool { live?.isPaused ?? false }

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let pathMonitor = NWPathMonitor()
    private let persistenceURL: URL
    private let anchors = AnchorStore()
    /// Read once here so the upload path never has to touch UIDevice, and can
    /// therefore build the whole report off the main actor.
    private let deviceInfo = MobileReport.Device.current
    private var detector = StopDetector()
    /// The authoritative in-flight drive. Deliberately *not* `@Published`: the
    /// arrays inside it are appended to thousands of times per drive, and going
    /// through a published property would copy them on every append.
    private var active: RecordingSession?
    private var pending: [RecordingSession] = []
    private var isUploading = false
    private var uploadPassRequested = false
    private var tickTask: Task<Void, Never>?
    private var promptDismissTask: Task<Void, Never>?

    private let motionBuffer = MotionBuffer()
    private let motionQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "RoadAnalyzer.motion"
        queue.maxConcurrentOperationCount = 1
        return queue
    }()
    /// Encoding the whole session and writing it out is hundreds of milliseconds
    /// late in a long drive, and it used to happen on the main actor. Serial, so
    /// writes still land in the order they were requested.
    private let persistQueue = DispatchQueue(label: "RoadAnalyzer.persist", qos: .utility)
    /// Its own encoder rather than the shared `JSONEncoder.roadAnalyzer`:
    /// UploadClient encodes on its own thread, and JSONEncoder is not safe to
    /// use from two at once. Touched only on `persistQueue`.
    private let persistEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    /// Map polylines under construction. `routeSpans` is published from this;
    /// appending happens here so the published copy is never mutated in place.
    private var spanBuffer: [[CLLocationCoordinate2D]] = []
    private var lastRouteSample: LocationSample?
    /// Set after a pause or a restore, so the next sample opens a new span
    /// rather than drawing a line across wherever the driver went with GPS off.
    private var routeBreakPending = true
    private var travelledDistance: Double = 0

    override init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        persistenceURL = directory.appending(path: "traffic-sessions.json")
        super.init()
        UIDevice.current.isBatteryMonitoringEnabled = true
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.activityType = .automotiveNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationStatus = locationManager.authorizationStatus
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.networkType = path.status == .satisfied ? (path.usesInterfaceType(.wifi) ? "wifi" : "cellular") : "offline"
                if path.status == .satisfied { await self?.retryUploads() }
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "RoadAnalyzer.network"))
    }

    deinit { pathMonitor.cancel() }

    func requestPermissions() {
        if locationManager.authorizationStatus == .notDetermined { locationManager.requestWhenInUseAuthorization() }
        else { locationManager.requestAlwaysAuthorization() }
    }

    func start() {
        guard locationStatus == .authorizedAlways || locationStatus == .authorizedWhenInUse else { requestPermissions(); return }
        // An unfinished review must never gate the ability to record; queue it
        // as-is and get out of the way.
        if reviewSession != nil { finishReview() }
        active = RecordingSession(batteryLevel: UIDevice.current.batteryLevel >= 0 ? UIDevice.current.batteryLevel : nil, networkType: networkType)
        statusMessage = "Recording traffic drive"
        detector.resetForNewSession()
        resetRoute()
        startSensors()
        publishLive()
        persist()
    }

    /// Take the car out of the dataset without ending the drive. GPS and motion
    /// are stopped outright rather than merely flagged, which is the whole point
    /// -- pulling over for twenty minutes should not cost battery.
    func pause() {
        guard active?.isPaused == false else { return }
        stopSensors()
        // With no active location updates the `location` background mode stops
        // keeping the process alive, so iOS may suspend the app. Significant-
        // change monitoring costs almost nothing, needs no extra entitlement,
        // and relaunches us if the driver forgets and drives off.
        locationManager.startMonitoringSignificantLocationChanges()
        clearPrompt(markingDismissed: true)
        detector.reset()
        active?.appendPause(PausedInterval(id: UUID(), startedAt: .now, endedAt: nil, endedBy: nil))
        routeBreakPending = true
        statusMessage = "Paused — GPS off. Reopen the app to resume."
        publishLive()
        persist()
    }

    func resume() {
        guard active?.isPaused == true else { return }
        active?.closeOpenPause(at: .now, endedBy: .user)
        locationManager.stopMonitoringSignificantLocationChanges()
        startSensors()
        // The detector must see real motion again before it may arm. Without
        // this, resuming on the shoulder fires a phantom stop the moment GPS
        // returns at 0 m/s -- while the driver is merging back into traffic.
        detector.reset()
        statusMessage = "Recording traffic drive"
        publishLive()
        persist()
    }

    func stop() {
        guard active != nil else { return }
        stopSensors()
        locationManager.stopMonitoringSignificantLocationChanges()
        clearPrompt(markingDismissed: false)
        // Read after stopSensors(), which drains the last of the buffered motion
        // into the session.
        guard var completed = active else { return }

        let now = Date.now
        if completed.isPaused { completed.closeOpenPause(at: now, endedBy: .stoppedWhilePaused) }
        // The last stop of a drive is nearly always "arrived at destination".
        // Surfacing it for review every single time is pure noise.
        if let open = completed.openStop {
            completed.updateStop(id: open.id) { stop in
                stop.endedAt = now
                if stop.tag == nil {
                    stop.tag = .skipped
                    stop.taggedAt = now
                    stop.taggedDuring = .review
                }
            }
        }
        completed.endedAt = now
        active = nil
        detector.resetForNewSession()
        resetRoute()
        publishLive()

        // Uploading before the driver has tagged anything would strand every
        // label on the phone, so a drive with open questions waits.
        if completed.untaggedStops.isEmpty {
            enqueue(completed)
        } else {
            reviewSession = completed
            let count = completed.untaggedStops.count
            statusMessage = "Drive saved; \(count) stop\(count == 1 ? "" : "s") to review"
            persist()
        }
    }

    func restoreAndRetry() async {
        load()

        if let review = reviewSession {
            // A forgotten review must not hold a drive hostage forever.
            let ended = review.endedAt ?? review.startedAt
            if Date.now.timeIntervalSince(ended) > Self.staleReviewAge {
                finishReview()
            } else {
                statusMessage = "Drive waiting on \(review.untaggedStops.count) stop tags"
            }
        }

        if let current = active {
            if let open = current.openPause {
                if Date.now.timeIntervalSince(open.startedAt) > Self.abandonedPauseAge {
                    var recovered = current
                    // Close at the last real fix, not now: otherwise the drive's
                    // duration swallows however many hours the app was gone.
                    let lastFix = recovered.locations.last?.timestamp ?? open.startedAt
                    recovered.closeOpenPause(at: lastFix, endedBy: .recovered)
                    recovered.endedAt = lastFix
                    active = nil
                    resetRoute()
                    if recovered.untaggedStops.isEmpty {
                        enqueue(recovered)
                    } else {
                        reviewSession = recovered
                        persist()
                    }
                    statusMessage = "Abandoned paused drive recovered"
                } else {
                    statusMessage = "Recording paused — resume to continue"
                }
            } else {
                // Previously this restored the session and said so without ever
                // restarting location updates, so a recovered drive claimed to
                // be recording and silently recorded nothing.
                detector.reset()
                startSensors()
                statusMessage = "Recovered interrupted recording"
            }
        }

        publishLive()
        await retryUploads()
    }

    // MARK: - Sensors

    private func startSensors() {
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
        startMotionUpdates()
        startTick()
    }

    private func stopSensors() {
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
        motionManager.stopDeviceMotionUpdates()
        // Whatever the buffer is still holding belongs to this drive, and the
        // tick that would have drained it is about to be cancelled.
        drainMotion()
        tickTask?.cancel()
        tickTask = nil
    }

    /// Called once a second. Drains the motion buffer, and ticks the detector:
    /// CoreLocation slows delivery while stationary, and fixes worse than 50 m
    /// are dropped before they reach the detector, so a candidate can reach its
    /// minimum duration with no new sample at all. A Task loop rather than a
    /// Timer: cancellable, main-actor by construction, no run-loop retain cycle.
    private func startTick() {
        tickTask?.cancel()
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled, let self else { return }
                self.drainMotion()
                self.handle(self.detector.tick(now: .now))
            }
        }
    }

    private func startMotionUpdates() {
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 0.1
        // Delivered to a background queue and buffered, not to `.main`: at 10 Hz
        // the main-actor hop alone was a measurable share of the frame budget.
        motionManager.startDeviceMotionUpdates(to: motionQueue) { [buffer = motionBuffer] motion, _ in
            guard let motion else { return }
            buffer.append(MotionSample(timestamp: .now, x: motion.userAcceleration.x, y: motion.userAcceleration.y, z: motion.userAcceleration.z))
        }
    }

    /// Move a second of buffered motion into the session. Nothing on screen
    /// shows motion, so this deliberately does not publish or persist.
    private func drainMotion() {
        let batch = motionBuffer.drain()
        guard !batch.isEmpty, active != nil else { return }
        active?.motionSamples.append(contentsOf: batch)
    }

    private func handleAuthorizationChange(_ status: CLAuthorizationStatus) {
        locationStatus = status
        if status == .authorizedWhenInUse { locationManager.requestAlwaysAuthorization() }
    }

    private func append(_ samples: [LocationSample]) {
        guard active != nil else { return }
        // Appended straight into the stored session: `var copy = active` first
        // would keep a second reference alive across the append and copy the
        // whole array every time.
        active?.locations.append(contentsOf: samples)
        let count = active?.locations.count ?? 0

        // A pause stops location updates, but a fix already in flight can still
        // land here; it must not feed the detector or the route.
        if !isPaused {
            for sample in samples {
                extendRoute(with: sample)
                handle(detector.ingest(sample))
            }
            publishRoute()
        }
        publishLive()
        if count.isMultiple(of: 10) { persist() }
    }

    // MARK: - Derived state

    private func publishLive() {
        guard let active else {
            live = nil
            return
        }
        // The stop arrays hold dozens of entries, not thousands, so counting
        // them per publish is free.
        let prompted = active.stops.filter { $0.suppressed != true }
        live = LiveStats(
            id: active.id,
            startedAt: active.startedAt,
            isPaused: active.isPaused,
            locationCount: active.locations.count,
            distance: travelledDistance,
            promptedStops: prompted.count,
            taggedStops: prompted.filter { $0.tag != nil }.count,
            pauses: active.pauses
        )
    }

    /// Single-point spans are dropped at publish rather than at append, so the
    /// span still under construction stays addressable in `spanBuffer`.
    private func publishRoute() {
        routeSpans = spanBuffer.filter { $0.count > 1 }
    }

    private func extendRoute(with sample: LocationSample) {
        // Delegate callbacks reach the main actor through independent Tasks, so
        // a late fix can arrive after a newer one; distance must not run
        // backwards over it.
        if let previous = lastRouteSample, sample.timestamp <= previous.timestamp { return }
        if routeBreakPending || spanBuffer.isEmpty {
            spanBuffer.append([sample.coordinate])
            routeBreakPending = false
        } else {
            spanBuffer[spanBuffer.count - 1].append(sample.coordinate)
            if let previous = lastRouteSample {
                travelledDistance += TrafficAnalyzer.distance(previous.latitude, previous.longitude, sample.latitude, sample.longitude)
            }
        }
        lastRouteSample = sample
    }

    private func resetRoute() {
        spanBuffer = []
        lastRouteSample = nil
        routeBreakPending = true
        travelledDistance = 0
        routeSpans = []
    }

    /// The one place the whole trace is walked: restoring a drive from disk,
    /// once, rather than once per sample.
    private func rebuildRoute(from session: RecordingSession) {
        spanBuffer = TrafficAnalyzer.spans(of: session.locations, excluding: session.pauses).map { $0.map(\.coordinate) }
        travelledDistance = TrafficAnalyzer.totalDistance(session.locations, excluding: session.pauses)
        lastRouteSample = session.locations.max { $0.timestamp < $1.timestamp }
        // A restored drive resumes into a fresh span: whatever happened while
        // the app was gone is not a straight line worth drawing.
        routeBreakPending = true
        publishRoute()
    }

    // MARK: - Stop detection

    private func handle(_ effect: StopDetector.Effect) {
        switch effect {
        case .none:
            return

        case .armed:
            // Warm the Taptic engine now so the buzz lands with the prompt
            // rather than a beat behind it.
            Haptics.prepare()

        case .confirmed(let event):
            guard active != nil else { return }
            active?.appendStop(event)
            publishLive()
            // A confirmed stop persists immediately rather than waiting for the
            // every-tenth-sample rule: this is the part that cannot be recomputed.
            persist()
            if event.suppressed != true { presentPrompt(for: event) }

        case .departed(let stopId, let endedAt, let minimumSpeed):
            guard active != nil else { return }
            active?.updateStop(id: stopId) { stop in
                stop.endedAt = endedAt
                stop.minimumSpeed = min(stop.minimumSpeed, minimumSpeed)
            }
            persist()
        }
    }

    private func presentPrompt(for event: StopEvent) {
        let now = Date.now
        let suggestion = anchors
            .match(latitude: event.latitude, longitude: event.longitude, heading: event.heading, accuracy: event.accuracy)?
            .dominantTag
        activePrompt = StopPrompt(
            stopEventId: event.id,
            shownAt: now,
            deadline: now.addingTimeInterval(Self.promptTimeout),
            suggestedTag: suggestion
        )
        active?.updateStop(id: event.id) { $0.promptShownAt = now }
        Haptics.stopDetected()

        promptDismissTask?.cancel()
        promptDismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.promptTimeout * 1_000_000_000))
            guard !Task.isCancelled, let self, self.activePrompt?.stopEventId == event.id else { return }
            self.clearPrompt(markingDismissed: true)
            self.persist()
        }
    }

    /// Drop a prompt that outlived its deadline while the app was backgrounded.
    /// Without this, reopening the app forty minutes later shows a prompt for a
    /// stop the driver no longer remembers -- and they will guess.
    func expireStalePrompt() {
        guard let prompt = activePrompt, prompt.deadline < .now else { return }
        clearPrompt(markingDismissed: true)
        persist()
    }

    func tagActivePrompt(_ tag: StopTag) {
        guard let prompt = activePrompt else { return }
        applyTag(tag, to: prompt.stopEventId, during: .live)
        clearPrompt(markingDismissed: false)
        Haptics.tagConfirmed()
        persist()
    }

    func dismissActivePrompt() {
        clearPrompt(markingDismissed: true)
        persist()
    }

    /// Tag a stop from the post-trip review screen.
    func tagStop(id: UUID, tag: StopTag) {
        applyTag(tag, to: id, during: .review)
        // Every tap persists: a crash halfway through a review must not cost
        // the driver ten answers.
        persist()
    }

    private func applyTag(_ tag: StopTag, to id: UUID, during source: StopTagSource) {
        let now = Date.now
        // The stop lives on the active session while driving and on the review
        // session afterwards; the same call has to reach both.
        let mutate: (inout RecordingSession) -> Void = { [anchors] session in
            guard let existing = session.stops.first(where: { $0.id == id }) else { return }
            let anchorId = anchors.resolve(for: existing, tag: tag)
            session.updateStop(id: id) { stop in
                stop.tag = tag
                stop.taggedAt = now
                stop.taggedDuring = source
                stop.anchorId = anchorId
            }
        }
        if active?.stops.contains(where: { $0.id == id }) == true {
            mutate(&active!)
            publishLive()
        } else if var review = reviewSession {
            mutate(&review)
            reviewSession = review
        }
    }

    private func clearPrompt(markingDismissed: Bool) {
        promptDismissTask?.cancel()
        promptDismissTask = nil
        guard let prompt = activePrompt else { return }
        // A dismissal is not an answer. The stop stays untagged and surfaces in
        // review; never infer a tag from silence.
        if markingDismissed {
            active?.updateStop(id: prompt.stopEventId) { $0.autoDismissed = true }
        }
        activePrompt = nil
    }

    // MARK: - Review

    /// Queue the reviewed drive for upload, whatever state its tags are in.
    func finishReview() {
        guard let review = reviewSession else { return }
        reviewSession = nil
        enqueue(review)
    }

    /// Mark everything still unanswered as not-a-stop and queue the drive.
    func skipRemainingReview() {
        guard var review = reviewSession else { return }
        let now = Date.now
        for stop in review.untaggedStops {
            review.updateStop(id: stop.id) { entry in
                entry.tag = .skipped
                entry.taggedAt = now
                entry.taggedDuring = .review
            }
        }
        reviewSession = review
        finishReview()
    }

    private func enqueue(_ completed: RecordingSession) {
        pending.append(completed)
        statusMessage = "Drive saved; upload queued"
        persist()
        Task { await retryUploads() }
    }

    /// Upload everything queued right now, ignoring backoff. Bound to the queue
    /// indicator so a session parked in the one-hour backoff can be freed by hand.
    func retryNow() {
        if reviewSession != nil {
            statusMessage = "Finish reviewing stops to queue this drive"
            return
        }
        statusMessage = pending.isEmpty ? "Nothing queued to upload" : "Retrying queued uploads"
        Task { await retryUploads(force: true) }
    }

    private func retryUploads(force: Bool = false) async {
        // A pending session is only removed once its upload finishes, so a second
        // call arriving mid-flight (a Wi-Fi to cellular switch fires the path
        // handler) would post the same report twice. The flag is read and set
        // without an await in between, so the main actor makes this check atomic.
        // A call that loses the race asks for another pass rather than dropping
        // its work, so a session queued by stop() is never left sitting.
        guard networkType != "offline" else { return }
        if isUploading { uploadPassRequested = true; return }
        isUploading = true
        defer { isUploading = false }

        repeat {
            uploadPassRequested = false
            for index in pending.indices.reversed() where pending[index].failedPermanently != true {
                if !force, let next = pending[index].nextUploadAt, next > .now { continue }
                do {
                    try await UploadClient.shared.upload(session: pending[index], authorization: locationStatus, device: deviceInfo)
                    pending.remove(at: index)
                    statusMessage = "Traffic report uploaded"
                } catch UploadError.rejected(let status) {
                    // Resending an unchanged payload the server refused cannot
                    // succeed, so stop and keep it on disk for inspection.
                    pending[index].failedPermanently = true
                    statusMessage = "Report rejected (HTTP \(status)) and will not retry"
                } catch {
                    pending[index].uploadAttempts += 1
                    let delay = min(pow(2, Double(pending[index].uploadAttempts)) * 30, 3600)
                    pending[index].nextUploadAt = Date.now.addingTimeInterval(delay)
                    statusMessage = "Upload queued for retry"
                }
                persist()
            }
        } while uploadPassRequested
    }

    /// Snapshot on the main actor, encode and write on a background queue.
    /// Encoding an hour-long drive is tens of megabytes of JSON; doing it inline
    /// was a multi-hundred-millisecond main-thread hang every few seconds.
    /// Taking the snapshot is cheap -- the arrays are only retained, not copied,
    /// and the session is never mutated in place afterwards.
    private func persist() {
        refreshCounts()
        let snapshot = SavedSessions(active: active, pending: pending, review: reviewSession)
        let url = persistenceURL
        persistQueue.async { [encoder = persistEncoder] in
            guard let data = try? encoder.encode(snapshot) else { return }
            try? data.write(to: url, options: .atomic)
        }
    }

    private func refreshCounts() {
        rejectedUploads = pending.filter { $0.failedPermanently == true }.count
        // A drive parked in review has not uploaded, and retryUploads only walks
        // `pending`. Counting it keeps the badge from reading zero for a drive
        // still sitting on the phone.
        pendingUploads = pending.count - rejectedUploads + (reviewSession == nil ? 0 : 1)
    }

    private func load() {
        guard let data = try? Data(contentsOf: persistenceURL), let saved = try? JSONDecoder.roadAnalyzer.decode(SavedSessions.self, from: data) else { return }
        active = saved.active
        pending = saved.pending
        reviewSession = saved.review
        if let restored = saved.active { rebuildRoute(from: restored) }
        refreshCounts()
    }
}

// CLLocationManagerDelegate requirements are nonisolated, so each callback hands
// only Sendable values to the main actor rather than touching state directly.
extension RecordingStore: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in self?.handleAuthorizationChange(status) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let samples = locations
            .filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
            .map(LocationSample.init)
        guard !samples.isEmpty else { return }
        Task { @MainActor [weak self] in self?.append(samples) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor [weak self] in self?.statusMessage = "Location error: \(message)" }
    }
}

// `review` is Optional so that files written before stop tagging shipped still
// decode -- the synthesized decoder uses decodeIfPresent for optionals.
private struct SavedSessions: Codable {
    let active: RecordingSession?
    let pending: [RecordingSession]
    let review: RecordingSession?
}

private extension JSONDecoder {
    static let roadAnalyzer: JSONDecoder = { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970; return decoder }()
}
