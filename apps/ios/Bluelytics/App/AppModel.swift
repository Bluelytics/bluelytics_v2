// The app's three long-lived objects (BluelyticsCore), wrapped so SwiftUI redraws when any of them
// changes. The core cannot use Combine (it also builds on Linux), so each one reports changes
// through a closure that becomes `objectWillChange` here.
import BluelyticsCore
import Combine
import SwiftUI
import UIKit

@MainActor
final class AppModel: ObservableObject {
    let store: AppStore
    let settings: BluelyticsCore.Settings
    let alerts: AlertsController

    /// An alert that arrived while the app is open.
    @Published var banner: AlertMessage?
    /// The disk cache has been read: until then the screen stays on the launch colour.
    @Published private(set) var restored = false

    private var bannerTimer: DispatchWorkItem?

    init(store: AppStore, settings: BluelyticsCore.Settings, alerts: AlertsController) {
        self.store = store
        self.settings = settings
        self.alerts = alerts
        store.onChange = { [weak self] in self?.objectWillChange.send() }
        settings.onChange = { [weak self] in self?.objectWillChange.send() }
        alerts.onChange = { [weak self] in self?.objectWillChange.send() }
        alerts.backend.onMessage = { [weak self] message in self?.receive(message) }
    }

    var locale: AppLocale { settings.locale }
    var strings: Strings { Strings.of(settings.locale) }

    /// The production wiring: the public API, the cache in Library/Caches, UserDefaults, APNs.
    static func live(push: PushBackend) -> AppModel {
        let prefs = DefaultsPreferences()
        let settings = BluelyticsCore.Settings(prefs: prefs, deviceLocale: BluelyticsCore.Settings.deviceLocale(preferredLanguages: Locale.preferredLanguages))
        let store = AppStore(api: BluelyticsAPI(), cache: FileCacheStore.caches())
        return AppModel(store: store, settings: settings, alerts: AlertsController(backend: push, prefs: prefs))
    }

    /// What was on screen last time comes back first; the network follows.
    func start() async {
        await store.restore()
        restored = true
        async let refresh: Void = store.refresh()
        async let alertsReady: Void = alerts.initialize()
        _ = await (refresh, alertsReady)
    }

    /// For tests and previews: everything is already loaded.
    func markRestored() { restored = true }

    /// An alert arrived while the app is open: show it and fetch the price it talks about.
    private func receive(_ message: AlertMessage) {
        Task { await store.refresh(force: true) }
        bannerTimer?.cancel()
        withAnimation(.easeOut(duration: 0.2)) { banner = message }
        UIAccessibility.post(notification: .announcement, argument: [message.title, message.body].filter { !$0.isEmpty }.joined(separator: ". "))
        let work = DispatchWorkItem { [weak self] in
            withAnimation(.easeOut(duration: 0.2)) { self?.banner = nil }
        }
        bannerTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    func dismissBanner() {
        bannerTimer?.cancel()
        banner = nil
    }
}
