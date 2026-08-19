import SwiftUI

/// "Are you still driving?" — the one question that stands between a forgotten
/// drive and a recording that runs until the battery dies.
///
/// Deliberately harder to ignore than the stop prompt, and deliberately not
/// dismissible: ignoring it *is* an answer, and the answer it gives is the one
/// the driver wants. Letting it be swiped away would leave the drive running,
/// which is the failure this exists to prevent.
///
/// The countdown is shown because a prompt that ends a drive silently at some
/// unstated moment is alarming; one that says how long you have is not.
struct StillDrivingOverlay: View {
    let prompt: StillDrivingPrompt
    let now: Date
    let onKeepDriving: () -> Void
    let onEndDrive: () -> Void

    private var secondsLeft: Int {
        max(0, Int(prompt.deadline.timeIntervalSince(now).rounded(.up)))
    }

    var body: some View {
        VStack(spacing: 12) {
            header
            Button(action: onKeepDriving) {
                Label("Still driving", systemImage: "car.fill")
                    .font(.title2.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 72)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .accessibilityHint("Keeps recording and stops asking for twenty minutes.")

            Button(action: onEndDrive) {
                Label("End the drive", systemImage: "stop.fill")
                    .font(.title2.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 72)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .accessibilityHint("Ends the drive where the car last moved.")
        }
        .padding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    private var header: some View {
        VStack(spacing: 6) {
            Label("Still driving?", systemImage: "questionmark.circle.fill")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("The car has not moved for a while. The drive will end by itself in \(secondsLeft)s, at the point it stopped moving.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("The car has not moved for a while. The drive will end by itself in \(secondsLeft) seconds, at the point it stopped moving.")
        }
    }
}
