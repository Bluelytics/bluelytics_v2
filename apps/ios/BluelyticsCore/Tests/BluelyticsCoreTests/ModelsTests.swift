import XCTest
@testable import BluelyticsCore

final class ModelsTests: XCTestCase {
    func testHundredthsDecimalsStringsAndJunk() {
        XCTAssertEqual(hundredthsOf(.number(1700.00)), 170_000)
        XCTAssertEqual(hundredthsOf(.number(4.07)), 407)
        XCTAssertEqual(hundredthsOf(.number(1652.5)), 165_250)
        XCTAssertEqual(hundredthsOf(.string("1710.00")), 171_000)
        XCTAssertNil(hundredthsOf(.number(0)))
        XCTAssertNil(hundredthsOf(.number(-5)))
        XCTAssertNil(hundredthsOf(nil))
        XCTAssertNil(hundredthsOf(.null))
        XCTAssertNil(hundredthsOf(.number(.nan)))
        XCTAssertNil(hundredthsOf(.string("x")))
    }

    func testTheAverageIsTheMidpointRoundedHalfUp() {
        XCTAssertEqual(Quote(169_000, 171_000).average, 170_000)
        XCTAssertEqual(Quote(163_500, 167_000).average, 165_250)
        XCTAssertEqual(Quote(1, 2).average, 2)
    }

    func testLatestTheCapturedProductionBody() {
        let latest = Latest.from(json(fixture("latest")))
        XCTAssertEqual(latest.blue, Quote(169_000, 171_000))
        XCTAssertEqual(latest.oficial, Quote(158_000, 163_000))
        XCTAssertEqual(latest.blueEuro, Quote(183_700, 185_900))
        XCTAssertEqual(latest.oficialEuro, Quote(171_700, 177_200))
        XCTAssertEqual(latest.updatedAt, utc(2026, 11, 25, 22, 20, 12, 572))
    }

    func testLatestMissingOrMalformedPartsBecomeNilInsteadOfThrowing() {
        XCTAssertNil(Latest.from(nil).blue)
        XCTAssertNil(Latest.from(.array([])).blue)
        let partial = Latest.from(json(#"{"blue":{"value_buy":1690,"value_sell":null},"oficial":"x","last_update":"nope"}"#))
        XCTAssertNil(partial.blue)
        XCTAssertNil(partial.oficial)
        XCTAssertNil(partial.updatedAt)
    }

    func testEvolutionRowsBecomeDaysOldestFirstWithBothSources() {
        let days = parseEvolution(json(fixture("recent")))
        XCTAssertEqual(days.count, 45)
        XCTAssertLessThan(days.first!.day, days.last!.day)
        XCTAssertEqual(days.last!.day, "2026-11-25")
        XCTAssertEqual(days.last!.blue, Quote(169_000, 171_000))
        XCTAssertEqual(days.last!.oficial, Quote(158_000, 163_000))
        for i in 1..<days.count {
            XCTAssertLessThan(days[i - 1].day, days[i].day, "sorted and unique")
        }
    }

    func testEvolutionBadRowsAreSkipped() {
        let days = parseEvolution(json("""
            [{"date":"2026-11-25","source":"Blue","value_sell":1710,"value_buy":1690},
            {"date":"25/11/2026","source":"Blue","value_sell":1,"value_buy":1},
            {"date":"2026-11-24","source":"Blue","value_sell":0,"value_buy":1680},
            {"date":"2026-11-24","source":"Otro","value_sell":1,"value_buy":1},
            "junk",
            {"date":"2026-11-24","source":"Oficial","value_sell":1615,"value_buy":1565}]
            """))
        XCTAssertEqual(days.map(\.day), ["2026-11-24", "2026-11-25"])
        XCTAssertNil(days[0].blue)
        XCTAssertEqual(days[0].oficial, Quote(156_500, 161_500))
        XCTAssertNil(days[1].oficial)
        XCTAssertTrue(parseEvolution(nil).isEmpty)
        XCTAssertTrue(parseEvolution(json(#"{"a":1}"#)).isEmpty)
    }

    func testCurrenciesTheCapturedListWithoutTheOnesThatHaveNoValue() {
        let currencies = parseCurrencies(json(fixture("currencies")))
        XCTAssertGreaterThan(currencies.count, 150)
        XCTAssertTrue(currencies.filter { $0.code == "BTC" }.isEmpty, "value 0.00")
        let real = currencies.first { $0.code == "BRL" }!
        XCTAssertEqual(real.name, "Real brasileño")
        XCTAssertEqual(real.perUsdHundredths, 593)
    }

    func testAlertTheCapturedBodyAndBodiesWithoutAnAlert() {
        let alert = AlertInfo.from(json(fixture("alert")))!
        XCTAssertEqual(alert.id, 1891)
        XCTAssertEqual(alert.at, utc(2026, 11, 25, 15, 10, 12, 572))
        XCTAssertEqual(alert.current.sell, 174_000)
        XCTAssertEqual(alert.previous!.sell, 172_500)
        XCTAssertNil(AlertInfo.from(nil))
        XCTAssertNil(AlertInfo.from(json("{}")))
    }

    func testExtrasPricesAlreadyInHundredthsEntriesWithoutASellPriceAreDropped() {
        let extras = parseExtras(json(fixture("extras")))
        XCTAssertEqual(extras.map(\.code), ["mep", "ccl", "cripto", "tarjeta", "mayorista"])
        XCTAssertNil(extras[3].buy)
        XCTAssertEqual(extras[3].sell, 211_900)
        XCTAssertTrue(parseExtras(json(#"{"rates":[{"code":"mep","sell":null},{"code":7,"sell":1},"x"]}"#)).isEmpty)
        XCTAssertTrue(parseExtras(json("[]")).isEmpty)
    }

    func testJSONKeepsNumbersAndBooleansApart() {
        XCTAssertEqual(json("[1, 0, true, false, null]"), .array([.number(1), .number(0), .bool(true), .bool(false), .null]))
        XCTAssertThrowsError(try JSON.parse("<html>error</html>"))
    }
}
