import Foundation
import UserNotifications

/// The one notification this app sends: the drive ended itself.
///
/// It exists for exactly the case the in-app prompt cannot reach. A driver who
/// forgot to press Stop has walked away from the phone, so "Still driving?"
/// appears to nobody and the drive ends two minutes later in silence. Without
/// this the first they know is the next time they open the app, which might be
/// tomorrow, and a drive that ended on its own is worth knowing about at the
/// time -- both to reassure that nothing is still recording, and because a stop
/// still needing a tag is easier to remember within the hour.
///
/// Nothing else here notifies. A stop prompt is for a driver looking at the
/// screen, and turning it into a notification would train the driver to ignore
/// the one that matters.
@MainActor
enum Notifications {
    private static let autoEndIdentifier = "drive-ended-automatically"

    /// Ask once, when a drive starts.
    ///
    /// At launch the request would be unexplained; at the moment it is needed
    /// the driver is not there to answer it. Starting a drive is when it makes
    /// sense: they have just said they are recording, and this notification is
    /// about that recording finishing.
    ///
    /// Declining costs nothing but the notification.
    static func requestAuthorizationIfNeeded() {
        Task {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .notDetermined else { return }
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
    }

    /// Tell the driver the app ended the drive, when it ended, and whether
    /// anything is waiting on them.
    ///
    /// The end time is the moment the car last moved, not the moment the app
    /// noticed, so the message matches the duration the drive is recorded with.
    static func driveEndedAutomatically(at endedAt: Date, untaggedStops: Int) {
        Task {
            let center = UNUserNotificationCenter.current()
            guard await center.notificationSettings().authorizationStatus == .authorized else { return }

            let time = endedAt.formatted(date: .omitted, time: .shortened)
            let content = UNMutableNotificationContent()
            content.title = "Drive ended"
            content.body = untaggedStops > 0
                ? "The car had not moved for a while, so recording stopped at \(time). \(untaggedStops) stop\(untaggedStops == 1 ? "" : "s") still to tag."
                : "The car had not moved for a while, so recording stopped at \(time)."
            content.sound = .default

            // A fixed identifier, so a second auto-end replaces the first rather
            // than stacking. There is only ever one most-recent drive to report.
            try? await center.add(UNNotificationRequest(
                identifier: autoEndIdentifier,
                content: content,
                trigger: nil
            ))
        }
    }
}
