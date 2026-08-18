import Foundation
import CoreLocation

/// Live stop detection. A value type with no CoreLocation dependency beyond
/// distance math, so thresholds can be exercised against synthetic traces
/// instead of requiring a car and a red light.
///
/// RecordingStore feeds it samples and a 1 Hz tick, and performs the side
/// effects it asks for; the detector itself touches nothing outside its own
/// state.
struct StopDetector {
    /// Below this the vehicle counts as stopped. Matches STOP_THRESHOLD in
    /// app/recordings/[id]/page.tsx.
    static let fullStopSpeed = 0.5
    /// Matches SLOW_THRESHOLD there.
    static let slowSpeed = 4.5
    /// Hysteresis above `slowSpeed`: creeping forward in a queue must not read
    /// as leaving the stop.
    static let resumeSpeed = 6.0
    /// Deliberately below the server's 5 s MIN_DURATION. A stop-sign stop lasts
    /// 1.5-3.5 s, so a 5 s gate would miss the majority of them.
    static let minStopDuration: TimeInterval = 2.0
    /// A candidate whose position wanders further than this was a GPS jump, not
    /// a stop.
    static let maxCandidateDrift = 15.0
    /// Leaving requires real displacement as well as speed, because jitter at a
    /// light routinely fakes 2-4 m/s.
    static let departureDistance = 30.0
    /// Quiet window after a departure, so stop-and-go does not chatter.
    static let rearmCooldown: TimeInterval = 45
    /// A cluster of this many stops inside `clusterWindow` and `clusterRadius`
    /// is congestion, not a series of intersections.
    static let clusterCount = 3
    static let clusterWindow: TimeInterval = 180
    static let clusterRadius = 200.0
    /// An approach course older than this no longer describes this stop.
    static let courseStaleness: TimeInterval = 20
    /// Doppler speed is trusted outright below this accuracy, in m/s.
    static let trustedSpeedAccuracy = 3.0

    enum Effect: Equatable {
        /// A candidate opened. Used to warm the Taptic engine before the stop
        /// confirms about two seconds later.
        case armed
        case confirmed(StopEvent)
        case departed(stopId: UUID, endedAt: Date, minimumSpeed: Double)
        case none
    }

    private enum State {
        /// Freshly started or resumed: a candidate may not arm until the vehicle
        /// has actually been seen moving.
        case awaitingMotion
        case moving
        case decelerating
        case candidate(startedAt: Date, anchor: LocationSample, minimumSpeed: Double, approachHeading: Double?, approachSpeed: Double?)
        case stopped(id: UUID, at: LocationSample, minimumSpeed: Double)
    }

    private var state: State = .awaitingMotion
    private var previousSample: LocationSample?
    private var lastProcessedAt: Date?
    private var lastGoodCourse: (heading: Double, at: Date)?
    private var cooldownUntil: Date?
    /// Recent confirmed stops, for cluster suppression. Trimmed to the window.
    private var recentStops: [(at: Date, latitude: Double, longitude: Double)] = []
    /// Trailing positions, used to recover an approach bearing when CoreLocation
    /// never gave a valid course.
    private var trail: [LocationSample] = []

    /// Return to `.awaitingMotion`, discarding any candidate. Used on resume:
    /// requiring real motion again is what stops a pull-over-and-pause from
    /// firing a phantom stop the instant GPS comes back at 0 m/s.
    mutating func reset() {
        state = .awaitingMotion
        previousSample = nil
        lastProcessedAt = nil
        lastGoodCourse = nil
        trail = []
    }

    /// Discard everything, including the cluster history. Used when a session
    /// ends rather than when it pauses.
    mutating func resetForNewSession() {
        reset()
        cooldownUntil = nil
        recentStops = []
    }

    // MARK: - Ingest

