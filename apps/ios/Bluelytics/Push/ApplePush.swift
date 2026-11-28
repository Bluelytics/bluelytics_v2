// Alerts straight from APNs: the device token is registered with the website (`PushRegistrar` in
// the core), which sends the alerts. Nothing is registered until someone turns the switch on.
import BluelyticsCore
import UIKit
import UserNotifications

@MainActor
final class ApplePush: PushBackend {
    static let shared = ApplePush()

    var onMessage: ((AlertMessage) -> Void)?

    private let registrar = PushRegistrar()
    /// The token of this launch, once APNs has given it.
    private var token: Data?
    private var registrationFailed = false

    private init() {}

    var supported: Bool { true }

    struct NoDeviceToken: Error {}

    /// Development builds (with a provisioning profile that says so) get sandbox tokens.
    private lazy var environment: APNsEnvironment = {
        let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
        return apnsEnvironment(provisioningProfile: url.flatMap { try? Data(contentsOf: $0) })
    }()

    // MARK: From the app delegate

    func received(deviceToken: Data) {
        token = deviceToken
        registrationFailed = false
    }

    func failedToRegister() {
        registrationFailed = true
    }

    // MARK: PushBackend

    func enable() async throws -> Bool {
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        guard granted else { return false }
        try await register()
        listen()
        return true
    }

    func disable() async throws {
        // The token stays with the device; only the server forgets it.
        let current: Data
        if let token {
            current = token
        } else {
            current = try await deviceToken()
        }
        try await registrar.unregister(token: hexToken(current))
    }

    /// Every launch with alerts on: the token can change, so it is registered again.
    func resume() async throws {
        listen()
        try await register()
    }

    private func register() async throws {
        let current = try await deviceToken()
        try await registrar.register(token: hexToken(current), environment: environment)
    }

    /// Asks APNs for the token and waits for the app delegate to hand it over (10 s at most).
    private func deviceToken() async throws -> Data {
        token = nil
        registrationFailed = false
        UIApplication.shared.registerForRemoteNotifications()
        for _ in 0..<40 {
            if let token { return token }
            if registrationFailed { throw NoDeviceToken() }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        if let token { return token }
        throw NoDeviceToken()
    }

    private func listen() {
        NotificationRelay.shared.onForeground = { [weak self] message in self?.onMessage?(message) }
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
