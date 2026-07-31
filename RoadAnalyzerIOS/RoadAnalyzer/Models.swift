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

struct RecordingSession: Codable, Identifiable {
    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    var locations: [LocationSample]
    var motionSamples: [MotionSample]
    var events: [TrafficEvent]
    var batteryLevel: Float?
    var networkType: String
    var uploadAttempts: Int
    var nextUploadAt: Date?
    var uploaded: Bool
    /// Set when the server rejected the payload outright (4xx). Optional so that
    /// session files written by earlier builds still decode.
    var failedPermanently: Bool?

    init(startedAt: Date = .now, batteryLevel: Float?, networkType: String) {
        id = UUID()
        self.startedAt = startedAt
        locations = []
        motionSamples = []
        events = []
        self.batteryLevel = batteryLevel
        self.networkType = networkType
        uploadAttempts = 0
        uploaded = false
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
    let schemaVersion = "2"
    let idempotencyKey: String
    let startedAt: Int64
    let endedAt: Int64
    let name: String
    let locations: [LocationSample]
    let motionSamples: [MotionSample]
    let device: Device
    let diagnostics: Diagnostics
    let trafficAnalysisVersion = "1"

    struct Device: Encodable { let model: String; let osVersion: String }
    struct Diagnostics: Encodable { let batteryLevel: Float?; let networkType: String; let locationAuthorization: String }

    // Mirrors MAX_LOCATION_SAMPLES / MAX_MOTION_SAMPLES in lib/mobile-report.ts.
    // Motion runs at 10 Hz, so the 72k ceiling is reached after two hours; a
    // longer drive used to be rejected with a 400 that could never succeed.
    static let maxLocationSamples = 12_000
    static let maxMotionSamples = 72_000

    /// Evenly thins `samples` to at most `limit`, preserving span and ordering.
    private static func thinned<T>(_ samples: [T], to limit: Int) -> [T] {
        guard samples.count > limit, limit > 0 else { return samples }
        let step = Double(samples.count) / Double(limit)
        return (0..<limit).map { samples[min(Int(Double($0) * step), samples.count - 1)] }
    }

    init(session: RecordingSession, authorization: CLAuthorizationStatus) {
        idempotencyKey = session.id.uuidString.lowercased()
        startedAt = Int64(session.startedAt.timeIntervalSince1970 * 1_000)
        endedAt = Int64((session.endedAt ?? .now).timeIntervalSince1970 * 1_000)
        name = "iPhone traffic report"
        locations = Self.thinned(session.locations, to: Self.maxLocationSamples)
        motionSamples = Self.thinned(session.motionSamples, to: Self.maxMotionSamples)
        device = Device(model: UIDevice.current.model, osVersion: UIDevice.current.systemVersion)
        diagnostics = Diagnostics(batteryLevel: session.batteryLevel, networkType: session.networkType, locationAuthorization: authorization.reportName)
    }
}
