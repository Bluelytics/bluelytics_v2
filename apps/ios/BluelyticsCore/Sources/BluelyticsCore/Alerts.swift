// Blue dollar alerts: a push notification whenever the sell price moves significantly. The device
// registers its APNs token with the website (`PushRegistrar`), which sends the alerts straight
// through APNs.
import Foundation

/// A notification that arrived while the app was open.
public struct AlertMessage: Equatable, Sendable {
    public let title: String
    public let body: String

    public init(title: String, body: String) {
        self.title = title
        self.body = body
    }
}

/// The platform side of alerts: `ApplePush` in the app, `NoPush` in previews, fakes in tests.
@MainActor
public protocol PushBackend: AnyObject {
    /// Whether this build can receive push notifications at all.
    var supported: Bool { get }

    /// Asks for permission and subscribes. `false` when the person refuses notifications.
    func enable() async throws -> Bool

    func disable() async throws

    /// Called at start when alerts are on: registers again (the token can change) and keeps
    /// foreground messages flowing to `onMessage`.
    func resume() async throws

    /// Set by the app: called with each notification that arrives while the app is open.
    var onMessage: ((AlertMessage) -> Void)? { get set }
}

@MainActor
public final class NoPush: PushBackend {
    public init() {}
    public var supported: Bool { false }
    public func enable() async throws -> Bool { false }
    public func disable() async throws {}
    public func resume() async throws {}
    public var onMessage: ((AlertMessage) -> Void)?
}

public enum AlertsProblem: Sendable {
    case denied
    case failed
}

@MainActor
public final class AlertsController {
    static let key = "alerts_enabled"

    public let backend: PushBackend
    public let prefs: Preferences
    public var onChange: (() -> Void)?

    public private(set) var enabled = false
    public private(set) var busy = false
    public private(set) var problem: AlertsProblem?

    public init(backend: PushBackend, prefs: Preferences) {
        self.backend = backend
        self.prefs = prefs
    }

    public var supported: Bool { backend.supported }

    /// Reads the saved choice (off until someone turns alerts on).
    public func initialize() async {
        guard supported else { return }
        enabled = prefs.bool(AlertsController.key) ?? false
        notify()
        if enabled {
            // On failure the last registration still stands; only the in-app banner may be lost.
            try? await backend.resume()
        }
    }

    public func setEnabled(_ value: Bool) async {
        guard !busy, supported, value != enabled else { return }
        busy = true
        problem = nil
        notify()
        do {
            if value {
                if try await backend.enable() {
                    enabled = true
                } else {
                    problem = .denied
                }
            } else {
                try await backend.disable()
                enabled = false
            }
            prefs.set(AlertsController.key, bool: enabled)
        } catch {
            problem = .failed
        }
        busy = false
        notify()
    }

    private func notify() {
        onChange?()
    }
}