    mutating func ingest(_ sample: LocationSample) -> Effect {
        // Delegate callbacks hop to the main actor through independent Tasks,
        // which are not FIFO, so batches can arrive out of order. Everything
        // below assumes a monotonic clock.
        if let last = lastProcessedAt, sample.timestamp <= last { return .none }
        lastProcessedAt = sample.timestamp

        let speed = Self.effectiveSpeed(sample, previous: previousSample)
        previousSample = sample
        appendToTrail(sample)

        if let speed, speed > Self.slowSpeed, let heading = sample.heading {
            lastGoodCourse = (heading, sample.timestamp)
        }

        // A missing speed is missing information, not zero. Mapping it to zero
        // (as the post-hoc TrafficAnalyzer does) would fire a stop every time
        // GPS quality dipped at highway speed.
        guard let speed else { return .none }
        return advance(speed: speed, sample: sample, now: sample.timestamp)
    }

    /// Called once a second. CoreLocation slows delivery while stationary and
    /// RecordingStore drops fixes over 50 m accuracy, so a candidate can reach
    /// its minimum duration without a single new sample arriving.
    mutating func tick(now: Date) -> Effect {
        guard case .candidate(let startedAt, let anchor, let minimumSpeed, let heading, let approachSpeed) = state,
              now.timeIntervalSince(startedAt) >= Self.minStopDuration else { return .none }
        return confirm(startedAt: startedAt, anchor: anchor, minimumSpeed: minimumSpeed,
                       heading: heading, approachSpeed: approachSpeed, now: now)
    }

    var hasOpenStop: Bool { if case .stopped = state { return true }; return false }

    // MARK: - State machine

    private mutating func advance(speed: Double, sample: LocationSample, now: Date) -> Effect {
        switch state {
        case .awaitingMotion:
            if speed > Self.resumeSpeed { state = .moving }
            return .none

        case .moving:
            if speed < Self.slowSpeed { state = .decelerating }
            return .none

        case .decelerating:
            if speed > Self.resumeSpeed {
                state = .moving
            } else if speed < Self.fullStopSpeed {
                state = .candidate(startedAt: now, anchor: sample, minimumSpeed: speed,
                                   approachHeading: approachHeading(at: now), approachSpeed: trailingSpeed())
                return .armed
            }
            return .none

        case .candidate(let startedAt, let anchor, let minimumSpeed, let heading, let approachSpeed):
            // A candidate that drifts is a GPS jump; discard it silently rather
            // than recording a stop somewhere the car never was.
            let drift = TrafficAnalyzer.distance(anchor.latitude, anchor.longitude, sample.latitude, sample.longitude)
            if speed > Self.resumeSpeed || drift > Self.maxCandidateDrift {
                state = .moving
                return .none
            }
            let lowest = min(minimumSpeed, speed)
            guard now.timeIntervalSince(startedAt) >= Self.minStopDuration else {
                state = .candidate(startedAt: startedAt, anchor: anchor, minimumSpeed: lowest,
                                   approachHeading: heading, approachSpeed: approachSpeed)
                return .none
            }
            return confirm(startedAt: startedAt, anchor: anchor, minimumSpeed: lowest,
                           heading: heading, approachSpeed: approachSpeed, now: now)

        case .stopped(let id, let at, let minimumSpeed):
            let travelled = TrafficAnalyzer.distance(at.latitude, at.longitude, sample.latitude, sample.longitude)
            // Both conditions, always: speed alone is faked by jitter, and
            // distance alone is faked by a drifting fix.
            guard speed > Self.resumeSpeed, travelled > Self.departureDistance else {
                state = .stopped(id: id, at: at, minimumSpeed: min(minimumSpeed, speed))
                return .none
            }
            state = .moving
            cooldownUntil = now.addingTimeInterval(Self.rearmCooldown)
            return .departed(stopId: id, endedAt: now, minimumSpeed: min(minimumSpeed, speed))
        }
    }

    private mutating func confirm(
        startedAt: Date,
        anchor: LocationSample,
        minimumSpeed: Double,
        heading: Double?,
        approachSpeed: Double?,
        now: Date
    ) -> Effect {
        let id = UUID()
        state = .stopped(id: id, at: anchor, minimumSpeed: minimumSpeed)

        trimRecentStops(before: now)
        let inCooldown = cooldownUntil.map { now < $0 } ?? false
        let suppressed = inCooldown || isInCluster(anchor, now: now)
        recentStops.append((at: now, latitude: anchor.latitude, longitude: anchor.longitude))

        return .confirmed(StopEvent(
            id: id,
            startedAt: startedAt,
            endedAt: nil,
            latitude: anchor.latitude,
            longitude: anchor.longitude,
            accuracy: anchor.accuracy,
            heading: heading,
            approachSpeed: approachSpeed,
            minimumSpeed: minimumSpeed,
            tag: nil,
            taggedAt: nil,
            taggedDuring: nil,
            anchorId: nil,
            promptShownAt: nil,
            autoDismissed: nil,
            suppressed: suppressed ? true : nil
        ))
    }

