import XCTest
@testable import BluelyticsCore

final class FormatTests: XCTestCase {
    let es = AppLocale.es
    let en = AppLocale.en

    func testIntegersAreGroupedInThreesWithTheLocaleSeparator() {
        XCTAssertEqual(formatInteger(0, es), "0")
        XCTAssertEqual(formatInteger(999, es), "999")
        XCTAssertEqual(formatInteger(1675, es), "1.675")
        XCTAssertEqual(formatInteger(1675, en), "1,675")
        XCTAssertEqual(formatInteger(1_234_567, es), "1.234.567")
        XCTAssertEqual(formatInteger(-20, es), "\(minus)20")
    }

    func testHundredthsAlwaysShowTwoDecimals() {
        XCTAssertEqual(formatHundredths(165_250, es), "1.652,50")
        XCTAssertEqual(formatHundredths(165_250, en), "1,652.50")
        XCTAssertEqual(formatHundredths(5, es), "0,05")
        XCTAssertEqual(formatHundredths(-405, es), "\(minus)4,05")
    }

    func testPricesShowCentsOnlyWhenThereAreAny() {
        XCTAssertEqual(formatPesos(171_000, es), "$\(nbsp)1.710")
        XCTAssertEqual(formatPesos(171_000, en), "$1,710")
        XCTAssertEqual(formatPesos(405, es), "$\(nbsp)4,05")
        XCTAssertEqual(formatPesosCents(170_000, es), "$\(nbsp)1.700,00")
        XCTAssertEqual(formatForeign(5848, "US$", es), "US$\(nbsp)58,48")
        XCTAssertEqual(formatForeign(5848, "€", en), "€58.48")
    }

    func testSignedAmountsCarryAPlusOrTheTypographicMinus() {
        XCTAssertEqual(formatSignedAmount(3000, es), "+30")
        XCTAssertEqual(formatSignedAmount(-2000, es), "\(minus)20")
        XCTAssertEqual(formatSignedAmount(0, es), "0")
        XCTAssertEqual(formatSignedAmount(150, en), "+1.50")
    }

    func testPercentagesFollowTheLocaleAndNeverPrintANegativeZero() {
        XCTAssertEqual(formatPercent(0.049, es), "4,9\(nbsp)%")
        XCTAssertEqual(formatPercent(0.049, en), "4.9%")
        XCTAssertEqual(formatPercent(-0.0004, es), "0,0\(nbsp)%")
        XCTAssertEqual(formatSignedPercent(0.0183, es, 2), "+1,83\(nbsp)%")
        XCTAssertEqual(formatSignedPercent(-0.0121, es, 2), "\(minus)1,21\(nbsp)%")
        XCTAssertEqual(formatSignedPercent(0, es, 2), "0,00\(nbsp)%")
        XCTAssertEqual(formatPercent(12.5, en, 0), "1,250%")
    }

    func testDaysInBothLanguages() {
        XCTAssertEqual(formatDay("2026-11-20", es), "20 de noviembre de 2026")
        XCTAssertEqual(formatDay("2026-11-20", en), "November 20, 2026")
        XCTAssertEqual(formatDay("2026-09-05", es, short: true), "5 sept 2026")
        XCTAssertEqual(formatDay("2026-09-05", en, short: true), "Sep 5, 2026")
        XCTAssertEqual(formatDayNumeric("2026-11-20", es), "20/11")
        XCTAssertEqual(formatDayNumeric("2026-11-20", en), "11/20")
        XCTAssertEqual(formatDayNumeric("2026-11-20", es, withYear: true), "20/11/26")
        XCTAssertEqual(formatMonthShort(2024, 3, es), "mar 2024")
    }

    func testInstantsAreShownInArgentineTimeWhateverTheDeviceTimeZone() {
        let lateEvening = parseInstant("2026-11-25T19:20:12.572-03:00")!
        XCTAssertEqual(artDay(lateEvening), "2026-11-25")
        XCTAssertEqual(formatTime(lateEvening), "19:20")
        XCTAssertEqual(formatDateTime(lateEvening, es), "25 nov 2026, 19:20")
        XCTAssertEqual(formatDateTime(lateEvening, en), "Nov 25, 2026, 19:20")
        // 01:30 UTC is still the previous evening in Buenos Aires.
        let afterMidnightUtc = utc(2026, 11, 26, 1, 30)
        XCTAssertEqual(artDay(afterMidnightUtc), "2026-11-25")
        XCTAssertEqual(formatTime(afterMidnightUtc), "22:30")
    }

    func testElapsedTimeIsCoarse() {
        let now = utc(2026, 11, 25, 12)
        XCTAssertEqual(formatAgo(now.addingTimeInterval(-5 * 60), now, es), "hace 5 min")
        XCTAssertEqual(formatAgo(now.addingTimeInterval(-3 * 3600), now, en), "3 h ago")
        XCTAssertEqual(formatAgo(now.addingTimeInterval(-3 * 86400), now, es), "hace 3 días")
        XCTAssertEqual(formatAgo(now.addingTimeInterval(5 * 60), now, es), "hace 0 min")
    }

    func testTypedAmountsAreReadInTheLocaleNotation() {
        XCTAssertEqual(parseAmount("1.234,5", es), 1234.5)
        XCTAssertEqual(parseAmount("1,234.5", en), 1234.5)
        XCTAssertEqual(parseAmount(" 100 ", es), 100)
        XCTAssertEqual(parseAmount("0,5", es), 0.5)
        XCTAssertNil(parseAmount("", es))
        XCTAssertNil(parseAmount("12,3,4", es))
        XCTAssertNil(parseAmount("abc", en))
        XCTAssertEqual(parseAmount("$\(nbsp)1.000", es), 1000)
        XCTAssertNil(parseAmount(",5", es))
    }

    // Not in the Dart suite: the parser and printer that replace DateTime.parse and toIso8601String.
    func testInstantsParseAndPrint() {
        XCTAssertEqual(parseInstant("2026-11-25T19:20:12.572-03:00"), utc(2026, 11, 25, 22, 20, 12, 572))
        XCTAssertEqual(parseInstant("2026-11-25T15:10:12.572Z"), utc(2026, 11, 25, 15, 10, 12, 572))
        XCTAssertEqual(parseInstant("2026-11-25T15:10:12Z"), utc(2026, 11, 25, 15, 10, 12))
        XCTAssertEqual(parseInstant("2026-11-25T15:10:12+0100"), utc(2026, 11, 25, 14, 10, 12))
        XCTAssertNil(parseInstant("nope"))
        XCTAssertNil(parseInstant("2026-13-25T15:10:12Z"))
        XCTAssertNil(parseInstant("2026-11-25T15:10:12Zjunk"))
        XCTAssertEqual(formatInstant(utc(2026, 11, 25, 22, 21)), "2026-11-25T22:21:00.000Z")
        XCTAssertEqual(parseInstant(formatInstant(fixtureNow)), fixtureNow)
        XCTAssertEqual(formatInstant(fixtureNow), "2026-11-25T22:21:00.000Z")
    }

    func testCivilDaysRoundTrip() {
        for days in stride(from: -1000, through: 30000, by: 37) {
            let civil = civilFromDays(days)
            XCTAssertEqual(daysFromCivil(civil.year, civil.month, civil.day), days)
        }
        XCTAssertEqual(daysFromCivil(1970, 1, 1), 0)
        XCTAssertEqual(dayNumber("2024-03-01") - dayNumber("2024-02-28"), 2, "leap year")
    }
}
