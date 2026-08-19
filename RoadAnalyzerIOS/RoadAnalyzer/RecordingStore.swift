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

/// "Are you still driving?" — shown when the car has not moved for long enough
/// that the drive is probably over and the driver has forgotten to end it.
struct StillDrivingPrompt: Equatable {
    let shownAt: Date
    /// When the app will end the drive by itself if nobody answers.
    let deadline: Date
    /// The moment the car last moved. The drive ends here, not at the deadline.
    let lastMovedAt: Date
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
    /// Stops that counted toward tagging -- prompted, or auto-tagged from a
    /// settled anchor. Suppressed cluster stops are excluded, matching the prompt.
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
    /// Stillness after which the app asks whether the drive is over.
    ///
    /// Five minutes is far longer than any traffic control and longer than all
    /// but the worst jams: the longest stop in a year of recorded drives is
    /// 149 s. Long enough not to interrupt a drawbridge or a freight crossing,
    /// short enough that a drive forgotten in a car park does not run all day.
    static let stillnessBeforeAsking: TimeInterval = 5 * 60
    /// Unanswered for this long and the app ends the drive itself. The driver
    /// has almost certainly walked away from the phone, which is the case this
    /// exists for.
    static let stillnessAnswerWindow: TimeInterval = 2 * 60
    /// After "yes, still driving", do not ask again for this long. Sitting in a
    /// queue for twenty minutes should cost one question, not four.
    static let stillnessSnooze: TimeInterval = 20 * 60
    /// Movement below this is GPS jitter at a standstill, not driving.
    static let movementSpeed = 1.5
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
    /// Nil unless the app is asking whether the drive is over.
    @Published private(set) var stillDrivingPrompt: StillDrivingPrompt?

    /// When the car last actually moved, which is where an auto-ended drive
    /// ends. Nil until the first moving fix of a drive.
    private var lastMovementAt: Date?
    private var stillnessSnoozedUntil: Date?

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
    private let persistBox = SnapshotBox()

    /// Map polylines under construction. `routeSpans` is published from this;
    /// appending happens here so the published copy is never mutated in place.
    ///
    /// These hold drawing resolution, not the trace. The trace is
    /// `session.locations`; nothing measures anything from here.
    private var spanBuffer: [[CLLocationCoordinate2D]] = []
    private var lastRouteSample: LocationSample?
    /// Set after a pause or a restore, so the next sample opens a new span
    /// rather than drawing a line across wherever the driver went with GPS off.
    private var routeBreakPending = true
    private var travelledDistance: Double = 0

    /// Most coordinates the map is ever given.
    ///
    /// MapPolyline is rebuilt and re-tessellated on every publish, so what it
    /// costs is the length of the drive unless something bounds it: an hour in,
    /// every fix hands MapKit another thousand points to walk, and that is main
    /// thread work growing with the session in exactly the way the rest of this
    /// file was changed to avoid. A phone cannot resolve a thousand points
    /// across a route anyway.
    private static let maxDrawnCoordinates = 1_000
    /// Closest two drawn coordinates may be. Doubles each time the budget is
    /// spent, so the drawn route keeps roughly constant weight however far the
    /// drive goes.
    private static let initialDrawSpacing: CLLocationDistance = 8
    private var drawSpacing = RecordingStore.initialDrawSpacing
    private var drawnCoordinates = 0
    private var lastDrawnCoordinate: CLLocationCoordinate2D?

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
        lastMovementAt = nil
        stillnessSnoozedUntil = nil
        clearStillDrivingPrompt()
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
        // The pause was not the car sitting still with the app watching -- GPS
        // was off. Restart the stillness clock rather than counting the pause
        // towards it and asking the moment the driver pulls away.
        lastMovementAt = Date.now
        clearStillDrivingPrompt()
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

    func stop() { stop(endingAt: nil) }

