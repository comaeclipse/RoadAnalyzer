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
    /// Human answers an anchor needs before the app will apply its tag without
    /// asking. A stop sign is deterministic and a red light's identity is fixed,
    /// so a few consistent answers is plenty; the point is only to be sure this
    /// is that junction and not a one-off pull-over that happened to sit here.
    static let autoTagMinAnswers = 3
    /// Share of those answers that must agree on one tag. A junction with a mixed
    /// history -- sometimes a red light, sometimes just a crawl the driver calls
    /// a slowdown -- never clears this and keeps prompting rather than guessing.
    static let autoTagMinShare = 0.8
    /// Even a settled anchor prompts every Nth visit. Auto-tags do not vote on
    /// the anchor, so without this a junction that changed -- a light removed, a
    /// stop sign added -- would be asserted from stale history forever; the
    /// periodic prompt is what lets the driver's answer catch up.
    static let reverifyInterval = 10

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
        // A fresh human answer -- the whole point of a re-verify prompt -- starts
        // the auto-tag streak over, so the anchor stays current.
        anchor.autoTagStreak = 0
        anchors[index] = anchor
        persist()
        return anchor.id
    }

    /// The tag to apply at this stop without asking, or nil to prompt.
    ///
    /// An anchor auto-resolves only once enough of the driver's own answers agree,
    /// and they agree strongly. Every `reverifyInterval`-th visit it returns nil
    /// anyway so the stop is prompted and the answer refreshes the anchor -- a
    /// junction that changed is re-confirmed, never asserted from memory.
    ///
    /// Deliberately does not vote on the anchor: an auto-tag reinforcing its own
    /// dominant tag would inflate confidence and blind the app to change. It only
    /// advances the streak, so the caller must persist. Returns nil for a stop
    /// too poorly placed to match, exactly as `match` and `resolve` do.
    func autoResolve(for stop: StopEvent) -> (tag: StopTag, anchorId: UUID)? {
        guard let heading = stop.heading, stop.accuracy <= Self.maxUsableAccuracy,
              let matched = match(latitude: stop.latitude, longitude: stop.longitude, heading: heading, accuracy: stop.accuracy),
              let index = anchors.firstIndex(where: { $0.id == matched.id }) else { return nil }

        var anchor = anchors[index]
        let total = anchor.tagCounts.values.reduce(0, +)
        guard total >= Self.autoTagMinAnswers,
              let (topKey, topCount) = anchor.tagCounts.max(by: { $0.value < $1.value }),
              Double(topCount) / Double(total) >= Self.autoTagMinShare,
              let tag = StopTag(rawValue: topKey), tag.anchors else { return nil }

        // Time to re-check: leave the streak pinned and prompt. The driver's
        // answer runs through `resolve`, which resets it and settles the anchor
        // again. If they dismiss instead, it stays pinned and keeps asking -- the
        // safe direction is to ask, not to assert.
        let streak = anchor.autoTagStreak ?? 0
        guard streak < Self.reverifyInterval else { return nil }

        anchor.autoTagStreak = streak + 1
        anchor.lastSeenAt = max(anchor.lastSeenAt, stop.startedAt)
        anchors[index] = anchor
        persist()
        return (tag, anchor.id)
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
