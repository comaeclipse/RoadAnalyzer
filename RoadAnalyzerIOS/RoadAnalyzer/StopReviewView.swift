import SwiftUI
import MapKit
import CoreLocation

/// Post-drive tagging for stops the driver could not answer live.
///
/// This is the primary tagging surface, not a fallback: a stop-sign stop lasts
/// two to four seconds, so the live prompt usually appears as the driver is
/// already releasing the brake. Presented as a full-screen cover because it must
/// be finished or explicitly skipped -- an accidental swipe that silently queued
/// an untagged drive would be the wrong default.
struct StopReviewView: View {
    let session: RecordingSession
    let onTag: (UUID, StopTag) -> Void
    let onFinish: () -> Void
    let onSkipRemaining: () -> Void

    @State private var selected: UUID?

    private var remaining: [StopEvent] { session.untaggedStops }
    private var current: StopEvent? {
        remaining.first { $0.id == selected } ?? remaining.first
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                map
                    .frame(maxHeight: .infinity)
                if let stop = current {
                    card(for: stop)
                } else {
                    finished
                }
            }
            .navigationTitle("Review stops")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Skip the rest", action: onSkipRemaining)
                        .disabled(remaining.isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onFinish).fontWeight(.semibold)
                }
            }
            // Tagging removes the stop from `remaining`, so the next one becomes
            // current on its own; this just keeps the camera in step.
            .onChange(of: remaining.map(\.id)) { _, ids in
                if selected == nil || !ids.contains(selected!) { selected = ids.first }
            }
            .onAppear { selected = remaining.first?.id }
        }
    }

    private var map: some View {
        Map(position: cameraBinding) {
            ForEach(Array(session.routeSpans.enumerated()), id: \.offset) { _, span in
                MapPolyline(coordinates: span).stroke(.blue, lineWidth: 4)
            }
            ForEach(Array(remaining.enumerated()), id: \.element.id) { index, stop in
                Annotation("\(index + 1)", coordinate: stop.coordinate) {
                    Circle()
                        .fill(stop.id == current?.id ? Color.red : Color.secondary)
                        .frame(width: stop.id == current?.id ? 18 : 12)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
        }
        .mapStyle(.standard)
    }

    private var cameraBinding: Binding<MapCameraPosition> {
        .constant(current.map {
            .region(MKCoordinateRegion(center: $0.coordinate, latitudinalMeters: 250, longitudinalMeters: 250))
        } ?? .automatic)
    }

    private func card(for stop: StopEvent) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Stop \((remaining.firstIndex { $0.id == stop.id } ?? 0) + 1) of \(remaining.count)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(stop.startedAt, style: .time)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Duration is both the strongest memory cue and the strongest
            // classifier: a minute-long stop is a light, a two-second one is a
            // sign.
            if let duration = stop.duration {
                Text(durationText(duration))
                    .font(.title3.weight(.medium).monospacedDigit())
            }
            if let likely = likelyTag(for: stop) {
                Text("Probably a \(likely.label.lowercased())")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(StopTag.selectable, id: \.self) { tag in
                let emphasised = likelyTag(for: stop) == tag
                Button {
                    onTag(stop.id, tag)
                } label: {
                    Label(tag.label, systemImage: tag.symbolName)
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        // The likely tag is filled, the others outlined. Drawing
                        // the background here rather than swapping ButtonStyle
                        // keeps the type concrete.
                        .foregroundStyle(emphasised ? .white : tint(for: tag))
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(tint(for: tag).opacity(emphasised ? 1 : 0.12))
                        )
                }
                .buttonStyle(.plain)
            }

            Button {
                onTag(stop.id, .skipped)
            } label: {
                Label("Not a stop — discard", systemImage: "xmark.circle")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(.secondary)
        }
        .padding()
        .background(.thinMaterial)
    }

    private var finished: some View {
        VStack(spacing: 12) {
            Label("All stops reviewed", systemImage: "checkmark.circle.fill")
                .font(.headline)
                .foregroundStyle(.green)
            Button("Queue this drive for upload", action: onFinish)
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .padding()
        .background(.thinMaterial)
    }

    private func durationText(_ duration: TimeInterval) -> String {
        duration < 60
            ? String(format: "Stopped %.0f seconds", duration)
            : String(format: "Stopped %d:%02d", Int(duration) / 60, Int(duration) % 60)
    }

    /// A rough prior from how long the car sat. Deliberately weak -- it only
    /// emphasises a button, it never answers for the driver.
    private func likelyTag(for stop: StopEvent) -> StopTag? {
        guard let duration = stop.duration else { return nil }
        if duration >= 25 { return .redLight }
        if duration <= 5 { return .stopSign }
        return nil
    }

    private func tint(for tag: StopTag) -> Color {
        switch tag {
        case .slowdown: return .orange
        case .stopSign: return .red
        case .redLight: return .pink
        case .skipped: return .gray
        }
    }
}
