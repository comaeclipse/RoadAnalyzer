import Foundation
import CoreLocation
import UIKit

enum TrafficSeverity: String, Codable, CaseIterable {
    case freeFlow = "FREE_FLOW", slow = "SLOW", congested = "CONGESTED", heavy = "HEAVY", gridlock = "GRIDLOCK"
}

struct LocationSample: Codable, Identifiable {
    // Identity is for SwiftUI only. It is deliberately absent from CodingKeys:
    // the server ignores it, and at ~45 bytes a sample it dominated the payload.
    var id: UUID = UUID()
    let timestamp: Date
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let speed: Double?
    let heading: Double?
    let accuracy: Double
    let speedAccuracy: Double?
    let courseAccuracy: Double?

    enum CodingKeys: String, CodingKey {
        case timestamp, latitude, longitude, altitude, speed, heading, accuracy, speedAccuracy, courseAccuracy
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    init(_ location: CLLocation) {
        timestamp = location.timestamp
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
        speed = location.speed >= 0 ? location.speed : nil
        heading = location.course >= 0 ? location.course : nil
        accuracy = location.horizontalAccuracy
        speedAccuracy = location.speedAccuracy >= 0 ? location.speedAccuracy : nil
        courseAccuracy = location.courseAccuracy >= 0 ? location.courseAccuracy : nil
    }
}

struct MotionSample: Codable, Identifiable {
    var id: UUID = UUID()
    let timestamp: Date
    let x: Double
    let y: Double
    let z: Double

    enum CodingKeys: String, CodingKey { case timestamp, x, y, z }
}

struct TrafficEvent: Codable, Identifiable {
    var id: UUID = UUID()
    let startTime: Date
    let endTime: Date
    let severity: TrafficSeverity
    let averageSpeed: Double
    let minimumSpeed: Double
    let maximumSpeed: Double
    let distance: Double
}

enum StopTag: String, Codable, CaseIterable {
    case slowdown = "SLOWDOWN", stopSign = "STOP_SIGN", redLight = "RED_LIGHT", skipped = "SKIPPED"

    /// The three the driver is offered. `.skipped` is applied by the app when a
    /// stop is discarded, never chosen from the prompt.
    static let selectable: [StopTag] = [.slowdown, .stopSign, .redLight]

    var label: String {
        switch self {
        case .slowdown: return "Slowdown"
        case .stopSign: return "Stop sign"
        case .redLight: return "Red light"
        case .skipped: return "Not a stop"
        }
    }

    var symbolName: String {
        switch self {
        case .slowdown: return "tortoise.fill"
        case .stopSign: return "octagon.fill"
        case .redLight: return "light.beacon.max.fill"
        case .skipped: return "xmark.circle"
        }
    }

    /// Only a controlled intersection has an identity worth reusing across
    /// drives; a slowdown is a stretch of road, not a junction.
    var anchors: Bool { self == .stopSign || self == .redLight }

    /// Wire name for the traffic-tag payload. `.skipped` has none: a discarded
    /// stop is the driver saying there is nothing to record, so it is never
    /// uploaded.
    var wireKind: String? {
        switch self {
        case .slowdown: return "SLOWDOWN"
        case .stopSign: return "STOP_SIGN"
        case .redLight: return "RED_LIGHT"
        case .skipped: return nil
        }
    }
}

enum StopTagSource: String, Codable { case live = "LIVE", review = "REVIEW" }

enum PauseEndReason: String, Codable {
    case user = "USER", stoppedWhilePaused = "STOP", recovered = "RECOVERED"
}

/// A detected stop, plus whatever the driver said about it. Unlike
/// LocationSample, `id` IS encoded: there are dozens of these rather than
/// thousands, and both the review screen and the server's idempotent re-ingest
/// need a stable identity. Do not add explicit CodingKeys here or `id` is
/// silently dropped from the wire.
struct StopEvent: Codable, Identifiable, Equatable {
    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    /// Approach course, captured while still moving. CoreLocation reports an
    /// invalid course at low speed -- precisely at the stop -- so this cannot be
    /// read from the stopped samples themselves.
    let heading: Double?
    let approachSpeed: Double?
    var minimumSpeed: Double
    var tag: StopTag?
    var taggedAt: Date?
    var taggedDuring: StopTagSource?
    var anchorId: UUID?
    var promptShownAt: Date?
    var autoDismissed: Bool?
    /// Detected inside a dense stop-and-go cluster: recorded and uploaded, but
    /// never prompted and hidden from review by default.
    var suppressed: Bool?

