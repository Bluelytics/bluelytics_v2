// Display formatting for both languages; a port of apps/web/src/lib/format.ts so the app and the
// site print every number the same way. Spanish follows es-AR: `.` thousands, `,` decimals,
// `$ 1.675`, `4,9 %`, 24-hour clock. Money is always an integer number of hundredths of a peso.
import Foundation

public enum AppLocale: String, CaseIterable, Sendable {
    case es
    case en

    public static func fromCode(_ code: String?) -> AppLocale { code == "en" ? .en : .es }
}

/// No-break space.
public let nbsp = "\u{00A0}"

/// Typographic minus (U+2212).
public let minus = "\u{2212}"

private let monthsLong: [AppLocale: [String]] = [
    .es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    .en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
]

private let monthsShort: [AppLocale: [String]] = [
    .es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
    .en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
]

private func thousands(_ locale: AppLocale) -> String { locale == .es ? "." : "," }
private func decimal(_ locale: AppLocale) -> String { locale == .es ? "," : "." }

private func group(_ digits: String, _ separator: String) -> String {
    var out = ""
    let chars = Array(digits)
    for (i, char) in chars.enumerated() {
        if i > 0 && (chars.count - i) % 3 == 0 { out += separator }
        out.append(char)
    }
    return out
}

private func pad(_ value: Int, _ width: Int) -> String {
    let text = String(value)
    return text.count >= width ? text : String(repeating: "0", count: width - text.count) + text
}

/// `1675` → `1.675` (es) / `1,675` (en). Negative values use the typographic minus.
public func formatInteger(_ value: Int, _ locale: AppLocale) -> String {
    let text = group(String(value.magnitude), thousands(locale))
    return value < 0 ? minus + text : text
}

/// Hundredths → `1.652,50` / `1,652.50`.
public func formatHundredths(_ hundredths: Int, _ locale: AppLocale) -> String {
    let abs = Int(hundredths.magnitude)
    let whole = group(String(abs / 100), thousands(locale))
    let text = whole + decimal(locale) + pad(abs % 100, 2)
    return hundredths < 0 ? minus + text : text
}

/// Whole pesos when the amount has no cents, two decimals otherwise: `1.675` or `4,05`.
public func formatAmount(_ hundredths: Int, _ locale: AppLocale) -> String {
    hundredths % 100 == 0 ? formatInteger(hundredths / 100, locale) : formatHundredths(hundredths, locale)
}

private func withCurrency(_ amount: String, _ locale: AppLocale, _ sign: String = "$") -> String {
    locale == .es ? sign + nbsp + amount : sign + amount
}

/// A price: `$ 1.675` / `$1,675`, with cents only when there are any (`$ 4,05`).
public func formatPesos(_ hundredths: Int, _ locale: AppLocale) -> String {
    withCurrency(formatAmount(hundredths, locale), locale)
}

/// A price always with cents: `$ 1.652,50` / `$1,652.50`.
public func formatPesosCents(_ hundredths: Int, _ locale: AppLocale) -> String {
    withCurrency(formatHundredths(hundredths, locale), locale)
}

/// An amount of another currency, always with cents: `US$ 58,48` / `US$58.48`.
public func formatForeign(_ hundredths: Int, _ sign: String, _ locale: AppLocale) -> String {
    withCurrency(formatHundredths(hundredths, locale), locale, sign)
}

/// `+20` / `−20` / `0`, with cents only when there are any.
public func formatSignedAmount(_ hundredths: Int, _ locale: AppLocale) -> String {
    let text = formatAmount(Int(hundredths.magnitude), locale)
    if hundredths > 0 { return "+" + text }
    return hundredths < 0 ? minus + text : text
}

private func pow10(_ exponent: Int) -> Int {
    var result = 1
    for _ in 0..<max(exponent, 0) { result *= 10 }
    return result
}

/// A ratio as a percentage: `0.049` → `4,9 %` / `4.9%`.
public func formatPercent(_ ratio: Double, _ locale: AppLocale, _ digits: Int = 1) -> String {
    let unit = pow10(digits)
    let scaled = Int((Swift.abs(ratio) * 100 * Double(unit)).rounded())
    let negative = ratio < 0 && scaled != 0
    let whole = group(String(scaled / unit), thousands(locale))
    let fraction = digits > 0 ? decimal(locale) + pad(scaled % unit, digits) : ""
    let text = (negative ? minus : "") + whole + fraction
    return locale == .es ? text + nbsp + "%" : text + "%"
}

/// `+0,9 %` / `−0,9 %` / `0,0 %`.
public func formatSignedPercent(_ ratio: Double, _ locale: AppLocale, _ digits: Int = 1) -> String {
    let text = formatPercent(ratio, locale, digits)
    let zero = Int((Swift.abs(ratio) * 100 * Double(pow10(digits))).rounded()) == 0
    return text.hasPrefix(minus) || zero ? text : "+" + text
}

