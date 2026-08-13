import Foundation

/// Device-local clustering of stops into approaches.
///
/// This lives in its own file on disk rather than inside SavedSessions for
/// three reasons: RecordingStore rewrites that file every tenth GPS sample and
/// anchors have no business riding that cadence; pending sessions are removed
/// once uploaded, so cross-session identity cannot live in a structure that
/// drains; and a failed read there is swallowed silently, which would take the
/// anchor history with it.
///
/// The server resolves the real intersection from the road graph. An anchor is
/// only the claim "this is the same spot, approached the same way, as before" --
/// which is enough to pre-select the tag the driver last used here.
@MainActor
final class AnchorStore {
    /// Two stops further apart than this are different junctions.
    static let matchRadius = 25.0
    /// The opposing stop bar at a small four-way is inside `matchRadius`, so
    /// without a heading test northbound and southbound would collapse into one
    /// anchor and approach direction -- the point of the exercise -- would be
    /// lost.
    static let headingTolerance = 45.0
    /// A fix worse than this may not create or move an anchor.
    static let maxUsableAccuracy = 25.0
    /// A fix worse than this may still contribute its label, but not its
    /// position.
    static let maxCentroidAccuracy = 20.0
    /// Weight floor on the running mean, so one bad fix cannot drag an
    /// established anchor.
    static let centroidWeightFloor = 20
    /// One-off anchors older than this are noise.
    static let pruneAge: TimeInterval = 180 * 24 * 3600

    private(set) var anchors: [StopAnchor] = []
    private let persistenceURL: URL

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        persistenceURL = base.appending(path: "stop-anchors.json")
        load()
    }

    /// The anchor a stop would join, if any. Read before the driver has
    /// answered, so the prompt can suggest what they said here last time.
    func match(latitude: Double, longitude: Double, heading: Double?, accuracy: Double) -> StopAnchor? {
        guard let heading, accuracy <= Self.maxUsableAccuracy else { return nil }
        // Cheap bounding box before paying for the great-circle distance.
        let latitudeWindow = 0.00025
        let longitudeWindow = latitudeWindow / max(0.01, cos(latitude * .pi / 180))
        return anchors
            .filter { abs($0.latitude - latitude) <= latitudeWindow && abs($0.longitude - longitude) <= longitudeWindow }
            .filter { anchor in
                guard let mean = anchor.meanHeading, Self.headingDelta(mean, heading) <= Self.headingTolerance else { return false }
                return TrafficAnalyzer.distance(anchor.latitude, anchor.longitude, latitude, longitude) <= Self.matchRadius
            }
            .min {
                TrafficAnalyzer.distance($0.latitude, $0.longitude, latitude, longitude) <
                TrafficAnalyzer.distance($1.latitude, $1.longitude, latitude, longitude)
            }
    }

    /// Attach a tagged stop to an anchor, creating one if this approach is new.
    /// Returns nil when the stop is not anchorable -- a slowdown, or a fix too
    /// poor to place. The server can still resolve those from the road graph.
    @discardableResult
    func resolve(for stop: StopEvent, tag: StopTag) -> UUID? {
        guard tag.anchors, let heading = stop.heading, stop.accuracy <= Self.maxUsableAccuracy else { return nil }

        guard var anchor = match(latitude: stop.latitude, longitude: stop.longitude, heading: heading, accuracy: stop.accuracy),
              let index = anchors.firstIndex(where: { $0.id == anchor.id }) else {
            let created = StopAnchor(
                id: UUID(),
                latitude: stop.latitude,
                longitude: stop.longitude,
                headingSin: sin(heading * .pi / 180),
                headingCos: cos(heading * .pi / 180),
                sampleCount: 1,
                firstSeenAt: stop.startedAt,
                lastSeenAt: stop.startedAt,
                tagCounts: [tag.rawValue: 1]
            )
            anchors.append(created)
            persist()
            return created.id
        }

        // The label is trustworthy even when the position is not, so a poor fix
        // still votes on the tag; it just does not move the centroid.
        if stop.accuracy <= Self.maxCentroidAccuracy {
            let weight = 1.0 / Double(min(anchor.sampleCount + 1, Self.centroidWeightFloor))
            anchor.latitude += weight * (stop.latitude - anchor.latitude)
            anchor.longitude += weight * (stop.longitude - anchor.longitude)
            anchor.headingSin += sin(heading * .pi / 180)
            anchor.headingCos += cos(heading * .pi / 180)
            anchor.sampleCount += 1
        }
        anchor.lastSeenAt = max(anchor.lastSeenAt, stop.startedAt)
        anchor.tagCounts[tag.rawValue, default: 0] += 1
        anchors[index] = anchor
        persist()
        return anchor.id
    }

    /// Smallest circular difference between two bearings, mirroring the
    /// headingDelta used server-side in lib/map-matching.ts.
    static func headingDelta(_ a: Double, _ b: Double) -> Double {
        abs((b - a + 540).truncatingRemainder(dividingBy: 360) - 180)
    }

    // MARK: - Persistence

    private struct SavedAnchors: Codable {
        var version: Int
        var anchors: [StopAnchor]
    }

    private func load() {
        guard let data = try? Data(contentsOf: persistenceURL),
              let saved = try? JSONDecoder.roadAnalyzerAnchors.decode(SavedAnchors.self, from: data) else { return }
        let cutoff = Date.now.addingTimeInterval(-Self.pruneAge)
        // Anything seen exactly once and long ago was probably a one-off pull
        // over, not a junction worth remembering.
        anchors = saved.anchors.filter { $0.sampleCount > 1 || $0.lastSeenAt >= cutoff }
    }

    private func persist() {
        let saved = SavedAnchors(version: 1, anchors: anchors)
        guard let data = try? JSONEncoder.roadAnalyzerAnchors.encode(saved) else { return }
        try? data.write(to: persistenceURL, options: .atomic)
    }
}

private extension JSONDecoder {
    static let roadAnalyzerAnchors: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()
}

private extension JSONEncoder {
    static let roadAnalyzerAnchors: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return encoder
    }()
}
