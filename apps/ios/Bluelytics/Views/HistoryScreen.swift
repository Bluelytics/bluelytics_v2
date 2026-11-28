// History: the daily series since 2011 as a chart with range presets, a summary of the period and
// the days themselves, newest first.
import BluelyticsCore
import SwiftUI

struct HistoryScreen: View {
    /// Owned by the shell, so the Today tiles can open this screen on the gap.
    @Binding var mode: ChartMode
    @State private var range: RangePreset
    @EnvironmentObject private var model: AppModel

    init(mode: Binding<ChartMode>, initialRange: RangePreset = .y1) {
        _mode = mode
        _range = State(initialValue: initialRange)
    }

    var body: some View {
        let strings = model.strings
        let locale = strings.locale
        let store = model.store
        let days = rangeOf(store.series, range)
        let summary = PeriodSummary.of(days)
        // Presets longer than the recent days need the full history, which arrives a moment later.
        let waiting = !store.hasFullSeries && store.loading
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ContentWidth {
                    VStack(alignment: .leading, spacing: 0) {
                        Spacer().frame(height: 24)
                        styled(strings.historyTitle, BlType.h1()).accessibilityAddTraits(.isHeader)
                        Spacer().frame(height: 8)
                        styled(strings.historyLead, BlType.body()).fixedSize(horizontal: false, vertical: true)
                        Spacer().frame(height: 20)
                        Segmented(
                            values: ChartMode.allCases,
                            selected: mode,
                            label: { $0 == .rates ? strings.modeRates : strings.modeGap },
                            onChange: { mode = $0 },
                            accessibilityName: strings.chartOf
                        )
                        Spacer().frame(height: 10)
                        Segmented(
                            values: RangePreset.allCases,
                            selected: range,
                            label: { strings.rangeLabel($0) },
                            onChange: { range = $0 },
                            accessibilityName: strings.range
                        )
                        Spacer().frame(height: 18)
                        Panel(padding: EdgeInsets(top: 14, leading: 14, bottom: 0, trailing: 14)) {
                            RateChart(
                                days: days,
                                mode: mode,
                                locale: locale,
                                lineNames: [.blue: strings.blueShort, .oficial: strings.oficialShort, .gap: strings.gap],
                                emptyText: waiting ? strings.loadingHistory : strings.noData,
                                height: 240
                            )
                        }
                        if waiting {
                            Spacer().frame(height: 10)
                            styled(strings.loadingHistory, BlType.note())
                        }
                        if let summary {
                            Spacer().frame(height: 24)
                            Summary(summary: summary, strings: strings)
                        }
                        Spacer().frame(height: 36)
                        SectionHead(strings.dayByDay, note: summary.map { strings.daysCount($0.days) })
                        Spacer().frame(height: 14)
                        Hairline(strong: true)
                        DayRow.head(strings)
                    }
                }
                // Newest first.
                ForEach(Array(days.indices.reversed()), id: \.self) { index in
                    ContentWidth { DayRow(day: days[index], locale: locale) }
                }
                Spacer().frame(height: 40)
            }
        }
    }
}

/// Change, low, high and the current gap of the period, as a 2×2 ledger.
private struct Summary: View {
    let summary: PeriodSummary
    let strings: Strings

    var body: some View {
        let locale = strings.locale
        let change = summary.change
        let gap = gapRatio(summary.last.blue?.sell, summary.last.oficial?.sell)
        VStack(spacing: 0) {
            row(
                cell(
                    strings.change,
                    change.map { formatSignedPercent($0.ratio, locale) } ?? "–",
                    change == nil ? nil : "\(formatPesos(summary.first.blue!.sell, locale)) → \(formatPesos(summary.last.blue!.sell, locale))",
                    color: change.map { directionColor($0.direction, flat: Bl.text) } ?? Bl.text,
                    left: true
                ),
                cell(strings.gapNow, gap.map { formatPercent($0, locale) } ?? "–", strings.gapFoot, color: Bl.text, left: false)
            )
            row(
                cell(strings.lowest, formatPesos(summary.min.blue!.sell, locale), formatDay(summary.min.day, locale, short: true), color: Bl.text, left: true),
                cell(strings.highest, formatPesos(summary.max.blue!.sell, locale), formatDay(summary.max.day, locale, short: true), color: Bl.text, left: false)
            )
        }
        .overlay(alignment: .top) { Bl.lineStrong.frame(height: 1) }
    }

    private func row(_ a: some View, _ b: some View) -> some View {
        HStack(alignment: .top, spacing: 0) {
            a
            Hairline(vertical: true)
            b
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
    }

    private func cell(_ label: String, _ value: String, _ foot: String?, color: Color, left: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            styled(label.uppercased(), BlType.label())
            styled(value, sans(24, weight: 700, color: color, tracking: -0.04, height: 1.15, tabular: true))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let foot {
                styled(foot, BlType.note()).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(EdgeInsets(top: 12, leading: left ? 0 : 16, bottom: 14, trailing: left ? 12 : 0))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// One day of the table: date, blue sell, official sell and the gap.
private struct DayRow: View {
    let cells: [String]
    let head: Bool

    init(day: DayRates, locale: AppLocale) {
        let gap = gapRatio(day.blue?.sell, day.oficial?.sell)
        cells = [
            formatDayNumeric(day.day, locale, withYear: true),
            day.blue.map { formatAmount($0.sell, locale) } ?? "–",
            day.oficial.map { formatAmount($0.sell, locale) } ?? "–",
            gap.map { formatPercent($0, locale) } ?? "–",
        ]
        head = false
    }

    private init(cells: [String]) {
        self.cells = cells
        head = true
    }

    static func head(_ strings: Strings) -> DayRow {
        DayRow(cells: [strings.date, strings.blueShort, strings.oficialSellHead, strings.gap].map { $0.uppercased() })
    }

    var body: some View {
        let style = head ? BlType.label() : mono(13, weight: 500, color: Bl.text, height: 1.3)
        FlexRow(5, 4, 4, 4) {
            styled(cells[0], head ? style : mono(13, weight: 500, color: Bl.soft, height: 1.3)).frame(maxWidth: .infinity, alignment: .leading)
            styled(cells[1], style).frame(maxWidth: .infinity, alignment: .trailing)
            styled(cells[2], style).frame(maxWidth: .infinity, alignment: .trailing)
            styled(cells[3], head ? style : mono(13, weight: 500, color: Bl.muted, height: 1.3)).frame(maxWidth: .infinity, alignment: .trailing)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { (head ? Bl.lineStrong : Bl.line).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }
}
