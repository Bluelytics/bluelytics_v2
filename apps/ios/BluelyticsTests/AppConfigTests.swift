// The built app's identity and resources match what the code and the stores expect.
import BluelyticsCore
import UIKit
import XCTest
@testable import Bluelytics

final class AppConfigTests: XCTestCase {
    func testBundleIdentityMatchesTheCore() {
        let info = Bundle.main.infoDictionary ?? [:]
        XCTAssertEqual(Bundle.main.bundleIdentifier, bundleId)
        // MARKETING_VERSION in the project and `appVersion` (sent in the user agent) move together.
        XCTAssertEqual(info["CFBundleShortVersionString"] as? String, appVersion)
        XCTAssertEqual(info["CFBundleVersion"] as? String, "5000000")
        // Visible alerts need no background mode, and no Firebase is left.
        XCTAssertNil(info["UIBackgroundModes"])
        XCTAssertFalse(info.keys.contains { $0.hasPrefix("Firebase") })
    }

    func testResourcesAreBundled() {
        XCTAssertNil(Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist"))
        XCTAssertNotNil(Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"))
        XCTAssertNotNil(UIImage(named: "Mark"))
    }

    func testFontsRegisterWithTheirWeights() {
        Fonts.registerIfNeeded()
        XCTAssertNotNil(UIFont(name: "Geist-Regular", size: 12))
        XCTAssertNotNil(UIFont(name: "GeistMono-Regular", size: 12))
        let bold = Fonts.ui(.sans, 20, weight: 800)
        XCTAssertTrue(bold.fontName.hasPrefix("Geist"), bold.fontName)
    }
}