    /// Nil while the stop is still in progress. Derived rather than stored so it
    /// cannot drift away from `endedAt`.
    var duration: TimeInterval? {
        endedAt.map { $0.timeIntervalSince(startedAt) }
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// A device-local cluster of stops at one approach to one junction. Survives
/// upload (unlike a session) so repeat stops at the same light share an id.
struct StopAnchor: Codable, Identifiable {
    let id: UUID
    var latitude: Double
    var longitude: Double
    /// Vector sums, not an averaged angle: a circular mean has no wraparound
    /// boundary, so 337 degrees and 023 degrees stay one approach.
    var headingSin: Double
    var headingCos: Double
    var sampleCount: Int
    var firstSeenAt: Date
    var lastSeenAt: Date
    var tagCounts: [String: Int]

    var meanHeading: Double? {
        guard headingSin != 0 || headingCos != 0 else { return nil }
        let degrees = atan2(headingSin, headingCos) * 180 / .pi
        return degrees < 0 ? degrees + 360 : degrees
    }

    /// The tag this approach usually gets, used to pre-select in the prompt.
    var dominantTag: StopTag? {
        tagCounts.max { $0.value < $1.value }.flatMap { StopTag(rawValue: $0.key) }
    }
}

/// A span the driver removed from the drive. The open interval on disk *is* the
/// paused state -- there is no separate flag to fall out of sync with it.
struct PausedInterval: Codable, Identifiable, Equatable {
    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    var endedBy: PauseEndReason?

    func duration(asOf now: Date) -> TimeInterval {
        max(0, (endedAt ?? now).timeIntervalSince(startedAt))
    }

    func contains(_ date: Date, asOf now: Date) -> Bool {
        date >= startedAt && date <= (endedAt ?? now)
    }
}

struct RecordingSession: Codable, Identifiable {
    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    var locations: [LocationSample]
    var motionSamples: [MotionSample]
    var batteryLevel: Float?
    var networkType: String
    var uploadAttempts: Int
    var nextUploadAt: Date?
    var uploaded: Bool
    /// Set when the server rejected the payload outright (4xx). Optional so that
    /// session files written by earlier builds still decode.
    var failedPermanently: Bool?
    /// Optional for the same reason as `failedPermanently`: a session file
    /// written before this feature shipped has neither key.
    var stopEvents: [StopEvent]?
    var pausedIntervals: [PausedInterval]?

    init(startedAt: Date = .now, batteryLevel: Float?, networkType: String) {
        id = UUID()
        self.startedAt = startedAt
        locations = []
        motionSamples = []
        self.batteryLevel = batteryLevel
        self.networkType = networkType
        uploadAttempts = 0
        uploaded = false
        stopEvents = []
        pausedIntervals = []
    }
}

extension RecordingSession {
    var stops: [StopEvent] { stopEvents ?? [] }
    var pauses: [PausedInterval] { pausedIntervals ?? [] }

    var openPause: PausedInterval? { pauses.last.flatMap { $0.endedAt == nil ? $0 : nil } }
    var openStop: StopEvent? { stops.last.flatMap { $0.endedAt == nil ? $0 : nil } }
    var isPaused: Bool { openPause != nil }

    /// Stops the driver still has to answer for. Suppressed cluster stops are
    /// excluded: they were never prompted, and surfacing forty of them after a
    /// jam is how this feature gets switched off.
    var untaggedStops: [StopEvent] {
        stops.filter { $0.tag == nil && $0.suppressed != true }
    }

    /// Route geometry, broken at every paused interval. Drawn as one polyline
    /// per span so a pause reads as a gap: a single polyline would run a
    /// straight line across wherever the driver went with GPS off, which looks
    /// like a road that isn't there.
    ///
    /// Sorts and walks the whole trace, so it is for one-shot use on a finished
    /// drive only. A live view must read `RecordingStore.routeSpans`, which is
    /// maintained incrementally; calling this per frame is what made the app
    /// unusable on long drives.
    var routeSpans: [[CLLocationCoordinate2D]] {
        TrafficAnalyzer.spans(of: locations, excluding: pauses)
            .filter { $0.count > 1 }
            .map { $0.map(\.coordinate) }
    }

    func pausedDuration(asOf now: Date = .now) -> TimeInterval {
        pauses.reduce(0) { $0 + $1.duration(asOf: min(now, endedAt ?? now)) }
    }

    mutating func appendStop(_ event: StopEvent) {
        stopEvents = stops + [event]
    }

    mutating func updateStop(id: UUID, _ body: (inout StopEvent) -> Void) {
        var all = stops
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        body(&all[index])
        stopEvents = all
    }

    mutating func appendPause(_ interval: PausedInterval) {
        pausedIntervals = pauses + [interval]
    }

    mutating func closeOpenPause(at date: Date, endedBy reason: PauseEndReason) {
        var all = pauses
        guard let index = all.lastIndex(where: { $0.endedAt == nil }) else { return }
        all[index].endedAt = max(date, all[index].startedAt)
        all[index].endedBy = reason
        pausedIntervals = all
    }
}

extension CLAuthorizationStatus {
    /// Stable wire name for the diagnostics payload. String(describing:) yields a
    /// debug rendering like "CLAuthorizationStatus(rawValue: 3)", which is not a
    /// contract and would change with the SDK.
    var reportName: String {
        switch self {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "authorizedAlways"
        case .authorizedWhenInUse: return "authorizedWhenInUse"
        @unknown default: return "unknown"
        }
    }
}

// Encode-only: the wire format is written by UploadClient and never read back,
// so the defaulted version constants below need no decoding support.
struct MobileReport: Encodable {
    let schemaVersion = "3"
    let idempotencyKey: String
    let startedAt: Int64
    let endedAt: Int64
    let name: String
    let locations: [LocationSample]
    let motionSamples: [MotionSample]
    let trafficTags: [TrafficTagPayload]
    let pausedIntervals: [PausedInterval]
    let device: Device
    let diagnostics: Diagnostics
    let trafficAnalysisVersion = "1"

    /// One labelled stop, shaped for the server's TrafficTag table. Only closed,
    /// answered stops make it here: TrafficTag requires an end time and a
    /// duration, and an untagged or discarded stop has nothing to say.
    struct TrafficTagPayload: Encodable {
        let id: UUID
        let startedAt: Date
        let endedAt: Date
        let latitude: Double
        let longitude: Double
        let kind: String
        let accuracy: Double
        let heading: Double?
        let anchorId: UUID?
        let taggedDuring: StopTagSource?

        init?(_ stop: StopEvent) {
            guard let tag = stop.tag, let kind = tag.wireKind, let endedAt = stop.endedAt else { return nil }
            id = stop.id
            startedAt = stop.startedAt
            self.endedAt = endedAt
            latitude = stop.latitude
            longitude = stop.longitude
            self.kind = kind
            accuracy = stop.accuracy
            heading = stop.heading
            anchorId = stop.anchorId
            taggedDuring = stop.taggedDuring
        }
    }

    /// Captured on the main actor while recording starts, so that building the
    /// report itself -- which thins tens of thousands of samples -- can happen
    /// off it. `UIDevice.current` is main-thread only.
    struct Device: Encodable, Sendable {
        let model: String
        let osVersion: String

        @MainActor static var current: Device {
            Device(model: UIDevice.current.model, osVersion: UIDevice.current.systemVersion)
        }
    }
    struct Diagnostics: Encodable { let batteryLevel: Float?; let networkType: String; let locationAuthorization: String }

    // Mirrors MAX_LOCATION_SAMPLES / MAX_MOTION_SAMPLES in lib/mobile-report.ts.
    // Motion runs at 10 Hz, so the 72k ceiling is reached after two hours; a
    // longer drive used to be rejected with a 400 that could never succeed.
    static let maxLocationSamples = 12_000
    static let maxMotionSamples = 72_000
    // Mirrors MAX_TRAFFIC_TAGS / MAX_PAUSED_INTERVALS in lib/mobile-report.ts.
    // Going over is not a soft failure: the server answers 400, which
    // RecordingStore treats as permanent, and the drive is lost for good.
    static let maxTrafficTags = 500
    static let maxPausedIntervals = 100

    /// Evenly thins `samples` to at most `limit`, preserving span and ordering.
    private static func thinned<T>(_ samples: [T], to limit: Int) -> [T] {
        guard samples.count > limit, limit > 0 else { return samples }
        let step = Double(samples.count) / Double(limit)
        return (0..<limit).map { samples[min(Int(Double($0) * step), samples.count - 1)] }
    }

    /// Keeps the earliest tags when over the cap. Thinning evenly (as `thinned`
    /// does) would discard the driver's own answers at random, and those are
    /// the one part of this payload that cannot be recomputed from the trace.
    private static func capped(_ tags: [TrafficTagPayload], to limit: Int) -> [TrafficTagPayload] {
        guard tags.count > limit else { return tags }
        return Array(tags.sorted { $0.startedAt < $1.startedAt }.prefix(limit))
    }

    init(session: RecordingSession, authorization: CLAuthorizationStatus, device: Device) {
        idempotencyKey = session.id.uuidString.lowercased()
        startedAt = Int64(session.startedAt.timeIntervalSince1970 * 1_000)
        endedAt = Int64((session.endedAt ?? .now).timeIntervalSince1970 * 1_000)
        name = "iPhone traffic report"
        locations = Self.thinned(session.locations, to: Self.maxLocationSamples)
        motionSamples = Self.thinned(session.motionSamples, to: Self.maxMotionSamples)
        // Tags carry their own coordinates, so thinning `locations` above can
        // never cost a stop its position. compactMap drops the untagged, the
        // discarded, and any stop still open at upload time.
        trafficTags = Self.capped(session.stops.compactMap(TrafficTagPayload.init), to: Self.maxTrafficTags)
        pausedIntervals = Array(session.pauses.prefix(Self.maxPausedIntervals))
        self.device = device
        diagnostics = Diagnostics(batteryLevel: session.batteryLevel, networkType: session.networkType, locationAuthorization: authorization.reportName)
    }
}