    /// End the drive.
    ///
    /// `endingAt` is for a drive the app ends itself, and is the moment the car
    /// last moved rather than the moment the app noticed. A drive the driver
    /// forgot about would otherwise carry however long it sat parked -- hours of
    /// stationary fixes, which is a wrong duration, a stop at the destination
    /// long enough to distort every delay figure it touches, and a congestion
    /// event lasting as long as the car was left there. Samples after that point
    /// belong to the parking, not the drive, so they go with it.
    func stop(endingAt: Date?) {
        guard active != nil else { return }
        stopSensors()
        locationManager.stopMonitoringSignificantLocationChanges()
        clearPrompt(markingDismissed: false)
        clearStillDrivingPrompt()
        // Read after stopSensors(), which drains the last of the buffered motion
        // into the session.
        guard var completed = active else { return }

        let now = endingAt ?? Date.now
        if let endingAt { completed.truncate(after: endingAt) }
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
        lastMovementAt = nil
        stillnessSnoozedUntil = nil
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
                self.checkStillness(now: .now)
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
        // A pause stops standard location updates, but two kinds of fix still
        // arrive: one already in flight when the driver paused, and the
        // significant-change updates `pause()` deliberately subscribes to so
        // iOS relaunches us if the car moves on. Neither belongs in the drive
        // -- stored, they upload and draw as a trace of where the driver went
        // while the recording was supposed to be off.
        guard !isPaused else {
            publishLive()
            return
        }
        // Appended straight into the stored session: `var copy = active` first
        // would keep a second reference alive across the append and copy the
        // whole array every time.
        active?.locations.append(contentsOf: samples)
        let count = active?.locations.count ?? 0

        for sample in samples {
            extendRoute(with: sample)
            noteMovement(in: sample)
            handle(detector.ingest(sample))
        }
        publishRoute()
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
            drawnCoordinates += 1
            lastDrawnCoordinate = sample.coordinate
        } else {
            // Distance is accumulated from every fix regardless of what gets
            // drawn: the number on screen is the drive's, not the polyline's.
            if let previous = lastRouteSample {
                travelledDistance += TrafficAnalyzer.distance(previous.latitude, previous.longitude, sample.latitude, sample.longitude)
            }
            if farEnoughToDraw(sample.coordinate) {
                spanBuffer[spanBuffer.count - 1].append(sample.coordinate)
                lastDrawnCoordinate = sample.coordinate
                drawnCoordinates += 1
                if drawnCoordinates > Self.maxDrawnCoordinates { thinDrawnRoute() }
            }
        }
        lastRouteSample = sample
    }

    /// Whether a fix moved far enough to be worth another vertex. Sitting at a
    /// light produces sixty coordinates on top of each other, none of which the
    /// map can show.
    private func farEnoughToDraw(_ coordinate: CLLocationCoordinate2D) -> Bool {
        guard let last = lastDrawnCoordinate else { return true }
        return TrafficAnalyzer.distance(last.latitude, last.longitude, coordinate.latitude, coordinate.longitude) >= drawSpacing
    }

    /// Halve the drawn route and require twice the spacing from here on.
    ///
    /// Amortised to nothing: each doubling costs one walk of a bounded array and
    /// buys twice the distance before the next. The end of each span is kept
    /// whatever the parity, so the line still reaches where the driver is.
    private func thinDrawnRoute() {
        spanBuffer = spanBuffer.map { span in
            guard span.count > 2 else { return span }
            var thinned: [CLLocationCoordinate2D] = []
            thinned.reserveCapacity(span.count / 2 + 1)
            for (index, coordinate) in span.enumerated() where index.isMultiple(of: 2) {
                thinned.append(coordinate)
            }
            if !(span.count - 1).isMultiple(of: 2) { thinned.append(span[span.count - 1]) }
            return thinned
        }
        drawnCoordinates = spanBuffer.reduce(0) { $0 + $1.count }
        drawSpacing *= 2
    }

    private func resetRoute() {
        spanBuffer = []
        lastRouteSample = nil
        routeBreakPending = true
        travelledDistance = 0
        drawSpacing = Self.initialDrawSpacing
        drawnCoordinates = 0
        lastDrawnCoordinate = nil
        routeSpans = []
    }

    /// The one place the whole trace is walked: restoring a drive from disk,
    /// once, rather than once per sample.
    private func rebuildRoute(from session: RecordingSession) {
        spanBuffer = TrafficAnalyzer.spans(of: session.locations, excluding: session.pauses).map { $0.map(\.coordinate) }
        travelledDistance = TrafficAnalyzer.totalDistance(session.locations, excluding: session.pauses)
        // A restored drive arrives at full resolution, so bring it down to the
        // same budget a live one would have reached.
        drawSpacing = Self.initialDrawSpacing
        drawnCoordinates = spanBuffer.reduce(0) { $0 + $1.count }
        while drawnCoordinates > Self.maxDrawnCoordinates { thinDrawnRoute() }
        lastDrawnCoordinate = spanBuffer.last?.last
        lastRouteSample = session.locations.max { $0.timestamp < $1.timestamp }
        // Recover when the car last moved, so a drive restored after a crash is
        // still asked about rather than waiting for a movement that will never
        // come if it is already parked.
        lastMovementAt = session.locations.last { ($0.speed ?? 0) > Self.movementSpeed }?.timestamp
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
            if event.suppressed != true {
                // A junction the driver has already answered for, consistently,
                // does not need asking again -- the app applies the settled tag
                // itself and only prompts when the anchor is new, unsure, or due
                // for a re-check.
                if let auto = anchors.autoResolve(for: event) {
                    applyAutoTag(auto.tag, anchorId: auto.anchorId, to: event.id)
                } else {
                    presentPrompt(for: event)
                }
            }

        case .departed(let stopId, let endedAt, let minimumSpeed):
            guard active != nil else { return }
            active?.updateStop(id: stopId) { stop in
                stop.endedAt = endedAt
                stop.minimumSpeed = min(stop.minimumSpeed, minimumSpeed)
            }
            persist()
        }
    }

    /// Remember the car moving, and take back the question if it was being asked.
    private func noteMovement(in sample: LocationSample) {
        guard (sample.speed ?? 0) > Self.movementSpeed else { return }
        lastMovementAt = sample.timestamp
        // Driving again answers the question better than tapping does.
        if stillDrivingPrompt != nil {
            clearStillDrivingPrompt()
            statusMessage = "Still recording"
        }
    }

    /// Ask whether the drive is over, and end it if nobody says otherwise.
    ///
    /// Runs on the same tick as the detector. A paused drive is excluded: GPS is
    /// off, so stillness means nothing, and an abandoned pause is already
    /// recovered separately.
    private func checkStillness(now: Date) {
        guard active != nil, !isPaused else { return }

        if let prompt = stillDrivingPrompt {
            guard now >= prompt.deadline else { return }
            // Nobody answered. The driver is not with the phone, which is the
            // whole case this exists for, so end the drive where the driving
            // ended rather than here.
            clearStillDrivingPrompt()
            stop(endingAt: prompt.lastMovedAt)
            statusMessage = "Drive ended automatically — the car had not moved for a while"
            return
        }

        guard let lastMoved = lastMovementAt ?? active?.startedAt,
              now.timeIntervalSince(lastMoved) >= Self.stillnessBeforeAsking,
              stillnessSnoozedUntil.map({ now >= $0 }) ?? true else { return }

        stillDrivingPrompt = StillDrivingPrompt(
            shownAt: now,
            deadline: now.addingTimeInterval(Self.stillnessAnswerWindow),
            lastMovedAt: lastMoved
        )
        Haptics.stopDetected()
    }

    /// "Yes, still driving." Keeps the drive and stops asking for a while.
    func confirmStillDriving() {
        clearStillDrivingPrompt()
        stillnessSnoozedUntil = Date.now.addingTimeInterval(Self.stillnessSnooze)
        // Treat the answer as movement: otherwise the snooze expires and the
        // question returns immediately on a car that still has not moved.
        lastMovementAt = Date.now
        statusMessage = "Still recording"
    }

    /// "No, I'm done." Ends the drive at the last movement, same as the timeout,
    /// because the driving stopped then and not when the question was answered.
    func endDriveFromPrompt() {
        guard let prompt = stillDrivingPrompt else { return }
        clearStillDrivingPrompt()
        stop(endingAt: prompt.lastMovedAt)
    }

    private func clearStillDrivingPrompt() {
        stillDrivingPrompt = nil
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

    /// Apply a tag the anchor is already confident about, without ever showing
    /// the prompt. Unlike `applyTag` this does not run `AnchorStore.resolve`: an
    /// auto-tag must not vote on the anchor, or the app would keep agreeing with
    /// itself and never notice the junction changed. `autoResolve` has already
    /// matched the anchor and advanced its streak, so the id is passed straight
    /// through. A short buzz confirms it logged itself; no answer is wanted.
    private func applyAutoTag(_ tag: StopTag, anchorId: UUID, to id: UUID) {
        let now = Date.now
        active?.updateStop(id: id) { stop in
            stop.tag = tag
            stop.taggedAt = now
            stop.taggedDuring = .auto
            stop.anchorId = anchorId
        }
        publishLive()
        Haptics.tagConfirmed()
        persist()
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
    ///
    /// Requests coalesce. persist() is called every ten fixes, and what it costs
    /// grows with the drive, so a long enough one can ask for writes faster than
    /// they finish. Queuing each request would then pile up snapshots that each
    /// pin their own copy of the session -- the arrays diverge as soon as the
    /// live one is appended to again -- and the writes would fall further behind
    /// the further they got. A newer snapshot supersedes an older one, so only
    /// the latest is kept and the running pass picks it up.
    private func persist() {
        refreshCounts()
        let snapshot = SavedSessions(active: active, pending: pending, review: reviewSession)
        guard persistBox.offer(snapshot) else { return }
        let url = persistenceURL
        persistQueue.async { [box = persistBox, encoder = persistEncoder] in
            while let snapshot = box.next() {
                guard let data = try? encoder.encode(snapshot) else { continue }
                try? data.write(to: url, options: .atomic)
            }
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

/// The latest state waiting to be written, and whether a write pass is running.
///
/// Both are one decision, so they are guarded together: a caller either starts
/// the pass or hands its snapshot to the pass already running. Splitting them
/// across the main actor and the write queue would leave a window in which the
/// pass finishes just as a snapshot arrives and nobody writes it.
private final class SnapshotBox: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: SavedSessions?
    private var writing = false

    /// Store the newest state. True when the caller should start a write pass.
    func offer(_ snapshot: SavedSessions) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        pending = snapshot
        if writing { return false }
        writing = true
        return true
    }

    /// The next state to write, or nil once there is nothing left -- which also
    /// ends the pass, under the same lock that would start another.
    func next() -> SavedSessions? {
        lock.lock()
        defer { lock.unlock() }
        if let snapshot = pending {
            pending = nil
            return snapshot
        }
        writing = false
        return nil
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
