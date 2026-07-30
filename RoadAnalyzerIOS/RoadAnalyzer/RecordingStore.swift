import Foundation
import CoreLocation
import CoreMotion
import Network
import UIKit

@MainActor
final class RecordingStore: NSObject, ObservableObject {
    @Published private(set) var session: RecordingSession?
    @Published private(set) var locationStatus: CLAuthorizationStatus = .notDetermined
    @Published private(set) var networkType = "offline"
    @Published private(set) var statusMessage = "Ready to record"
    @Published private(set) var pendingUploads = 0

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionManager()
    private let pathMonitor = NWPathMonitor()
    private let persistenceURL: URL
    private var pending: [RecordingSession] = []

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
        session = RecordingSession(batteryLevel: UIDevice.current.batteryLevel >= 0 ? UIDevice.current.batteryLevel : nil, networkType: networkType)
        statusMessage = "Recording traffic drive"
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
        startMotionUpdates()
        persist()
    }

    func stop() {
        guard var completed = session else { return }
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
        motionManager.stopDeviceMotionUpdates()
        completed.endedAt = .now
        completed.events = TrafficAnalyzer.analyze(completed.locations)
        pending.append(completed)
        session = nil
        statusMessage = "Drive saved; upload queued"
        persist()
        Task { await retryUploads() }
    }

    func restoreAndRetry() async {
        load()
        if session != nil { statusMessage = "Recovered interrupted recording" }
        await retryUploads()
    }

    private func startMotionUpdates() {
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 0.1
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let motion else { return }
            self?.append(MotionSample(timestamp: .now, x: motion.userAcceleration.x, y: motion.userAcceleration.y, z: motion.userAcceleration.z))
        }
    }

    private func append(_ motion: MotionSample) {
        guard var current = session else { return }
        current.motionSamples.append(motion)
        session = current
        if current.motionSamples.count.isMultiple(of: 50) { persist() }
    }

    private func retryUploads() async {
        guard networkType != "offline" else { return }
        for index in pending.indices.reversed() {
            guard pending[index].nextUploadAt.map({ $0 <= .now }) ?? true else { continue }
            do {
                try await UploadClient.shared.upload(MobileReport(session: pending[index], authorization: locationStatus))
                pending.remove(at: index)
                statusMessage = "Traffic report uploaded"
            } catch {
                pending[index].uploadAttempts += 1
                let delay = min(pow(2, Double(pending[index].uploadAttempts)) * 30, 3600)
                pending[index].nextUploadAt = Date.now.addingTimeInterval(delay)
                statusMessage = "Upload queued for retry"
            }
            persist()
        }
    }

    private func persist() {
        let saved = SavedSessions(active: session, pending: pending)
        if let data = try? JSONEncoder.roadAnalyzer.encode(saved) { try? data.write(to: persistenceURL, options: .atomic) }
        pendingUploads = pending.count
    }

    private func load() {
        guard let data = try? Data(contentsOf: persistenceURL), let saved = try? JSONDecoder.roadAnalyzer.decode(SavedSessions.self, from: data) else { return }
        session = saved.active
        pending = saved.pending
        pendingUploads = pending.count
    }
}

extension RecordingStore: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        locationStatus = manager.authorizationStatus
        if locationStatus == .authorizedWhenInUse { manager.requestAlwaysAuthorization() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard var current = session else { return }
        for location in locations where location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= 100 {
            current.locations.append(LocationSample(location))
        }
        session = current
        if current.locations.count.isMultiple(of: 10) { persist() }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { statusMessage = "Location error: \(error.localizedDescription)" }
}

private struct SavedSessions: Codable { let active: RecordingSession?; let pending: [RecordingSession] }

private extension JSONDecoder {
    static let roadAnalyzer: JSONDecoder = { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970; return decoder }()
}
