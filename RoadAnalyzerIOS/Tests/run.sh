#!/bin/bash
# Compile the real detector sources for macOS and run the synthetic traces.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc -O \
  "$here/../RoadAnalyzer/Models.swift" \
  "$here/../RoadAnalyzer/TrafficAnalyzer.swift" \
  "$here/../RoadAnalyzer/StopDetector.swift" \
  "$here/main.swift" \
  -o "$out/tests"
"$out/tests"
