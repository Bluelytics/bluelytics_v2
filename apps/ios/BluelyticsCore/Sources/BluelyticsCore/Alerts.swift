// Blue dollar alerts: a push notification whenever the sell price moves significantly. The device
// subscribes to an FCM topic; the sender is the jobs Worker (apps/jobs/src/alerts.ts).
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

/// The platform side of alerts: `FirebasePush` in the app, `NoPush` in previews, fakes in tests.
@MainActor
public protocol PushBackend: AnyObject {
    /// Whether this build can receive push notifications at all.
    var supported: Bool { get }

    /// Asks for permission and subscribes. `false` when the person refuses notifications.
    func enable() async throws -> Bool

    func disable() async throws

    /// Called at start when alerts are on: keeps foreground messages flowing to `onMessage`.
    func resume() async throws

    /// Whether the React Native app (versions 1.x) had alerts on, or `nil` when it left no trace.
    func legacyEnabled() async throws -> Bool?

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
    public func legacyEnabled() async throws -> Bool? { nil }
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

    /// Reads the saved choice. On the first run after an update from the React Native app it
    /// carries over that app's choice: a device that was subscribed stays subscribed, and the
    /// switch must say so.
    public func initialize() async {
        guard supported else { return }
        guard let saved = prefs.bool(AlertsController.key) else { return await firstRun() }
        enabled = saved
        notify()
        if enabled {
            // On failure notifications still arrive through the system; only the in-app banner is lost.
            try? await backend.resume()
        }
    }

    private func firstRun() async {
        let legacy = ((try? await backend.legacyEnabled()) ?? nil) ?? false
        enabled = legacy
        prefs.set(AlertsController.key, bool: legacy)
        notify()
        guard legacy else { return }
        // Version 1 asked for permission on its own terms; turning alerts on again makes sure the
        // permission and the APNs registration are there. The subscription itself already is.
        do {
            if try await backend.enable() { return }
        } catch {
            // Offline, for instance: the device is still subscribed from before.
            return
        }
        // Refused: off, and no point in receiving what cannot be shown.
        enabled = false
        prefs.set(AlertsController.key, bool: false)
        notify()
        try? await backend.disable()
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

/// The React Native app kept its switch in AsyncStorage under `subState` (`"true"`/`"false"`), in a
/// `manifest.json` that is one of `candidates`. `nil` when none of them says anything.
public func legacyAlertsEnabled(candidates: [URL]) -> Bool? {
    for url in candidates {
        guard let data = try? Data(contentsOf: url) else { continue }
        guard let manifest = try? JSON.parse(data) else { continue }
        if let value = manifest["subState"]?.string { return value == "true" }
    }
    return nil
}

/// Where AsyncStorage (React Native 0.69) put its manifest: under Application Support, in a folder
/// named after the bundle id or not, or in Documents for older versions.
public func legacyManifestCandidates(applicationSupport: URL, documents: URL) -> [URL] {
    [
        applicationSupport.appendingPathComponent(bundleId).appendingPathComponent("RCTAsyncLocalStorage_V1/manifest.json"),
        applicationSupport.appendingPathComponent("RCTAsyncLocalStorage_V1/manifest.json"),
        documents.appendingPathComponent("RCTAsyncLocalStorage_V1/manifest.json"),
    ]
}
