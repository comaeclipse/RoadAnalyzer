import SwiftUI
import MapKit
import CoreLocation

struct ContentView: View {
    @EnvironmentObject private var store: RecordingStore
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Map(position: $camera) {
                    if let session = store.session, session.locations.count > 1 {
                        MapPolyline(coordinates: session.locations.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) })
                            .stroke(.blue, lineWidth: 5)
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
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Label("\(store.pendingUploads) pending uploads", systemImage: "arrow.up.circle") } }
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(store.session == nil ? "Ready" : "Recording", systemImage: store.session == nil ? "circle" : "record.circle.fill")
                    .foregroundStyle(store.session == nil ? .secondary : .red)
                Spacer()
                Text(store.networkType.uppercased()).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            if let session = store.session {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack {
                        Metric(title: "Duration", value: elapsed(since: session.startedAt, now: context.date))
                        Metric(title: "GPS points", value: "\(session.locations.count)")
                        Metric(title: "Distance", value: String(format: "%.1f mi", TrafficAnalyzer.totalDistance(session.locations) / 1609.344))
                    }
                }
            }
            Text(store.statusMessage).font(.footnote).foregroundStyle(.secondary)
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var controls: some View {
        Button {
            store.session == nil ? store.start() : store.stop()
        } label: {
            Label(store.session == nil ? "Start traffic drive" : "Stop and queue report", systemImage: store.session == nil ? "play.fill" : "stop.fill")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .tint(store.session == nil ? .blue : .red)
        .accessibilityHint("Recording is started and stopped manually. Completed reports upload when a network is available.")
    }

    private func elapsed(since start: Date, now: Date) -> String {
        let seconds = Int(now.timeIntervalSince(start))
        return String(format: "%02d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
    }
}

private struct Metric: View {
    let title: String
    let value: String
    var body: some View { VStack(alignment: .leading) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.headline.monospacedDigit()) }.frame(maxWidth: .infinity, alignment: .leading) }
}