    // MARK: - Helpers

    /// Doppler speed where it can be trusted, positional differencing where it
    /// cannot, and nil rather than a guess when neither is usable.
    static func effectiveSpeed(_ sample: LocationSample, previous: LocationSample?) -> Double? {
        if let speed = sample.speed, (sample.speedAccuracy ?? .infinity) <= trustedSpeedAccuracy { return speed }
        if let speed = sample.speed { return speed }
        guard let previous else { return nil }
        let dt = sample.timestamp.timeIntervalSince(previous.timestamp)
        guard dt >= 0.2, dt <= 10, sample.accuracy <= 25, previous.accuracy <= 25 else { return nil }
        return distanceBetween(previous, sample) / dt
    }

    static func distanceBetween(_ a: LocationSample, _ b: LocationSample) -> Double {
        TrafficAnalyzer.distance(a.latitude, a.longitude, b.latitude, b.longitude)
    }

    /// The course the vehicle was travelling on the way in. Falls back to the
    /// bearing along the trail when CoreLocation never reported a valid course,
    /// because without a heading a stop cannot be told from its opposing
    /// approach and the anchor scheme degrades to position alone.
    private func approachHeading(at now: Date) -> Double? {
        if let course = lastGoodCourse, now.timeIntervalSince(course.at) <= Self.courseStaleness {
            return course.heading
        }
        guard let last = trail.last else { return nil }
        // Walk back from the stop to the nearest sample at least 30 m behind
        // it: the shortest baseline that still clears GPS jitter, so the
        // bearing describes the final approach. Scanning forward from the
        // oldest sample instead took the *longest* baseline in the buffer,
        // which is a chord across whatever else is still in the trail -- an
        // earlier leg of the drive, or the road before a turn -- and routinely
        // inverted the bearing, sending a northbound stop to its opposing
        // anchor. The trail holds 60 samples, and CoreLocation slows delivery
        // while stationary, so that window reaches much further back than the
        // "last 100 m" the buffer size assumes.
        guard let origin = trail.last(where: { Self.distanceBetween($0, last) >= 30 }) ?? trail.first,
              Self.distanceBetween(origin, last) >= 10 else { return nil }
        return Self.bearing(from: origin, to: last)
    }

    static func bearing(from: LocationSample, to: LocationSample) -> Double {
        let fromLat = from.latitude * .pi / 180, toLat = to.latitude * .pi / 180
        let deltaLon = (to.longitude - from.longitude) * .pi / 180
        let y = sin(deltaLon) * cos(toLat)
        let x = cos(fromLat) * sin(toLat) - sin(fromLat) * cos(toLat) * cos(deltaLon)
        let degrees = atan2(y, x) * 180 / .pi
        return degrees < 0 ? degrees + 360 : degrees
    }

    /// Fastest speed seen on the way in, as a rough sense of the road.
    private func trailingSpeed() -> Double? {
        trail.compactMap(\.speed).max()
    }

    private mutating func appendToTrail(_ sample: LocationSample) {
        trail.append(sample)
        // Roughly the last 100 m of approach at any plausible sample rate.
        if trail.count > 60 { trail.removeFirst(trail.count - 60) }
    }

    private mutating func trimRecentStops(before now: Date) {
        recentStops.removeAll { now.timeIntervalSince($0.at) > Self.clusterWindow }
    }

    /// Three stops inside three minutes and 200 m is a jam, not three junctions.
    private func isInCluster(_ sample: LocationSample, now: Date) -> Bool {
        let nearby = recentStops.filter {
            now.timeIntervalSince($0.at) <= Self.clusterWindow &&
            TrafficAnalyzer.distance($0.latitude, $0.longitude, sample.latitude, sample.longitude) <= Self.clusterRadius
        }
        return nearby.count >= Self.clusterCount
    }
}
