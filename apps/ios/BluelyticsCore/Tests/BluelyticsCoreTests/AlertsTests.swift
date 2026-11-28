import Foundation
import XCTest
@testable import BluelyticsCore

@MainActor
final class AlertsTests: XCTestCase {
    func controller(_ backend: PushBackend, _ saved: [String: Any] = [:]) -> AlertsController {
        AlertsController(backend: backend, prefs: MemoryPreferences(saved))
    }

    func saved(_ alerts: AlertsController) -> Bool? { alerts.prefs.bool("alerts_enabled") }

    func testOffByDefaultAndFirebaseIsLeftAloneUntilSomeoneTurnsAlertsOn() async {
        let push = FakePush()
        let alerts = controller(push)
        await alerts.initialize()
        XCTAssertFalse(alerts.enabled)
        XCTAssertEqual(push.calls, [])
    }

    func testTurningOnSubscribesAndRemembersTurningOffUnsubscribes() async {
        let push = FakePush()
        let alerts = controller(push)
        await alerts.initialize()
        await alerts.setEnabled(true)
        XCTAssertTrue(alerts.enabled)
        XCTAssertNil(alerts.problem)
        XCTAssertEqual(saved(alerts), true)
        await alerts.setEnabled(false)
        XCTAssertFalse(alerts.enabled)
        XCTAssertEqual(saved(alerts), false)
        XCTAssertEqual(push.calls, ["enable", "disable"])
    }

    func testARefusedPermissionLeavesAlertsOffAndSaysWhy() async {
        let alerts = controller(FakePush(grant: false))
        await alerts.initialize()
        await alerts.setEnabled(true)
        XCTAssertFalse(alerts.enabled)
        XCTAssertEqual(alerts.problem, .denied)
    }

    func testANetworkFailureKeepsThePreviousState() async {
        let push = FakePush(fail: true)
        let alerts = controller(push, ["alerts_enabled": true])
        await alerts.initialize()
        XCTAssertTrue(alerts.enabled)
        await alerts.setEnabled(false)
        XCTAssertTrue(alerts.enabled, "still subscribed: the unsubscribe did not go through")
        XCTAssertEqual(alerts.problem, .failed)
        push.fail = false
        await alerts.setEnabled(false)
        XCTAssertFalse(alerts.enabled)
        XCTAssertNil(alerts.problem)
    }

    func testASavedOnResumesListeningAtStart() async {
        let push = FakePush()
        let alerts = controller(push, ["alerts_enabled": true])
        await alerts.initialize()
        XCTAssertTrue(alerts.enabled)
        XCTAssertEqual(push.calls, ["resume"])
    }

    func testTheFirstRunAfterUpdatingFromVersion1CarriesItsSwitchOverOnce() async {
        let push = FakePush(legacy: true)
        let alerts = controller(push)
        await alerts.initialize()
        XCTAssertTrue(alerts.enabled)
        XCTAssertEqual(saved(alerts), true)
        XCTAssertEqual(push.calls, ["enable"], "makes sure of the permission and the APNs registration")

        // The person turns alerts off: the old app's "on" must not come back.
        await alerts.setEnabled(false)
        let again = AlertsController(backend: FakePush(legacy: true), prefs: alerts.prefs)
        await again.initialize()
        XCTAssertFalse(again.enabled)
    }

    func testCarriedOverFromVersion1ButNotificationsRefusedOffAndUnsubscribed() async {
        let push = FakePush(grant: false, legacy: true)
        let alerts = controller(push)
        await alerts.initialize()
        XCTAssertFalse(alerts.enabled)
        XCTAssertEqual(saved(alerts), false)
        XCTAssertEqual(push.calls, ["enable", "disable"])
    }

    func testCarriedOverFromVersion1WhileOfflineStillOnAsTheDeviceIsStillSubscribed() async {
        let push = FakePush(legacy: true, fail: true)
        let alerts = controller(push)
        await alerts.initialize()
        XCTAssertTrue(alerts.enabled)
        XCTAssertEqual(saved(alerts), true)
        XCTAssertNil(alerts.problem)
    }

    func testVersion1HadAlertsOffOrLeftNoTraceOffAndFirebaseIsNotTouched() async {
        for legacy in [false, nil] as [Bool?] {
            let push = FakePush(legacy: legacy)
            let alerts = controller(push)
            await alerts.initialize()
            XCTAssertFalse(alerts.enabled)
            XCTAssertEqual(saved(alerts), false)
            XCTAssertEqual(push.calls, [])
        }
    }

    func testWherePushDoesNotExistTheSwitchDoesNothing() async {
        let alerts = controller(NoPush())
        await alerts.initialize()
        await alerts.setEnabled(true)
        XCTAssertFalse(alerts.supported)
        XCTAssertFalse(alerts.enabled)
        XCTAssertNil(saved(alerts))
    }

    // MARK: the React Native app's storage

    func testTheVersion1SwitchIsReadFromTheFirstManifestThatHasIt() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("bluelytics-legacy-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let support = root.appendingPathComponent("Application Support")
        let documents = root.appendingPathComponent("Documents")
        let candidates = legacyManifestCandidates(applicationSupport: support, documents: documents)
        XCTAssertEqual(candidates[0].path, support.path + "/com.bluelytics.mobile/RCTAsyncLocalStorage_V1/manifest.json")
        XCTAssertNil(legacyAlertsEnabled(candidates: candidates), "no trace")

        func write(_ url: URL, _ text: String) throws {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url)
        }
        try write(candidates[2], #"{"subState":"true"}"#)
        XCTAssertEqual(legacyAlertsEnabled(candidates: candidates), true)
        try write(candidates[1], #"{"other":"x","subState":"false"}"#)
        XCTAssertEqual(legacyAlertsEnabled(candidates: candidates), false)
        try write(candidates[0], "not json")
        XCTAssertEqual(legacyAlertsEnabled(candidates: candidates), false, "a damaged manifest is skipped")
    }

    func testSettingsRememberTheLanguageChosen() {
        let prefs = MemoryPreferences()
        let settings = Settings(prefs: prefs, deviceLocale: .en)
        XCTAssertEqual(settings.locale, .en)
        var changes = 0
        settings.onChange = { changes += 1 }
        settings.toggleLocale()
        XCTAssertEqual(settings.locale, .es)
        settings.setLocale(.es)
        XCTAssertEqual(changes, 1)
        XCTAssertEqual(Settings(prefs: prefs, deviceLocale: .en).locale, .es)
        XCTAssertEqual(Settings.deviceLocale(preferredLanguages: ["es-AR", "en"]), .es)
        XCTAssertEqual(Settings.deviceLocale(preferredLanguages: ["pt-BR"]), .en)
        XCTAssertEqual(Settings.deviceLocale(preferredLanguages: []), .en)
    }
}
