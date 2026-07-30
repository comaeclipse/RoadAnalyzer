import SwiftUI

@main
struct RoadAnalyzerApp: App {
    @StateObject private var recordingStore = RecordingStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(recordingStore)
                .task { await recordingStore.restoreAndRetry() }
        }
    }
}
