import Foundation
import CoreLocation
import UIKit

enum TrafficSeverity: String, Codable, CaseIterable {
    case freeFlow = "FREE_FLOW", slow = "SLOW", congested = "CONGESTED", heavy = "HEAVY", gridlock = "GRIDLOCK"
}

struct LocationSample: Codable, Identifiable {
    var id: UUID = UUID()
    let timestamp: Date
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let speed: Double?
    let heading: Double?
    let accuracy: Double

    init(_ location: CLLocation) {
        timestamp = location.timestamp
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        altitude = location.verticalAccuracy >= 0 ? location.altitude : nil
        speed = location.speed >= 0 ? location.speed : nil
        heading = location.course >= 0 ? location.course : nil
        accuracy = location.horizontalAccuracy
    }
}

struct MotionSample: Codable, Identifiable {
    var id: UUID = UUID()
    let timestamp: Date
    let x: Double
    let y: Double
    let z: Double
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

struct MobileReport: Codable {
    let schemaVersion = "1"
    let idempotencyKey: String
    let startedAt: Int64
    let endedAt: Int64
    let name: String
    let locations: [LocationSample]
    let motionSamples: [MotionSample]
    let device: Device
    let diagnostics: Diagnostics
    let trafficAnalysisVersion = "1"

    struct Device: Codable { let model: String; let osVersion: String }
    struct Diagnostics: Codable { let batteryLevel: Float?; let networkType: String; let locationAuthorization: String }

    init(session: RecordingSession, authorization: CLAuthorizationStatus) {
        idempotencyKey = session.id.uuidString.lowercased()
        startedAt = Int64(session.startedAt.timeIntervalSince1970 * 1_000)
        endedAt = Int64((session.endedAt ?? .now).timeIntervalSince1970 * 1_000)
        name = "iPhone traffic report"
        locations = session.locations
        motionSamples = session.motionSamples
        device = Device(model: UIDevice.current.model, osVersion: UIDevice.current.systemVersion)
        diagnostics = Diagnostics(batteryLevel: session.batteryLevel, networkType: session.networkType, locationAuthorization: String(describing: authorization))
    }
}
