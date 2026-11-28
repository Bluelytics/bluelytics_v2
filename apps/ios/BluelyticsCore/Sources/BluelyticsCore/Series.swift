// Pure transforms of the daily series for the hero, the tiles, the charts and the history table
// (the counterpart of apps/web/src/lib/series.ts and chart.ts).
import Foundation

public enum Direction: Sendable {
    case up
    case down
    case flat
}

/// Change from `previous` to `current`, both in hundredths.
public struct Move: Equatable, Sendable {
    public let previous: Int
    public let delta: Int
    public let ratio: Double
    public let direction: Direction

    public static func between(_ current: Int?, _ previous: Int?) -> Move? {
        guard let current, let previous, previous > 0 else { return nil }
        let delta = current - previous
        return Move(previous: previous, delta: delta, ratio: Double(delta) / Double(previous), direction: delta > 0 ? .up : (delta < 0 ? .down : .flat))
    }
}

/// Blue over official sell, minus one.
public func gapRatio(_ blueSell: Int?, _ oficialSell: Int?) -> Double? {
    guard let blueSell, let oficialSell, blueSell > 0, oficialSell > 0 else { return nil }
    return Double(blueSell) / Double(oficialSell) - 1
}

/// What the Today screen shows: the live quotes and their move against the previous close.
public struct Snapshot: Equatable, Sendable {
    public let latest: Latest
    /// The day the moves are measured against (`YYYY-MM-DD`).
    public let previousDay: String?
    public let blueMove: Move?
    public let oficialMove: Move?
    public let gap: Double?

    /// `days` is oldest first. The previous close is the last day with a blue quote before the
    /// Argentine day of `latest.updatedAt`.
    public static func of(_ latest: Latest, _ days: [DayRates]) -> Snapshot {
        var previous: DayRates?
        if let updatedAt = latest.updatedAt {
            let today = artDay(updatedAt)
            previous = days.last { $0.day < today && $0.blue != nil }
        }
        return Snapshot(
            latest: latest,
            previousDay: previous?.day,
            blueMove: Move.between(latest.blue?.sell, previous?.blue?.sell),
            oficialMove: Move.between(latest.oficial?.sell, previous?.oficial?.sell),
            gap: gapRatio(latest.blue?.sell, latest.oficial?.sell)
        )
    }
}

/// Recent days over the full history: `full` up to the first recent day, then `recent`.
/// `recent` is refreshed on every load, `full` a few times a day.
public func mergeSeries(_ full: [DayRates], _ recent: [DayRates]) -> [DayRates] {
    guard let first = recent.first?.day else { return full }
    if full.isEmpty { return recent }
    return full.filter { $0.day < first } + recent
}

public enum RangePreset: String, CaseIterable, Sendable {
    case m1
    case m3
    case m6
    case y1
    case y5
    case max

    /// Calendar days in the window; `nil` for the whole series.
    public var days: Int? {
        switch self {
        case .m1: return 31
        case .m3: return 92
        case .m6: return 183
        case .y1: return 366
        case .y5: return 1827
        case .max: return nil
        }
    }
}

/// First day (inclusive) of a preset window ending on `lastDay`; `nil` for the whole series.
public func rangeStart(_ lastDay: String, _ preset: RangePreset) -> String? {
    guard let span = preset.days else { return nil }
    let civil = civilFromDays(dayNumber(lastDay) - (span - 1))
    return dayString(civil.year, civil.month, civil.day)
}

/// The part of `days` with `day >= from`.
public func sliceFrom(_ days: [DayRates], _ from: String?) -> [DayRates] {
    guard let from else { return days }
    guard let start = days.firstIndex(where: { $0.day >= from }) else { return [] }
    return Array(days[start...])
}

/// The days of a preset window ending on the last day of `days`.
public func rangeOf(_ days: [DayRates], _ preset: RangePreset) -> [DayRates] {
    guard let last = days.last else { return days }
    return sliceFrom(days, rangeStart(last.day, preset))
}

/// First, last, lowest and highest blue sell of a set of days.
public struct PeriodSummary: Equatable, Sendable {
    public let first: DayRates
    public let last: DayRates
    public let min: DayRates
    public let max: DayRates
    public let days: Int

    public var change: Move? { Move.between(last.blue?.sell, first.blue?.sell) }

    public static func of(_ days: [DayRates]) -> PeriodSummary? {
        let withBlue = days.filter { $0.blue != nil }
        guard var low = withBlue.first, var high = withBlue.first else { return nil }
        for d in withBlue {
            if d.blue!.sell < low.blue!.sell { low = d }
            if d.blue!.sell > high.blue!.sell { high = d }
        }
        return PeriodSummary(first: withBlue.first!, last: withBlue.last!, min: low, max: high, days: withBlue.count)
    }
}

// MARK: - Chart model

public enum ChartMode: CaseIterable, Sendable {
    case rates
    case gap
}

public enum LineKey: String, Sendable {
    case blue
    case oficial
    case gap
}

public struct PlotLine: Equatable, Sendable {
    public let key: LineKey
    /// Pesos (rates) or percent (gap) per day; `nil` = no value that day.
    public let values: [Double?]

    public init(_ key: LineKey, _ values: [Double?]) {
        self.key = key
        self.values = values
    }
}

public struct Tick: Equatable, Sendable {
    /// 0 = left/top, 1 = right/bottom.
    public let pos: Double
    public let label: String
}

