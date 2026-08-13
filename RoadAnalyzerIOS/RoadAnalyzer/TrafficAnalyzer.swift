import Foundation
import CoreLocation

enum TrafficAnalyzer {
    static let freeFlowSpeed = 15.0
    static let minimumEventDuration: TimeInterval = 30

    static func analyze(_ samples: [LocationSample]) -> [TrafficEvent] {
        analyze(samples, excluding: [])
    }

    /// Congestion segments, with paused spans removed. Without the exclusion a
    /// twenty-minute fuel stop reads as one twenty-minute gridlock event: the
    /// samples either side of the gap are both slow, and nothing else in the
    /// stream says the gap was deliberate.
    static func analyze(_ samples: [LocationSample], excluding pauses: [PausedInterval]) -> [TrafficEvent] {
        var events: [TrafficEvent] = []
        for span in spans(of: samples, excluding: pauses) {
            var candidate: [LocationSample] = []
            for sample in span {
                if (sample.speed ?? 0) < freeFlowSpeed {
                    candidate.append(sample)
                } else {
                    appendCandidate(candidate, to: &events)
                    candidate = []
                }
            }
            appendCandidate(candidate, to: &events)
        }
        return events
    }

    static func totalDistance(_ samples: [LocationSample]) -> Double {
        totalDistance(samples, excluding: [])
    }

    /// Distance actually driven. The pair straddling a pause is a straight line
    /// across wherever the driver went with GPS off, so it is skipped rather
    /// than counted.
    static func totalDistance(_ samples: [LocationSample], excluding pauses: [PausedInterval]) -> Double {
        spans(of: samples, excluding: pauses).reduce(0) { total, span in
            total + zip(span, span.dropFirst()).reduce(0) { running, pair in
                running + distance(pair.0.latitude, pair.0.longitude, pair.1.latitude, pair.1.longitude)
            }
        }
    }

    /// Shared great-circle distance. CLLocation is the same primitive the
    /// sample-pair walk above has always used; this exists so the detector and
    /// the anchor store do not each rebuild it.
    static func distance(_ aLatitude: Double, _ aLongitude: Double, _ bLatitude: Double, _ bLongitude: Double) -> Double {
        CLLocation(latitude: aLatitude, longitude: aLongitude)
            .distance(from: CLLocation(latitude: bLatitude, longitude: bLongitude))
    }

    /// Splits a sample stream into the runs that fall outside every paused
    /// interval, sorted by time. Also drives the map polyline, so a pause shows
    /// as a break in the route rather than a straight line across the detour.
    static func spans(of samples: [LocationSample], excluding pauses: [PausedInterval]) -> [[LocationSample]] {
        let sorted = samples.sorted { $0.timestamp < $1.timestamp }
        guard !pauses.isEmpty else { return sorted.isEmpty ? [] : [sorted] }
        // An interval left open by a kill is treated as running to the end of
        // the trace, matching the server's clamp.
        let horizon = sorted.last?.timestamp ?? .now
        var spans: [[LocationSample]] = []
        var current: [LocationSample] = []
        for sample in sorted {
            if pauses.contains(where: { $0.contains(sample.timestamp, asOf: horizon) }) {
                if !current.isEmpty { spans.append(current); current = [] }
            } else {
                current.append(sample)
            }
        }
        if !current.isEmpty { spans.append(current) }
        return spans
    }

    private static func appendCandidate(_ samples: [LocationSample], to events: inout [TrafficEvent]) {
        guard let first = samples.first, let last = samples.last,
              last.timestamp.timeIntervalSince(first.timestamp) >= minimumEventDuration else { return }
        let speeds = samples.compactMap(\.speed)
        guard !speeds.isEmpty else { return }
        let average = speeds.reduce(0, +) / Double(speeds.count)
        let severity: TrafficSeverity
        switch average {
        case 15...: severity = .freeFlow
        case 8...: severity = .slow
        case 5...: severity = .congested
        case 2.78...: severity = .heavy
        default: severity = .gridlock
        }
        events.append(TrafficEvent(startTime: first.timestamp, endTime: last.timestamp, severity: severity, averageSpeed: average, minimumSpeed: speeds.min() ?? 0, maximumSpeed: speeds.max() ?? 0, distance: totalDistance(samples)))
    }
}
