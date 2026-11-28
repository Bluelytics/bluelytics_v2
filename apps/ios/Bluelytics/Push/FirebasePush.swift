// Alerts over Firebase Cloud Messaging. Firebase is only started when alerts are (being turned) on,
// so a device that never asks for alerts never talks to Firebase. Method swizzling is off
// (Info.plist `FirebaseAppDelegateProxyEnabled`): the APNs token is handed over here.
import BluelyticsCore
import FirebaseCore
import FirebaseMessaging
import UIKit
import UserNotifications

@MainActor
final class FirebasePush: PushBackend {
    static let shared = FirebasePush()

    var onMessage: ((AlertMessage) -> Void)?

    private var apnsToken: Data?
    private var registrationError = false

    private init() {}

    var supported: Bool { true }

    private struct NoAPNsToken: Error {}

    private func messaging() -> Messaging {
        if FirebaseApp.app() == nil { FirebaseApp.configure() }
        let messaging = Messaging.messaging()
        if let apnsToken, messaging.apnsToken == nil { messaging.apnsToken = apnsToken }
        return messaging
    }

    /// From the app delegate.
    func received(apnsToken token: Data) {
        apnsToken = token
        registrationError = false
        if FirebaseApp.app() != nil { Messaging.messaging().apnsToken = token }
    }

    func registrationFailed() {
        registrationError = true
    }

    func enable() async throws -> Bool {
        let messaging = self.messaging()
        // Off in Info.plist: no FCM token exists until someone asks for alerts.
        messaging.isAutoInitEnabled = true
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        guard granted else { return false }
        try await registerWithAPNs()
        try await subscribe(messaging, true)
        listen()
        return true
    }

    func disable() async throws {
        let messaging = self.messaging()
        try await subscribe(messaging, false)
        messaging.isAutoInitEnabled = false
    }

    func resume() async throws {
        let messaging = self.messaging()
        // Keeps the token fresh, also for devices that carried their subscription over from version 1.
        messaging.isAutoInitEnabled = true
        UIApplication.shared.registerForRemoteNotifications()
        listen()
    }

    private func listen() {
        NotificationRelay.shared.onForeground = { [weak self] message in self?.onMessage?(message) }
    }

    /// A topic subscription needs the APNs token, which arrives a moment after registering.
    private func registerWithAPNs() async throws {
        registrationError = false
        UIApplication.shared.registerForRemoteNotifications()
        for _ in 0..<40 {
            if apnsToken != nil { break }
            if registrationError { throw NoAPNsToken() }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        guard let apnsToken else { throw NoAPNsToken() }
        Messaging.messaging().apnsToken = apnsToken
    }

    private func subscribe(_ messaging: Messaging, _ on: Bool) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // Closure literals, so they are inferred @Sendable as Firebase's completion asks; they
            // capture only the continuation, which is Sendable.
            if on {
                messaging.subscribe(toTopic: alertsTopic) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            } else {
                messaging.unsubscribe(fromTopic: alertsTopic) { error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
            }
        }
    }

    /// The React Native app (versions 1.x) kept its switch in AsyncStorage files.
    func legacyEnabled() async throws -> Bool? {
        let files = FileManager.default
        guard let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
              let documents = files.urls(for: .documentDirectory, in: .userDomainMask).first
        else { return nil }
        return legacyAlertsEnabled(candidates: legacyManifestCandidates(applicationSupport: support, documents: documents))
    }
}

/// The notification centre's delegate: shows alerts while the app is open, as banners, and passes
/// them on so the app refreshes the price and shows its own banner too.
final class NotificationRelay: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRelay()

    /// Set once alerts are on; called on the main thread.
    var onForeground: ((AlertMessage) -> Void)?

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let content = notification.request.content
        let message = AlertMessage(title: content.title, body: content.body)
        DispatchQueue.main.async { [weak self] in self?.onForeground?(message) }
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // A tap opens the app on the screen it was on; the refresh on becoming active does the rest.
        completionHandler()
    }
}
