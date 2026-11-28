import Foundation
import XCTest
@testable import BluelyticsCore

@MainActor
final class AlertsTests: XCTestCase {
    func controller(_ backend: PushBackend, _ saved: [String: Any] = [:]) -> AlertsController {
        AlertsController(backend: backend, prefs: MemoryPreferences(saved))
    }

    func saved(_ alerts: AlertsController) -> Bool? { alerts.prefs.bool("alerts_enabled") }

    func testOffByDefaultAndNothingIsRegisteredUntilSomeoneTurnsAlertsOn() async {
        let push = FakePush()
        let alerts = controller(push)
        await alerts.initialize()
        XCTAssertFalse(alerts.enabled)
        XCTAssertEqual(push.calls, [])
    }

    func testTurningOnRegistersAndRemembersTurningOffUnregisters() async {
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
        XCTAssertTrue(alerts.enabled, "still registered: the unregister did not go through")
        XCTAssertEqual(alerts.problem, .failed)
        push.fail = false
        await alerts.setEnabled(false)
        XCTAssertFalse(alerts.enabled)
        XCTAssertNil(alerts.problem)
    }

    func testASavedOnRegistersAgainAtStart() async {
        let push = FakePush()
        let alerts = controller(push, ["alerts_enabled": true])
        await alerts.initialize()
        XCTAssertTrue(alerts.enabled)
        XCTAssertEqual(push.calls, ["resume"])
    }

    func testWherePushDoesNotExistTheSwitchDoesNothing() async {
        let alerts = controller(NoPush())
        await alerts.initialize()
        await alerts.setEnabled(true)
        XCTAssertFalse(alerts.supported)
        XCTAssertFalse(alerts.enabled)
        XCTAssertNil(saved(alerts))
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
