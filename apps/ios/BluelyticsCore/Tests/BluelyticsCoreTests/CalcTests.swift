import XCTest
@testable import BluelyticsCore

final class CalcTests: XCTestCase {
    let rows = parseCurrencies(json(fixture("currencies")))

    func testThePickerListsTheDollarAndTheEuroThenTheAmericasThenTheRest() {
        let list = calcCurrencies(rows, .es)
        XCTAssertEqual(list[0].code, "USD")
        XCTAssertEqual(list[1].code, "EUR")
        XCTAssertEqual(list.filter { ["USD", "EUR", "ARS"].contains($0.code) }.count, 2, "no duplicates of the published ones, no pesos")
        let groups = list.map(\.group)
        XCTAssertEqual(groups.firstIndex(of: .americas), 2)
        XCTAssertLessThan(groups.lastIndex(of: .americas)!, groups.firstIndex(of: .other)!)
        let american = Set(list.filter { $0.group == .americas }.map(\.code))
        XCTAssertTrue(american.isSuperset(of: ["BRL", "CLP", "UYU", "PYG", "BOB", "PEN", "COP", "MXN", "CAD"]))
        XCTAssertEqual(list.first { $0.code == "GBP" }!.group, .other)
    }

    func testNamesAreSpanishAsStoredOrEnglishFromTheTable() {
        XCTAssertEqual(calcCurrencies(rows, .es).first { $0.code == "BRL" }!.name, "Real brasileño")
        let english = calcCurrencies(rows, .en)
        XCTAssertEqual(english.first { $0.code == "BRL" }!.name, "Brazilian real")
        XCTAssertEqual(english.first!.name, "US dollar")
        let names = english.filter { $0.group == .other }.map(\.name)
        XCTAssertEqual(Array(names.prefix(3)), ["Afghan afghani", "Albanian lek", "Algerian dinar"], "sorted by the name on screen")
    }

    func testSearchIgnoresCaseAndAccentsAndMatchesCodes() {
        let list = calcCurrencies(rows, .es)
        func find(_ query: String) -> [String] { list.filter { matchesCurrency($0, query) }.map(\.code) }
        XCTAssertEqual(find("dolar canad"), ["CAD"])
        XCTAssertEqual(find("brl"), ["BRL"])
        XCTAssertEqual(find("GUARANÍ"), ["PYG"])
        XCTAssertEqual(find("  ").count, list.count)
        XCTAssertTrue(find("zzzz").isEmpty)
    }

    func testRatesPublishedForTheDollarAndTheEuroThroughTheDollarForTheRest() {
        let list = calcCurrencies(rows, .es)
        let usd = list[0], eur = list[1]
        let brl = list.first { $0.code == "BRL" }!
        XCTAssertEqual(rateFor(usd, usd: 171_000, eur: 185_900), 171_000)
        XCTAssertEqual(rateFor(eur, usd: 171_000, eur: 185_900), 185_900)
        // 1 USD = 5.93 BRL, so one real is 1710 / 5.93 pesos.
        XCTAssertClose(rateFor(brl, usd: 171_000, eur: 185_900), 28836.4, 0.1)
        XCTAssertNil(rateFor(brl, usd: nil, eur: 185_900))
        XCTAssertNil(rateFor(eur, usd: 171_000, eur: nil))
        XCTAssertEqual(usd.sign, "US$")
        XCTAssertEqual(eur.sign, "€")
        XCTAssertEqual(brl.sign, "BRL")
    }

    func testConversionsRoundToAHundredth() {
        XCTAssertEqual(toPesosHundredths(100, 171_000), 17_100_000)
        XCTAssertEqual(toPesosHundredths(0.5, 171_000), 85_500)
        XCTAssertEqual(toForeignHundredths(100_000, 171_000), 5848)
        XCTAssertEqual(toForeignHundredths(100_000, 0), 0)
    }

    func testEveryEnglishNameCameAcross() {
        XCTAssertEqual(currencyNamesEn.count, 162)
        XCTAssertEqual(currencyNamesEn["AED"], "UAE dirham")
    }
}
