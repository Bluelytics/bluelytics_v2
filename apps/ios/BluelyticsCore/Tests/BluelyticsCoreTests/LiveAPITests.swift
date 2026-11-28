// The data layer against the production API, to catch a contract change the fixtures hide:
//
//   LIVE=1 swift test --package-path apps/ios/BluelyticsCore --filter LiveAPITests
//
// Skipped otherwise, so the normal suite never needs a network.
import Foundation
import XCTest
@testable import BluelyticsCore

@MainActor
final class LiveAPITests: XCTestCase {
    func testAColdStartFillsEveryScreenFromTheAPI() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["LIVE"] == "1", "set LIVE=1 to run against api.bluelytics.com.ar")
        let store = AppStore(api: BluelyticsAPI(), cache: MemoryCacheStore())
        await store.refresh()

        XCTAssertFalse(store.offline)
        let latest = try XCTUnwrap(store.latest)
        XCTAssertGreaterThan(latest.blue!.sell, latest.blue!.buy)
        XCTAssertNotNil(latest.oficial)
        XCTAssertNotNil(latest.blueEuro)
        XCTAssertNotNil(latest.oficialEuro)
        XCTAssertNotNil(latest.updatedAt)

        XCTAssertGreaterThan(store.recent.count, 20)
        XCTAssertTrue(store.hasFullSeries)
        XCTAssertLessThan(store.series.first!.day, "2012-01-01", "the history goes back to 2011")
        XCTAssertEqual(store.series.last!.day, store.recent.last!.day)

        let snapshot = try XCTUnwrap(store.snapshot)
        XCTAssertNotNil(snapshot.previousDay)
        XCTAssertNotNil(snapshot.gap)

        let currencies = calcCurrencies(store.currencies, .en)
        XCTAssertGreaterThan(currencies.count, 100)
        XCTAssertGreaterThan(currencies.filter { $0.group == .americas }.count, 15)
        let untranslated = currencies.filter { c in c.code != "EUR" && store.currencies.first { $0.code == c.code }?.name == c.name }.map(\.code)
        print("codes without an English name: \(untranslated.joined(separator: ", "))")
        print(
            "blue \(formatPesos(latest.blue!.sell, .es)) · oficial \(formatPesos(latest.oficial!.sell, .es)) · "
                + "\(store.series.count) days from \(store.series.first!.day) to \(store.series.last!.day) · \(currencies.count) currencies · "
                + "alert \(store.alert.map { String($0.id) } ?? "none") · extras \(store.extras.count)"
        )
    }
}
