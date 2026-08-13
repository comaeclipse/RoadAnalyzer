import SwiftUI

/// The in-drive tagging prompt.
///
/// Everything here is sized for a driver glancing at a mounted phone for about
/// two seconds: three stacked targets, no scrolling, no text entry, and no
/// dismiss gesture other than an explicit one. It only ever appears while the
/// vehicle is stationary, because a detected stop is what triggers it.
struct StopPromptOverlay: View {
    let prompt: StopPrompt
    let onTag: (StopTag) -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            header
            ForEach(StopTag.selectable, id: \.self) { tag in
                Button {
                    onTag(tag)
                } label: {
                    Label(tag.label, systemImage: tag.symbolName)
                        .font(.title2.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 72)
                }
                .buttonStyle(.borderedProminent)
                .tint(tint(for: tag))
                .accessibilityLabel("Tag this stop as \(tag.label)")
            }
            Button("Not now", action: onDismiss)
                .font(.callout.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .accessibilityHint("Leaves the stop untagged for the post-drive review.")
        }
        .padding(20)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(.horizontal, 12)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }

    private var header: some View {
        VStack(spacing: 6) {
            HStack {
                Label("Stop detected", systemImage: "hand.raised.fill")
                    .font(.headline)
                Spacer()
                if let suggested = prompt.suggestedTag {
                    // A hint, not a pre-selection: the driver still chooses.
                    Text("Usually: \(suggested.label)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            countdown
        }
    }

    /// Follows the TimelineView precedent already used for the duration
    /// readout, so the bar drains smoothly without a stored timer.
    private var countdown: some View {
        TimelineView(.animation) { context in
            let total = prompt.deadline.timeIntervalSince(prompt.shownAt)
            let left = max(0, prompt.deadline.timeIntervalSince(context.date))
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary)
                    Capsule()
                        .fill(left < 5 ? Color.orange : Color.accentColor)
                        .frame(width: geometry.size.width * (total > 0 ? left / total : 0))
                }
            }
            .frame(height: 4)
            .accessibilityHidden(true)
        }
        .frame(height: 4)
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
