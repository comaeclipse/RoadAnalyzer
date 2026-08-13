import UIKit

/// Feedback for the stop prompt.
///
/// The generators are long-lived on purpose. Creating one per call defeats
/// `prepare()` entirely, and the 100-200 ms Taptic spin-up that prepare
/// amortizes is exactly the delay that would make the buzz arrive after the
/// prompt is already on screen.
@MainActor
enum Haptics {
    private static let notification = UINotificationFeedbackGenerator()
    private static let impact = UIImpactFeedbackGenerator(style: .rigid)

    /// Called when a stop candidate opens, about two seconds before it can
    /// confirm -- which is what buys the engine time to wake up.
    static func prepare() {
        guard isActive else { return }
        notification.prepare()
        impact.prepare()
    }

    /// A stop confirmed and the prompt is appearing. `.warning` is a
    /// distinctive double tap that reads as "attention" through a car mount.
    static func stopDetected() {
        guard isActive else { return }
        notification.notificationOccurred(.warning)
    }

    /// The driver's tag registered. Short and crisp, clearly a confirmation
    /// rather than another alert.
    static func tagConfirmed() {
        guard isActive else { return }
        impact.impactOccurred()
    }

    /// UIFeedbackGenerator is a no-op unless the app is foreground-active, so
    /// the guard is honesty rather than optimization: with the screen locked in
    /// a mount there is no haptic and no prompt, and the stop is caught by the
    /// post-trip review instead.
    private static var isActive: Bool {
        UIApplication.shared.applicationState == .active
    }
}
