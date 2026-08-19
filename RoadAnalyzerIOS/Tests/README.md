# Detector tests

`StopDetector` and `TrafficAnalyzer` are pure value types over `LocationSample`,
so they compile for macOS and can be driven against synthetic traces without a
simulator, a car, or a red light. `run.sh` compiles the **real** sources from
`../RoadAnalyzer` — nothing is copied, so these cannot drift from what ships.

```
./RoadAnalyzerIOS/Tests/run.sh
```

The app target is unaffected: the only concession is `#if canImport(UIKit)`
around the one UIKit use in `Models.swift`.
