import Foundation
import CoreLocation

enum TrafficAnalyzer {
    static let freeFlowSpeed = 15.0
    static let minimumEventDuration: TimeInterval = 30

    static func analyze(_ samples: [LocationSample]) -> [TrafficEvent] {
        let sorted = samples.sorted { $0.timestamp < $1.timestamp }
        var events: [TrafficEvent] = []
        var candidate: [LocationSample] = []
        for sample in sorted {
            if (sample.speed ?? 0) < freeFlowSpeed {
                candidate.append(sample)
            } else {
                appendCandidate(candidate, to: &events)
                candidate = []
            }
        }
        appendCandidate(candidate, to: &events)
        return events
    }

    static func totalDistance(_ samples: [LocationSample]) -> Double {
        zip(samples, samples.dropFirst()).reduce(0) { total, pair in
            total + CLLocation(latitude: pair.0.latitude, longitude: pair.0.longitude)
                .distance(from: CLLocation(latitude: pair.1.latitude, longitude: pair.1.longitude))
        }
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