public func monthName(_ month: Int, _ locale: AppLocale) -> String { monthsLong[locale]![month - 1] }

public func monthShort(_ month: Int, _ locale: AppLocale) -> String { monthsShort[locale]![month - 1] }

// MARK: - Calendar days (`YYYY-MM-DD`)

/// Year, month and day of a `YYYY-MM-DD` string. The caller guarantees the shape.
func dayParts(_ day: String) -> (year: Int, month: Int, day: Int) {
    let chars = Array(day.utf8)
    func number(_ from: Int, _ to: Int) -> Int {
        var value = 0
        for i in from..<to { value = value * 10 + Int(chars[i]) - 48 }
        return value
    }
    return (number(0, 4), number(5, 7), number(8, 10))
}

/// Days since 1970-01-01 of a civil date (proleptic Gregorian; Howard Hinnant's algorithm).
func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let mp = (month + 9) % 12
    let doy = (153 * mp + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

/// The civil date of a number of days since 1970-01-01.
func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
    let z = days + 719468
    let era = (z >= 0 ? z : z - 146096) / 146097
    let doe = z - era * 146097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let d = doy - (153 * mp + 2) / 5 + 1
    let m = mp < 10 ? mp + 3 : mp - 9
    return (m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, m, d)
}

func dayString(_ year: Int, _ month: Int, _ day: Int) -> String {
    pad(year, 4) + "-" + pad(month, 2) + "-" + pad(day, 2)
}

/// Days since 1970-01-01 of a `YYYY-MM-DD` string.
func dayNumber(_ day: String) -> Int {
    let p = dayParts(day)
    return daysFromCivil(p.year, p.month, p.day)
}

/// `day` is `YYYY-MM-DD`. Long: `20 de noviembre de 2026` / `November 20, 2026`;
/// short: `20 nov 2026` / `Nov 20, 2026`.
public func formatDay(_ day: String, _ locale: AppLocale, short: Bool = false) -> String {
    let p = dayParts(day)
    let year = String(day.prefix(4))
    let name = short ? monthShort(p.month, locale) : monthName(p.month, locale)
    if locale == .es { return short ? "\(p.day) \(name) \(year)" : "\(p.day) de \(name) de \(year)" }
    return "\(name) \(p.day), \(year)"
}

/// `20/11` (es) / `11/20` (en), optionally with the year: compact axis and table labels.
public func formatDayNumeric(_ day: String, _ locale: AppLocale, withYear: Bool = false) -> String {
    let chars = Array(day)
    let dd = String(chars[8..<10])
    let mm = String(chars[5..<7])
    let year = withYear ? "/" + String(chars[2..<4]) : ""
    return locale == .es ? "\(dd)/\(mm)\(year)" : "\(mm)/\(dd)\(year)"
}

/// `mar 2024` / `Mar 2024`: axis labels.
public func formatMonthShort(_ year: Int, _ month: Int, _ locale: AppLocale) -> String {
    "\(monthShort(month, locale)) \(year)"
}

// MARK: - Instants in Argentine time

/// Argentina keeps UTC−3 all year (no daylight saving since 2009).
private let artOffsetSeconds = -3 * 3600

/// Seconds since the epoch in Argentine wall-clock terms, split into day number and second of day.
private func artClock(_ instant: Date) -> (days: Int, seconds: Int) {
    let total = Int((instant.timeIntervalSince1970).rounded(.down)) + artOffsetSeconds
    var days = total / 86400
    var seconds = total % 86400
    if seconds < 0 {
        seconds += 86400
        days -= 1
    }
    return (days, seconds)
}

/// The Argentine calendar day of an instant, `YYYY-MM-DD`.
public func artDay(_ instant: Date) -> String {
    let civil = civilFromDays(artClock(instant).days)
    return dayString(civil.year, civil.month, civil.day)
}

/// Argentine wall-clock time of an instant: `19:45`.
public func formatTime(_ instant: Date) -> String {
    let seconds = artClock(instant).seconds
    return pad(seconds / 3600, 2) + ":" + pad((seconds % 3600) / 60, 2)
}

/// Argentine date and time of an instant: `20 nov 2026, 19:45` / `Nov 20, 2026, 19:45`.
public func formatDateTime(_ instant: Date, _ locale: AppLocale) -> String {
    formatDay(artDay(instant), locale, short: true) + ", " + formatTime(instant)
}

