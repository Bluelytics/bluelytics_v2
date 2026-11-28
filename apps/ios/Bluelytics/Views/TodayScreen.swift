// Today: the tape, the blue dollar hero, the other rates and a quick dollars-to-pesos table.
import BluelyticsCore
import SwiftUI

struct TodayScreen: View {
    /// Opens the History tab in the given mode (from the official and gap tiles).
    let onOpenHistory: (ChartMode) -> Void

    init(onOpenHistory: @escaping (ChartMode) -> Void) { self.onOpenHistory = onOpenHistory }

    @EnvironmentObject private var model: AppModel

    var body: some View {
        let store = model.store
        if let snapshot = store.snapshot, let blue = snapshot.latest.blue {
            GeometryReader { proxy in
                ScrollView {
                    TodayContent(
                        snapshot: snapshot,
                        blue: blue,
                        extras: store.extras,
                        recent: store.recent,
                        offline: store.offline,
                        strings: model.strings,
                        width: min(proxy.size.width, Bl.maxWidth),
                        onOpenHistory: onOpenHistory
                    )
                    // Never wider than the screen, whatever a child asks for.
                    .frame(width: proxy.size.width, alignment: .leading)
                    .clipped()
                    .padding(.bottom, 8)
                }
                .refreshable { await store.refresh(force: true) }
            }
        } else {
            EmptyToday(failed: store.offline && !store.loading, strings: model.strings) {
                Task { await store.refresh(force: true) }
            }
        }
    }
}

