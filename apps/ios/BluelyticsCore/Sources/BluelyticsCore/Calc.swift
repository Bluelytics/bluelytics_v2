// Calculator arithmetic (the counterpart of apps/web/src/lib/calc.ts). The dollar and the euro use
// the published rates; every other currency of `currency.json` is converted through the dollar,
// like the original app: pesos per unit = dollar rate / units per USD.
import Foundation

/// ISO codes of the currencies of the Americas (ARS and USD aside): listed first in the picker.
public let americas: Set<String> = [
    "BRL", "CLP", "UYU", "PYG", "BOB", "PEN", "COP", "VES", "VEF", "ECS", "MXN", "CAD", "CRC", "SVC", "GTQ", "HNL",
    "NIO", "PAB", "DOP", "CUP", "CUC", "HTG", "JMD", "TTD", "BSD", "BBD", "BZD", "BMD", "KYD", "XCD", "AWG",
    "ANG", "SRD", "GYD", "FKP",
]

public enum CurrencyGroup: Sendable {
    case main
    case americas
    case other
}

/// A currency the calculator can convert, with its group in the picker.
public struct CalcCurrency: Equatable, Sendable {
    public let code: String
    public let name: String
    public let group: CurrencyGroup
    /// Units per US dollar in hundredths; `nil` for USD and EUR, which have published rates.
    public let perUsdHundredths: Int?

    public init(code: String, name: String, group: CurrencyGroup, perUsdHundredths: Int? = nil) {
        self.code = code
        self.name = name
        self.group = group
        self.perUsdHundredths = perUsdHundredths
    }

    /// Sign before an amount: `US$`, `€`, or the ISO code.
    public var sign: String {
        switch code {
        case "USD": return "US$"
        case "EUR": return "€"
        default: return code
        }
    }
}

/// USD and EUR first, then the Americas, then the rest; each group sorted by name.
public func calcCurrencies(_ rows: [Currency], _ locale: AppLocale) -> [CalcCurrency] {
    let es = locale == .es
    let rest = rows
        .filter { !["USD", "EUR", "ARS"].contains($0.code) && $0.perUsdHundredths > 0 }
        .map { row in
            CalcCurrency(
                code: row.code,
                name: es ? row.name : (currencyNamesEn[row.code] ?? row.name),
                group: americas.contains(row.code) ? .americas : .other,
                perUsdHundredths: row.perUsdHundredths
            )
        }
        .sorted { compareFolded(fold($0.name), fold($1.name)) }
    return [
        CalcCurrency(code: "USD", name: es ? "Dólar estadounidense" : "US dollar", group: .main),
        CalcCurrency(code: "EUR", name: "Euro", group: .main),
    ] + rest.filter { $0.group == .americas } + rest.filter { $0.group == .other }
}

private let accents: [Character: Character] = ["á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n"]

/// Lower case without the Spanish accents (Dart `_fold`).
func fold(_ text: String) -> String {
    String(text.lowercased().map { accents[$0] ?? $0 })
}

/// Code-unit order, as Dart's `String.compareTo`: never the locale's collation.
private func compareFolded(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
}

/// Case- and accent-insensitive match of a search text against a currency's name or code.
public func matchesCurrency(_ currency: CalcCurrency, _ query: String) -> Bool {
    let needle = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
    return needle.isEmpty || fold(currency.name).contains(needle) || currency.code.lowercased().contains(needle)
}

/// Hundredths of a peso per unit of `currency`, at the dollar (and euro) quotes given. Unrounded:
/// small currencies need the decimals. `nil` when the rate is not available.
public func rateFor(_ currency: CalcCurrency, usd: Int?, eur: Int?) -> Double? {
    if currency.code == "USD" { return usd.map(Double.init) }
    if currency.code == "EUR" { return eur.map(Double.init) }
    guard let usd, let perUsd = currency.perUsdHundredths, perUsd > 0 else { return nil }
    return Double(usd) * 100 / Double(perUsd)
}

/// Pesos in hundredths for `amount` units at `rateHundredths`.
public func toPesosHundredths(_ amount: Double, _ rateHundredths: Double) -> Int {
    Int((amount * rateHundredths).rounded())
}

/// Units of the currency in hundredths for `pesos` at `rateHundredths`.
public func toForeignHundredths(_ pesos: Double, _ rateHundredths: Double) -> Int {
    rateHundredths > 0 ? Int((pesos * 10000 / rateHundredths).rounded()) : 0
}
