import Foundation
import CoreLocation

// Synthetic traces against the real StopDetector. See README.md.
//
// Named main.swift because Swift only allows top-level code in a file with
// that name; there is no test framework here and nothing to discover.

var failures = 0
var checks = 0

func expect(_ condition: Bool, _ what: String) {
    checks += 1
    if condition {
        print("  ok   \(what)")
    } else {
        failures += 1
        print("  FAIL \(what)")
    }
}

let metrePerLat = 1.0 / 111_320.0
let origin = (lat: 30.4400, lng: -87.2600)

/// A fix `northOf` metres up the road, at `speed`, `at` seconds into the trace.
func fix(_ northOf: Double, speed: Double, at seconds: TimeInterval, heading: Double? = 0) -> LocationSample {
    LocationSample(CLLocation(
        coordinate: CLLocationCoordinate2D(latitude: origin.lat + northOf * metrePerLat, longitude: origin.lng),
        altitude: 0,
        horizontalAccuracy: 5,
        verticalAccuracy: 5,
        course: heading ?? -1,
        courseAccuracy: 5,
        speed: speed,
        speedAccuracy: 1,
        timestamp: Date(timeIntervalSince1970: 1_780_000_000 + seconds)
    ))
}

extension StopDetector.Effect {
    func collect(into events: inout [StopEvent]) {
        if case .confirmed(let event) = self { events.append(event) }
    }
}

/// A car moving up one straight road, feeding the real detector.
///
/// Holds its own position and clock so a sequence of stops reads in the order it
/// happened, rather than each fixture having to work out its own timestamps.
struct Driver {
    var detector = StopDetector()
    var position = 0.0
    var time: TimeInterval = 0
    var confirmed: [StopEvent] = []

    private mutating func feed(_ sample: LocationSample) {
        detector.ingest(sample).collect(into: &confirmed)
        detector.tick(now: sample.timestamp).collect(into: &confirmed)
        time += 1
    }

    /// Drive `metres` further on at speed.
    mutating func drive(_ metres: Double, speed: Double = 12) {
        let target = position + metres
        while position < target - 0.5 {
            position = min(target, position + speed)
            feed(fix(position, speed: speed, at: time))
        }
    }

    /// Brake to a halt where the car is, wait, then pull away.
    ///
    /// `pullAwayBy` is how far the car goes before the next fixture takes over:
    /// leaving a stop needs more than 30 m and more than 6 m/s, so anything less
    /// is still the same stop as far as the detector is concerned.
    mutating func stopHere(for seconds: TimeInterval, pullAwayBy: Double = 40) {
        for speed in [8.0, 4.0, 1.0] { feed(fix(position, speed: speed, at: time)) }
        let until = time + seconds
        while time < until { feed(fix(position, speed: 0, at: time)) }
        drive(pullAwayBy)
    }
}

print("cooldown suppression")
do {
    // The reported bug: two lights a few hundred metres apart, the second
    // reached inside the 45 s window. Both are real stops.
    var driver = Driver()
    driver.drive(200)
    driver.stopHere(for: 20)
    driver.drive(210)
    driver.stopHere(for: 20)

    expect(driver.confirmed.count == 2, "two junctions 250 m apart both confirm (got \(driver.confirmed.count))")
    expect(driver.confirmed.allSatisfy { $0.suppressed != true },
           "neither is suppressed (suppressed: \(driver.confirmed.map { $0.suppressed == true }))")
}

do {
    // What the cooldown is for: pulling forward in a queue and stopping again a
    // few car lengths on, inside the 50 m radius, within the window.
    var driver = Driver()
    driver.drive(200)
    driver.stopHere(for: 20, pullAwayBy: 35)
    driver.stopHere(for: 20)

    expect(driver.confirmed.count == 2, "a creep confirms a second stop (got \(driver.confirmed.count))")
    expect(driver.confirmed.last?.suppressed == true, "but it is suppressed, so it does not prompt")
}

do {
    // Cluster suppression is untouched: enough stops inside three minutes and
    // 200 m and it is a jam, not a run of junctions. Spaced beyond the cooldown
    // radius so it is the cluster rule being tested and not the other one.
    var driver = Driver()
    driver.drive(100)
    driver.stopHere(for: 3, pullAwayBy: 60)
    driver.stopHere(for: 3, pullAwayBy: 60)
    driver.stopHere(for: 3, pullAwayBy: 60)
    driver.stopHere(for: 3)

    expect(driver.confirmed.count == 4, "four stops in a jam all confirm (got \(driver.confirmed.count))")
    expect(driver.confirmed.last?.suppressed == true, "the last is suppressed as a cluster")
    expect(driver.confirmed.first?.suppressed != true, "the first still prompts")
}

print("\nbasics still hold")
do {
    var driver = Driver()
    driver.drive(200)
    driver.stopHere(for: 20)
    expect(driver.confirmed.count == 1, "one stop for one light (got \(driver.confirmed.count))")
    expect(driver.confirmed.first?.suppressed != true, "and it prompts")
}

do {
    // Below the two-second floor there is no stop to report.
    var driver = Driver()
    driver.drive(200)
    driver.stopHere(for: 0)
    expect(driver.confirmed.isEmpty, "a roll-through is not a stop (got \(driver.confirmed.count))")
}

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