/// Nothing to show yet: the first load is running, or it failed with an empty cache.
private struct EmptyToday: View {
    let failed: Bool
    let strings: Strings
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if failed {
                styled(strings.firstLoadFailed, BlType.h2()).multilineTextAlignment(.center)
                Spacer().frame(height: 8)
                styled(strings.firstLoadHint, BlType.body()).multilineTextAlignment(.center)
                Spacer().frame(height: 24)
                Button(action: retry) {
                    styled(strings.retry.uppercased(), mono(12.5, weight: 600, tracking: 0.12, height: 1))
                        .padding(.horizontal, 22)
                        .padding(.vertical, 14)
                        .background(RoundedRectangle(cornerRadius: 2).fill(Bl.brand))
                }
                .buttonStyle(Quiet())
            } else {
                styled(strings.loading.uppercased(), BlType.label())
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private let extraOrder = ["mep", "ccl", "cripto", "tarjeta", "mayorista"]

private struct TodayContent: View {
    let snapshot: Snapshot
    let blue: Quote
    let extras: [ExtraRate]
    let recent: [DayRates]
    let offline: Bool
    let strings: Strings
    let width: CGFloat
    let onOpenHistory: (ChartMode) -> Void

    private var locale: AppLocale { strings.locale }

    private var orderedExtras: [ExtraRate] {
        extraOrder.flatMap { code in extras.filter { $0.code == code } }
    }

    private func changeOf(_ move: Move?) -> String? { move.map { formatSignedPercent($0.ratio, locale, 2) } }

    private var tape: [TapeItem] {
        let latest = snapshot.latest
        var items = [TapeItem(label: strings.blue, value: formatPesos(blue.sell, locale), direction: snapshot.blueMove?.direction, change: changeOf(snapshot.blueMove))]
        if let oficial = latest.oficial {
            items.append(TapeItem(label: strings.oficial, value: formatPesos(oficial.sell, locale), direction: snapshot.oficialMove?.direction, change: changeOf(snapshot.oficialMove)))
        }
        if let euro = latest.blueEuro { items.append(TapeItem(label: strings.euroBlue, value: formatPesos(euro.sell, locale))) }
        if let gap = snapshot.gap { items.append(TapeItem(label: strings.gap, value: formatPercent(gap, locale))) }
        for rate in orderedExtras {
            items.append(TapeItem(label: strings.extraName(rate.code), value: formatPesosCents(rate.sell, locale)))
        }
        return items
    }

    private var tiles: [TileData] {
        let latest = snapshot.latest
        var tiles: [TileData] = []
        if let oficial = latest.oficial {
            tiles.append(TileData(
                label: strings.oficial,
                value: formatPesos(oficial.sell, locale),
                move: snapshot.oficialMove,
                foot: "\(strings.buy) \(formatPesos(oficial.buy, locale))",
                open: .rates
            ))
        }
        if let gap = snapshot.gap {
            tiles.append(TileData(label: strings.gapLong, value: formatPercent(gap, locale), move: nil, foot: strings.gapFoot, open: .gap))
        }
        if let euro = latest.blueEuro {
            tiles.append(TileData(label: strings.euroBlue, value: formatPesos(euro.sell, locale), move: nil, foot: "\(strings.buy) \(formatPesos(euro.buy, locale))", open: nil))
        }
        if let euro = latest.oficialEuro {
            tiles.append(TileData(label: strings.euroOficial, value: formatPesos(euro.sell, locale), move: nil, foot: "\(strings.buy) \(formatPesos(euro.buy, locale))", open: nil))
        }
        return tiles
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TickerTape(items: tape, accessibilityName: strings.allRates)
            Spacer().frame(height: 20)
            ContentWidth {
                Hero(strings: strings, blue: blue, snapshot: snapshot, offline: offline, chartDays: rangeOf(recent, .m1), width: width)
            }
            let tiles = self.tiles
            if !tiles.isEmpty {
                Spacer().frame(height: 28)
                ContentWidth { TileGrid(tiles: tiles, locale: locale, onOpen: onOpenHistory) }
            }
            let extras = orderedExtras
            if !extras.isEmpty {
                Spacer().frame(height: 36)
                ContentWidth {
                    VStack(alignment: .leading, spacing: 16) {
                        SectionHead(strings.otherRates, note: strings.otherRatesNote)
                        MiniGrid(items: extras.map { (strings.extraName($0.code), formatPesosCents($0.sell, locale)) })
                    }
                }
            }
            Spacer().frame(height: 36)
            ContentWidth { QuickTable(blue: blue, strings: strings) }
            Spacer().frame(height: 28)
            ContentWidth {
                styled(strings.disclaimer, BlType.small())
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Spacer().frame(height: 28)
            Wordmark()
        }
    }
}

/// The page's main quote in the social cards' language: the blade sweeps behind a very large sell
/// price, the move sits in a diagonal-cut slab, buy and average follow on a ruled ledger.
private struct Hero: View {
    let strings: Strings
    let blue: Quote
    let snapshot: Snapshot
    let offline: Bool
    let chartDays: [DayRates]
    let width: CGFloat

    var body: some View {
        let locale = strings.locale
        // The site's `clamp(4.6rem, 2.2rem + 12vw, 10.5rem)`.
        let figureSize = min(max(35.2 + 0.12 * width, 73.6), 132)
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                styled(strings.todayTitle, sans(19, weight: 700, color: Bl.soft, tracking: -0.02, height: 1.15))
                    .accessibilityAddTraits(.isHeader)
                if let updatedAt = snapshot.latest.updatedAt {
                    Stamp(strings: strings, updatedAt: updatedAt, offline: offline)
                }
            }
            .rise()
            Spacer().frame(height: 22)
            VStack(alignment: .leading, spacing: 0) {
                styled(strings.sell.uppercased(), BlType.label())
                Spacer().frame(height: 6)
                BigPrice(price: formatAmount(blue.sell, locale), size: figureSize)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: "\(strings.sell) \(formatPesos(blue.sell, locale))"))
                if let move = snapshot.blueMove {
                    Spacer().frame(height: 16)
                    FlowRow(spacing: 14, lineSpacing: 8) {
                        MoveSlab(move: move, locale: locale)
                        if let previous = snapshot.previousDay {
                            styled(strings.vsPrevious(formatDay(previous, locale, short: true)), BlType.note())
                        }
                    }
                }
            }
            .rise(delay: 0.08)
            Spacer().frame(height: 22)
            Ledger(entries: [(strings.buy, formatPesos(blue.buy, locale)), (strings.average, formatPesosCents(blue.average, locale))])
                .rise(delay: 0.16)
            if chartDays.count > 1 {
                Spacer().frame(height: 22)
                RateChart(
                    days: chartDays,
                    mode: .rates,
                    locale: locale,
                    lineNames: [.blue: strings.blueShort, .oficial: strings.oficialShort],
                    emptyText: strings.noData,
                    height: 150,
                    xTickCount: 3
                )
                .padding(EdgeInsets(top: 14, leading: 14, bottom: 0, trailing: 14))
                .background(Bl.ink.opacity(0.78))
                .overlay(Rectangle().strokeBorder(Bl.line, lineWidth: 1))
                .rise(delay: 0.24)
            }
        }
        .padding(EdgeInsets(top: 22, leading: 20, bottom: 20, trailing: 20))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                LinearGradient(
                    stops: [.init(color: Bl.navy, location: 0), .init(color: Bl.ink, location: 0.78)],
                    startPoint: UnitPoint(x: 0.2, y: 0),
                    endPoint: UnitPoint(x: 0.8, y: 1)
                )
                BladeView(direction: snapshot.blueMove?.direction ?? .flat)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: Bl.radius))
        .overlay(RoundedRectangle(cornerRadius: Bl.radius).strokeBorder(Bl.line, lineWidth: 1))
    }
}

/// `$` small and raised, then the price very large: shrinks to fit rather than wrapping.
private struct BigPrice: View {
    let price: String
    let size: CGFloat

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            styled("$", TextStyle(family: .sans, size: size * 0.36, weight: 600, color: Bl.soft, height: 1, scales: false))
                .padding(.top, size * 0.1)
                .padding(.trailing, size * 0.1)
            styled(price, TextStyle(family: .sans, size: size, weight: 800, color: Bl.text, tracking: -0.065, height: 0.9, tabular: true, scales: false))
                .shadow(color: Bl.ink.opacity(0.55), radius: 15, x: 0, y: 2)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.4)
    }
}

private struct Stamp: View {
    let strings: Strings
    let updatedAt: Date
    let offline: Bool

