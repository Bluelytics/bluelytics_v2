import BluelyticsCore
import SwiftUI
import UIKit
import UserNotifications

@main
struct BluelyticsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model: AppModel

    init() {
        Fonts.registerIfNeeded()
        ShellAppearance.apply()
        _model = StateObject(wrappedValue: AppModel.live(push: FirebasePush.shared))
    }

    var body: some Scene {
        WindowGroup {
            AppShell()
                .environmentObject(model)
                .task {
                    // A test run hosts the app only to borrow its bundle: no network, no Firebase.
                    guard !isRunningTests else { return }
                    await model.start()
                }
        }
    }
}

/// Whether XCTest loaded this process (the screenshot tests host the app).
var isRunningTests: Bool { ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil }

/// The parts of push that need the application object: the APNs token, and notifications that
/// arrive while the app is in front.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Set before launch finishes, as Apple asks, so a tap on a notification is never lost.
        UNUserNotificationCenter.current().delegate = NotificationRelay.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in FirebasePush.shared.received(apnsToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in FirebasePush.shared.registrationFailed() }
    }
}
