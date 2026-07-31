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
    private var isUploading = false

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

    private func handleAuthorizationChange(_ status: CLAuthorizationStatus) {
        locationStatus = status
        if status == .authorizedWhenInUse { locationManager.requestAlwaysAuthorization() }
    }

    private func append(_ samples: [LocationSample]) {
        guard var current = session else { return }
        current.locations.append(contentsOf: samples)
        session = current
        if current.locations.count.isMultiple(of: 10) { persist() }
    }

    private func append(_ motion: MotionSample) {
        guard var current = session else { return }
        current.motionSamples.append(motion)
        session = current
        if current.motionSamples.count.isMultiple(of: 50) { persist() }
    }

    private func retryUploads() async {
        // A pending session is only removed once its upload finishes, so a second
        // call arriving mid-flight (a Wi-Fi to cellular switch fires the path
        // handler) would post the same report twice. The flag is read and set
        // without an await in between, so the main actor makes this check atomic.
        guard networkType != "offline", !isUploading else { return }
        isUploading = true
        defer { isUploading = false }
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

// CLLocationManagerDelegate requirements are nonisolated, so each callback hands
// only Sendable values to the main actor rather than touching state directly.
extension RecordingStore: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in self?.handleAuthorizationChange(status) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let samples = locations
            .filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 100 }
            .map(LocationSample.init)
        guard !samples.isEmpty else { return }
        Task { @MainActor [weak self] in self?.append(samples) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor [weak self] in self?.statusMessage = "Location error: \(message)" }
    }
}

private struct SavedSessions: Codable { let active: RecordingSession?; let pending: [RecordingSession] }

private extension JSONDecoder {
    static let roadAnalyzer: JSONDecoder = { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970; return decoder }()
}