    var body: some View {
        let when = formatDateTime(updatedAt, strings.locale)
        let text = offline ? "\(strings.offline) · \(when)" : "\(strings.updated) \(when)"
        HStack(spacing: 8) {
            LiveDot(live: !offline)
            styled(text.uppercased(), mono(11, weight: 500, color: offline ? Bl.warn : Bl.dim, tracking: 0.08, height: 1.3))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Bl.ink.opacity(0.72))
    }
}

/// Two figures side by side under a strong rule, split by a hairline.
private struct Ledger: View {
    let entries: [(String, String)]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                if index > 0 { Hairline(vertical: true) }
                VStack(alignment: .leading, spacing: 4) {
                    styled(entry.0.uppercased(), BlType.label())
                    styled(entry.1, sans(25, weight: 700, tracking: -0.04, height: 1.15, tabular: true))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                .padding(.top, 12)
                .padding(.leading, index > 0 ? 18 : 0)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .overlay(alignment: .top) { Bl.lineStrong.frame(height: 1) }
    }
}

private struct TileData {
    let label: String
    let value: String
    let move: Move?
    let foot: String?
    let open: ChartMode?
}

/// A ruled ledger entry for one rate.
private struct Tile: View {
    let tile: TileData
    let locale: AppLocale
    let onOpen: (ChartMode) -> Void

    var body: some View {
        if let mode = tile.open {
            Button { onOpen(mode) } label: { content }
                .buttonStyle(Quiet())
                .accessibilityElement(children: .combine)
        } else {
            content.accessibilityElement(children: .combine)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                styled(tile.label.uppercased(), BlType.label())
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if tile.open != nil { GlyphIcon(.arrowRight, size: 14, color: Bl.dim, stroke: 1.4) }
            }
            styled(tile.value, sans(30, weight: 750, tracking: -0.045, height: 1.1, tabular: true))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if let move = tile.move { MoveChip(move: move, locale: locale) }
            if let foot = tile.foot {
                styled(foot, mono(12, weight: 500, color: Bl.dim, height: 1.3))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Tiles two to a row, ruled like a ledger page.
private struct TileGrid: View {
    let tiles: [TileData]
    let locale: AppLocale
    let onOpen: (ChartMode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(stride(from: 0, to: tiles.count, by: 2)), id: \.self) { i in
                HStack(alignment: .top, spacing: 0) {
                    Tile(tile: tiles[i], locale: locale, onOpen: onOpen)
                        .padding(EdgeInsets(top: 18, leading: 0, bottom: 18, trailing: 14))
                    Hairline(vertical: true)
                    Group {
                        if i + 1 < tiles.count {
                            Tile(tile: tiles[i + 1], locale: locale, onOpen: onOpen)
                        } else {
                            Color.clear
                        }
                    }
                    .padding(EdgeInsets(top: 18, leading: 16, bottom: 18, trailing: 0))
                }
                .fixedSize(horizontal: false, vertical: true)
                .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
            }
        }
        .overlay(alignment: .top) { Bl.lineStrong.frame(height: 1) }
    }
}

/// Small reference rates, two to a row: a brand rule on the left and a wash fading right.
private struct MiniGrid: View {
    let items: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], alignment: .leading, spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    styled(item.0.uppercased(), BlType.label())
                        .lineLimit(1)
                        .truncationMode(.tail)
                    styled(item.1, sans(20, weight: 700, tracking: -0.03, height: 1.2, tabular: true))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                .padding(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 8))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [Bl.brandDeep.opacity(0.12), Bl.brandDeep.opacity(0)], startPoint: .leading, endPoint: .trailing))
                .overlay(alignment: .leading) { Bl.brandDeep.frame(width: 2) }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// What 1 to 1,000 dollars come to at the blue rate.
private struct QuickTable: View {
    let blue: Quote
    let strings: Strings

    private static let amounts = [1, 10, 100, 500, 1000]

    var body: some View {
        let locale = strings.locale
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(strings.quickTitle)
            Spacer().frame(height: 14)
            Hairline(strong: true)
            row("USD", strings.ifYouBuy.uppercased(), strings.ifYouSell.uppercased(), head: true)
            ForEach(QuickTable.amounts, id: \.self) { amount in
                row(
                    "US$" + (locale == .es ? nbsp : "") + formatInteger(amount, locale),
                    formatPesos(amount * blue.sell, locale),
                    formatPesos(amount * blue.buy, locale),
                    head: false
                )
            }
            Spacer().frame(height: 12)
            styled(strings.quickNote, BlType.small())
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ a: String, _ b: String, _ c: String, head: Bool) -> some View {
        let style = head ? BlType.label() : mono(13.5, weight: 500, color: Bl.text, height: 1.3)
        let first = head ? style : mono(13.5, weight: 500, color: Bl.soft, height: 1.3)
        return FlexRow(3, 4, 4) {
            styled(a, first).frame(maxWidth: .infinity, alignment: .leading)
            styled(b, style).frame(maxWidth: .infinity, alignment: .trailing)
            styled(c, style).frame(maxWidth: .infinity, alignment: .trailing)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) { (head ? Bl.lineStrong : Bl.line).frame(height: 1) }
        .accessibilityElement(children: .combine)
    }
}