/// Coarse elapsed time: `hace 5 min` / `5 min ago`, then hours, then days.
public func formatAgo(_ from: Date, _ now: Date, _ locale: AppLocale) -> String {
    let minutes = max(0, Int(now.timeIntervalSince(from) / 60))
    let amount: String
    if minutes < 60 {
        amount = "\(minutes) min"
    } else if minutes < 48 * 60 {
        amount = "\(minutes / 60) h"
    } else {
        amount = locale == .es ? "\(minutes / 1440) días" : "\(minutes / 1440) days"
    }
    return locale == .es ? "hace \(amount)" : "\(amount) ago"
}

/// Parses an amount typed in either notation (`1.234,5` or `1,234.5`); `nil` when it is not a number.
public func parseAmount(_ text: String, _ locale: AppLocale) -> Double? {
    var clean = String(text.unicodeScalars.filter { scalar in
        !(scalar == "$" || scalar == "\u{00A0}" || CharacterSet.whitespacesAndNewlines.contains(scalar))
    })
    if clean.isEmpty { return nil }
    if locale == .es {
        clean = clean.replacingOccurrences(of: ".", with: "")
        if let comma = clean.firstIndex(of: ",") { clean.replaceSubrange(comma...comma, with: ".") }
    } else {
        clean = clean.replacingOccurrences(of: ",", with: "")
    }
    // ^\d+(\.\d+)?$
    let parts = clean.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 1 || parts.count == 2 else { return nil }
    for part in parts where part.isEmpty || !part.allSatisfy({ ("0"..."9").contains($0) }) {
        return nil
    }
    return Double(clean)
}

// MARK: - ISO 8601 instants

/// Parses the API's timestamps (`2026-11-25T19:20:12.572-03:00`, `2026-11-25T15:10:12.572Z`, with or
/// without fractional seconds); `nil` for anything else. Written out rather than left to a
/// formatter, so it reads the same on every platform.
public func parseInstant(_ text: String) -> Date? {
    let c = Array(text.utf8)
    func digits(_ from: Int, _ count: Int) -> Int? {
        guard from + count <= c.count else { return nil }
        var value = 0
        for i in from..<(from + count) {
            let d = Int(c[i]) - 48
            guard d >= 0 && d <= 9 else { return nil }
            value = value * 10 + d
        }
        return value
    }
    func at(_ i: Int, _ char: Character) -> Bool { i < c.count && c[i] == char.asciiValue! }
    guard let year = digits(0, 4), at(4, "-"), let month = digits(5, 2), at(7, "-"), let day = digits(8, 2),
          at(10, "T") || at(10, " "), let hour = digits(11, 2), at(13, ":"), let minute = digits(14, 2)
    else { return nil }
    guard (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60 else { return nil }
    var i = 16
    var second = 0
    var fraction = 0.0
    if at(i, ":") {
        guard let s = digits(i + 1, 2), s < 60 else { return nil }
        second = s
        i += 3
        if at(i, ".") || at(i, ",") {
            i += 1
            var scale = 0.1
            let start = i
            while i < c.count, c[i] >= 48, c[i] <= 57 {
                fraction += Double(Int(c[i]) - 48) * scale
                scale /= 10
                i += 1
            }
            if i == start { return nil }
        }
    }
    var offset = 0
    if i == c.count {
        // No zone: Dart reads that as local time; the API always sends one. Taken as UTC.
    } else if at(i, "Z") || at(i, "z") {
        i += 1
    } else if at(i, "+") || at(i, "-") {
        let sign = at(i, "-") ? -1 : 1
        guard let oh = digits(i + 1, 2) else { return nil }
        var om = 0
        if at(i + 3, ":") {
            guard let m = digits(i + 4, 2) else { return nil }
            om = m
            i += 6
        } else if let m = digits(i + 3, 2) {
            om = m
            i += 5
        } else {
            i += 3
        }
        offset = sign * (oh * 3600 + om * 60)
    } else {
        return nil
    }
    guard i == c.count else { return nil }
    let days = daysFromCivil(year, month, day)
    let seconds = days * 86400 + hour * 3600 + minute * 60 + second - offset
    return Date(timeIntervalSince1970: Double(seconds) + fraction)
}

/// `2026-11-25T22:21:00.000Z`: how the cache stamps a fetch.
public func formatInstant(_ instant: Date) -> String {
    let millisTotal = Int((instant.timeIntervalSince1970 * 1000).rounded())
    var seconds = millisTotal / 1000
    var millis = millisTotal % 1000
    if millis < 0 {
        millis += 1000
        seconds -= 1
    }
    var days = seconds / 86400
    var rest = seconds % 86400
    if rest < 0 {
        rest += 86400
        days -= 1
    }
    let civil = civilFromDays(days)
    return dayString(civil.year, civil.month, civil.day) + "T" + pad(rest / 3600, 2) + ":" + pad((rest % 3600) / 60, 2) + ":"
        + pad(rest % 60, 2) + "." + pad(millis, 3) + "Z"
}
