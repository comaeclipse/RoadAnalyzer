import SwiftUI
import MapKit
import CoreLocation

struct ContentView: View {
    @EnvironmentObject private var store: RecordingStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var camera: MapCameraPosition = .automatic
    @State private var showingReview = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Map(position: $camera) {
                    // Spans come from the store already built. Deriving them
                    // here re-walked and re-sorted the entire trace on every
                    // publish, which at 10 Hz was most of the app's CPU time.
                    ForEach(Array(store.routeSpans.enumerated()), id: \.offset) { _, span in
                        MapPolyline(coordinates: span).stroke(.blue, lineWidth: 5)
                    }
                    UserAnnotation()
                }
                .mapStyle(.standard)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .frame(maxHeight: .infinity)

                statusCard
                controls
            }
            .padding()
            .navigationTitle("Traffic Recorder")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { queueIndicator } }
            // An overlay, not a sheet: presentation is instant, the map stays
            // visible, and there is no swipe-to-dismiss to fumble at a light.
            .overlay(alignment: .bottom) {
                if let prompt = store.activePrompt {
                    StopPromptOverlay(
                        prompt: prompt,
                        onTag: { store.tagActivePrompt($0) },
                        onDismiss: { store.dismissActivePrompt() }
                    )
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: store.activePrompt?.stopEventId)
        }
        .onChange(of: scenePhase) { _, phase in
            // A prompt whose deadline passed while the app was backgrounded is
            // for a stop the driver no longer remembers. Drop it rather than
            // inviting a guess.
            if phase == .active { store.expireStalePrompt() }
        }
        .onChange(of: store.reviewSession?.id) { _, id in showingReview = id != nil }
        .onAppear { showingReview = store.reviewSession != nil }
        .fullScreenCover(isPresented: $showingReview) {
            if let review = store.reviewSession {
                StopReviewView(
                    session: review,
                    onTag: { store.tagStop(id: $0, tag: $1) },
                    onFinish: { store.finishReview() },
                    onSkipRemaining: { store.skipRemainingReview() }
                )
            }
        }
    }

    // A toolbar Label renders icon-only, which hid the queue depth entirely --
    // the one number that says whether a finished drive actually got off the
    // phone. Show it, and let a tap bypass the backoff.
    private var queueIndicator: some View {
        Button {
            // A drive held for review is not retryable, it is answerable --
            // send the tap to the review screen instead of the upload queue.
            if store.reviewSession != nil { showingReview = true } else { store.retryNow() }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: queueSymbol)
                Text("\(store.pendingUploads)").font(.callout.monospacedDigit().weight(.medium))
            }
        }
        .tint(queueTint)
        .accessibilityLabel(queueAccessibilityLabel)
        .accessibilityHint(store.reviewSession == nil ? "Retries queued uploads immediately." : "Opens the stop review for the finished drive.")
    }

    private var queueSymbol: String {
        if store.reviewSession != nil { return "hand.tap" }
        return store.rejectedUploads > 0 ? "exclamationmark.arrow.triangle.2.circlepath" : "arrow.up.circle"
    }

    private var queueTint: Color {
        if store.reviewSession != nil { return .purple }
        if store.rejectedUploads > 0 { return .orange }
        return store.pendingUploads > 0 ? .blue : .secondary
    }

    private var queueAccessibilityLabel: String {
        if let review = store.reviewSession {
            return "\(review.untaggedStops.count) stops waiting to be tagged"
        }
        return "\(store.pendingUploads) uploads queued\(store.rejectedUploads > 0 ? ", \(store.rejectedUploads) rejected" : "")"
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(stateLabel, systemImage: stateSymbol)
                    .foregroundStyle(stateColor)
                Spacer()
                Text(store.networkType.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            if let live = store.live {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    // Duration and distance both exclude paused spans, so the
                    // readouts match what actually gets uploaded.
                    let paused = live.pausedDuration(asOf: context.date)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Metric(title: "Duration", value: clock(context.date.timeIntervalSince(live.startedAt) - paused))
                            Metric(title: "GPS points", value: "\(live.locationCount)")
                            Metric(title: "Distance", value: String(format: "%.1f mi", live.distance / 1609.344))
                        }
                        HStack {
                            Metric(title: "Stops tagged", value: "\(live.taggedStops)/\(live.promptedStops)")
                            if paused > 0 { Metric(title: "Paused", value: clock(paused)) }
                        }
                    }
                }
            }
            Text(store.statusMessage).font(.footnote).foregroundStyle(.secondary)
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder
    private var controls: some View {
        if store.live == nil {
            Button {
                store.start()
            } label: {
                Label("Start traffic drive", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .accessibilityHint("Recording is started and stopped manually. Completed reports upload when a network is available.")
        } else {
            HStack(spacing: 12) {
                Button {
                    store.isPaused ? store.resume() : store.pause()
                } label: {
                    Label(store.isPaused ? "Resume" : "Pause", systemImage: store.isPaused ? "play.fill" : "pause.fill")
                        .frame(width: 110)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(store.isPaused ? .green : .orange)
                .accessibilityHint(store.isPaused
                    ? "Turns GPS back on and continues the drive."
                    : "Turns GPS off and marks the gap as deliberate, for pulling over.")

                // Stop stays trailing in both states so the muscle memory of
                // reaching for the right-hand button never changes meaning.
                Button {
                    store.stop()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .accessibilityHint("Ends the drive. Any untagged stops open for review before the report uploads.")
            }
        }
    }

    private func clock(_ interval: TimeInterval) -> String {
        let seconds = max(0, Int(interval))
        return String(format: "%02d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
    }

    private var stateLabel: String {
        if store.live == nil { return "Ready" }
        return store.isPaused ? "Paused" : "Recording"
    }

    private var stateSymbol: String {
        if store.live == nil { return "circle" }
        return store.isPaused ? "pause.circle.fill" : "record.circle.fill"
    }

    private var stateColor: Color {
        if store.live == nil { return .secondary }
        return store.isPaused ? .orange : .red
    }
}

private struct Metric: View {
    let title: String
    let value: String
    var body: some View { VStack(alignment: .leading) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.headline.monospacedDigit()) }.frame(maxWidth: .infinity, alignment: .leading) }
}