/// Fraction of the height kept free above and below the data.
public let chartPad = 0.06

public struct ChartModel: Equatable, Sendable {
    public let days: [String]
    public let lines: [PlotLine]
    public let mode: ChartMode
    public let yMin: Double
    public let yMax: Double
    public let yTicks: [Tick]
    public let xTicks: [Tick]

    public var isEmpty: Bool { days.isEmpty || lines.allSatisfy { $0.values.allSatisfy { $0 == nil } } }

    /// Horizontal position (0–1) of day `index`.
    public func xPos(_ index: Int) -> Double { days.count <= 1 ? 0.5 : Double(index) / Double(days.count - 1) }

    /// Vertical position (0–1 from the top) of a value.
    public func yPos(_ value: Double) -> Double { 1 - chartPad - ((value - yMin) / (yMax - yMin)) * (1 - 2 * chartPad) }
}

/// Blue and official sell in pesos, or the gap in percent `(blue / oficial − 1) × 100`.
public func linesFor(_ mode: ChartMode, _ days: [DayRates]) -> [PlotLine] {
    if mode == .rates {
        return [
            PlotLine(.oficial, days.map { $0.oficial.map { Double($0.sell) / 100 } }),
            PlotLine(.blue, days.map { $0.blue.map { Double($0.sell) / 100 } }),
        ]
    }
    return [PlotLine(.gap, days.map { d in gapRatio(d.blue?.sell, d.oficial?.sell).map { $0 * 100 } })]
}

private func log10Floor(_ x: Double) -> Double {
    // Powers of ten by repeated scaling: exact for the axis steps this is used for.
    var exponent = 0
    var value = x
    while value >= 10 {
        value /= 10
        exponent += 1
    }
    while value < 1 {
        value *= 10
        exponent -= 1
    }
    return Double(exponent)
}

private func pow10(_ exponent: Double) -> Double {
    var result = 1.0
    let n = Int(Swift.abs(exponent))
    for _ in 0..<n { result *= 10 }
    return exponent < 0 ? 1 / result : result
}

private func niceStep(_ raw: Double) -> Double {
    guard raw > 0, raw.isFinite else { return 1 }
    let power = pow10(log10Floor(raw))
    let fraction = raw / power
    let nice: Double = fraction <= 1 ? 1 : (fraction <= 2 ? 2 : (fraction <= 2.5 ? 2.5 : (fraction <= 5 ? 5 : 10)))
    return nice * power
}

/// Round axis bounds and a step that gives about `count` intervals.
public func niceScale(_ min: Double, _ max: Double, _ count: Int = 4) -> (min: Double, max: Double, step: Double) {
    guard min.isFinite, max.isFinite else { return (0, 1, 1) }
    var low = min
    var high = max
    if low == high {
        let spread = Swift.abs(low) * 0.05 == 0 ? 1.0 : Swift.abs(low) * 0.05
        low -= spread
        high += spread
    }
    let step = niceStep((high - low) / Double(count))
    return ((low / step).rounded(.down) * step, (high / step).rounded(.up) * step, step)
}

private func yLabel(_ value: Double, _ mode: ChartMode, _ step: Double, _ locale: AppLocale) -> String {
    if mode == .rates {
        // Old values are a few pesos: keep a decimal when the step is below one peso.
        return step < 1 ? formatHundredths(Int((value * 100).rounded()), locale) : formatInteger(Int(value.rounded()), locale)
    }
    return formatPercent(value / 100, locale, step < 1 ? 1 : 0)
}

private func xTicks(_ days: [String], _ locale: AppLocale, _ count: Int) -> [Tick] {
    guard let firstDay = days.first, let lastDay = days.last else { return [] }
    let spanDays = dayNumber(lastDay) - dayNumber(firstDay)
    func label(_ day: String) -> String {
        if spanDays <= 100 { return formatDayNumeric(day, locale) }
        let p = dayParts(day)
        if spanDays <= 3 * 366 { return formatMonthShort(p.year, p.month, locale) }
        return String(day.prefix(4))
    }
    var ticks: [Tick] = []
    let n = count < days.count ? count : days.count
    for i in 0..<n {
        let index = n == 1 ? days.count - 1 : Int((Double(i * (days.count - 1)) / Double(n - 1)).rounded())
        let text = label(days[index])
        if let last = ticks.last, last.label == text { continue }
        ticks.append(Tick(pos: days.count == 1 ? 0.5 : Double(index) / Double(days.count - 1), label: text))
    }
    return ticks
}

public func buildChart(_ days: [DayRates], _ mode: ChartMode, _ locale: AppLocale, xTickCount: Int = 4) -> ChartModel {
    let lines = linesFor(mode, days)
    let names = days.map(\.day)
    var low = Double.infinity
    var high = -Double.infinity
    for line in lines {
        for case let value? in line.values {
            if value < low { low = value }
            if value > high { high = value }
        }
    }
    let scale = niceScale(low, high)
    var yTicks: [Tick] = []
    var v = scale.min
    while v <= scale.max + scale.step / 2 {
        yTicks.append(Tick(pos: 1 - chartPad - ((v - scale.min) / (scale.max - scale.min)) * (1 - 2 * chartPad), label: yLabel(v, mode, scale.step, locale)))
        v += scale.step
    }
    return ChartModel(days: names, lines: lines, mode: mode, yMin: scale.min, yMax: scale.max, yTicks: yTicks, xTicks: xTicks(names, locale, xTickCount))
}
