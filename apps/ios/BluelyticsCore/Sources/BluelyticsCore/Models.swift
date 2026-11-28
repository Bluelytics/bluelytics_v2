// The API's shapes, parsed defensively: a missing or malformed field makes that value `nil`
// rather than throwing. Money is an integer number of hundredths of a peso.
import Foundation

/// `1700.00` → `170000`; anything that is not a positive finite number → `nil`.
public func hundredthsOf(_ value: JSON?) -> Int? {
    let number: Double?
    switch value {
    case .number(let n)?: number = n
    case .string(let s)?: number = Double(s.trimmingCharacters(in: .whitespaces))
    default: number = nil
    }
    guard let n = number, n.isFinite, n > 0 else { return nil }
    return Int((n * 100).rounded())
}

/// A buy/sell pair in hundredths of a peso.
public struct Quote: Equatable, Hashable, Sendable, CustomStringConvertible {
    public let buy: Int
    public let sell: Int

    public init(_ buy: Int, _ sell: Int) {
        self.buy = buy
        self.sell = sell
    }

    /// The midpoint, rounded half up to a hundredth (as the API's `value_avg`).
    public var average: Int { (buy + sell + 1) / 2 }

    /// `{"value_buy": 1690.00, "value_sell": 1710.00}`; `nil` unless both prices are positive.
    public static func from(_ json: JSON?) -> Quote? {
        guard let json, json.isObject, let buy = hundredthsOf(json["value_buy"]), let sell = hundredthsOf(json["value_sell"]) else { return nil }
        return Quote(buy, sell)
    }

    public var description: String { "Quote(\(buy), \(sell))" }
}

/// `GET /v2/latest`.
public struct Latest: Equatable, Sendable {
    public var blue: Quote?
    public var oficial: Quote?
    public var blueEuro: Quote?
    public var oficialEuro: Quote?
    public var updatedAt: Date?

    public init(blue: Quote? = nil, oficial: Quote? = nil, blueEuro: Quote? = nil, oficialEuro: Quote? = nil, updatedAt: Date? = nil) {
        self.blue = blue
        self.oficial = oficial
        self.blueEuro = blueEuro
        self.oficialEuro = oficialEuro
        self.updatedAt = updatedAt
    }

    public static func from(_ json: JSON?) -> Latest {
        guard let json, json.isObject else { return Latest() }
        return Latest(
            blue: Quote.from(json["blue"]),
            oficial: Quote.from(json["oficial"]),
            blueEuro: Quote.from(json["blue_euro"]),
            oficialEuro: Quote.from(json["oficial_euro"]),
            updatedAt: json["last_update"]?.string.flatMap(parseInstant)
        )
    }
}

/// One calendar day's closing rates; either may be missing.
public struct DayRates: Equatable, Sendable {
    /// `YYYY-MM-DD`.
    public let day: String
    public let blue: Quote?
    public let oficial: Quote?

    public init(_ day: String, blue: Quote? = nil, oficial: Quote? = nil) {
        self.day = day
        self.blue = blue
        self.oficial = oficial
    }
}

/// `^\d{4}-\d{2}-\d{2}$`
func isDay(_ text: String) -> Bool {
    let c = Array(text.utf8)
    guard c.count == 10 else { return false }
    for (i, byte) in c.enumerated() {
        if i == 4 || i == 7 {
            if byte != 45 { return false }
        } else if byte < 48 || byte > 57 {
            return false
        }
    }
    return true
}

/// `GET /v2/evolution.json` (rows of one source per day, newest first) → days, oldest first.
public func parseEvolution(_ json: JSON?) -> [DayRates] {
    guard let rows = json?.array else { return [] }
    var blue: [String: Quote] = [:]
    var oficial: [String: Quote] = [:]
    for row in rows {
        guard row.isObject, let day = row["date"]?.string, isDay(day), let quote = Quote.from(row) else { continue }
        switch row["source"]?.string {
        case "Blue": blue[day] = quote
        case "Oficial": oficial[day] = quote
        default: break
        }
    }
    let days = Set(blue.keys).union(oficial.keys).sorted()
    return days.map { DayRates($0, blue: blue[$0], oficial: oficial[$0]) }
}

/// One entry of `GET /data/json/currency.json`: units of the currency per US dollar.
public struct Currency: Equatable, Sendable {
    public let code: String
    /// Spanish name, as stored.
    public let name: String
    public let perUsdHundredths: Int

    public init(code: String, name: String, perUsdHundredths: Int) {
        self.code = code
        self.name = name
        self.perUsdHundredths = perUsdHundredths
    }
}

public func parseCurrencies(_ json: JSON?) -> [Currency] {
    guard let rows = json?.array else { return [] }
    var out: [Currency] = []
    for row in rows {
        guard row.isObject, let code = row["code"]?.string, let name = row["name"]?.string, let value = hundredthsOf(row["value"]) else { continue }
        out.append(Currency(code: code, name: name, perUsdHundredths: value))
    }
    return out
}

/// `GET /v2/alerts`: the last significant move of the blue sell price.
public struct AlertInfo: Equatable, Sendable {
    public let id: Int
    public let at: Date
    public let current: Quote
    public let previous: Quote?

    public init(id: Int, at: Date, current: Quote, previous: Quote? = nil) {
        self.id = id
        self.at = at
        self.current = current
        self.previous = previous
    }

    public static func from(_ json: JSON?) -> AlertInfo? {
        guard let json, json.isObject, let id = json["alert_id"]?.int, let at = json["alert_at"]?.string.flatMap(parseInstant),
              let current = Quote.from(json["current"])
        else { return nil }
        return AlertInfo(id: id, at: at, current: current, previous: Quote.from(json["previous"]))
    }
}

/// One entry of the site's `/data/extras.json`: a reference rate published by a third party.
public struct ExtraRate: Equatable, Sendable {
    /// `mep`, `ccl`, `cripto`, `tarjeta`, `mayorista`, …
    public let code: String
    public let sell: Int
    public let buy: Int?

    public init(code: String, sell: Int, buy: Int? = nil) {
        self.code = code
        self.sell = sell
        self.buy = buy
    }
}

/// `{"rates":[{"code":"mep","buy":165250,"sell":165250}, …]}`, prices already in hundredths.
public func parseExtras(_ json: JSON?) -> [ExtraRate] {
    guard let rows = json?["rates"]?.array else { return [] }
    var out: [ExtraRate] = []
    for row in rows {
        guard row.isObject, let code = row["code"]?.string, let sell = row["sell"]?.int, sell > 0 else { continue }
        let buy = row["buy"]?.int
        out.append(ExtraRate(code: code, sell: sell, buy: buy.flatMap { $0 > 0 ? $0 : nil }))
    }
    return out
}
