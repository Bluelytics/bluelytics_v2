// Line chart of the daily series: blue and official sell, or the gap between them. Touch and drag
// to read any day; the line above the plot is both legend and readout.
import BluelyticsCore
import CoreText
import SwiftUI

/// At most this many vertices per drawn line; the readout still reads every day.
private let maxVertices = 480

struct RateChart: View {
    /// Oldest first.
    let days: [DayRates]
    let mode: ChartMode
    let locale: AppLocale
    /// Legend text of each line.
    let lineNames: [LineKey: String]
    let emptyText: String
    var height: CGFloat = 220
    var xTickCount = 4

    init(days: [DayRates], mode: ChartMode, locale: AppLocale, lineNames: [LineKey: String], emptyText: String, height: CGFloat = 220, xTickCount: Int = 4) {
        self.days = days
        self.mode = mode
        self.locale = locale
        self.lineNames = lineNames
        self.emptyText = emptyText
        self.height = height
        self.xTickCount = xTickCount
    }

    @State private var scrub: Int?
    @State private var release: DispatchWorkItem?

    var body: some View {
        // Rebuilt only when what it depends on changes: SwiftUI keeps `ChartBody` while the inputs
        // are equal.
        ChartBody(
            model: buildChart(days, mode, locale, xTickCount: xTickCount),
            locale: locale,
            lineNames: lineNames,
            emptyText: emptyText,
            height: height,
            scrub: $scrub,
            release: $release
        )
        .onChange(of: days) { _ in resetScrub() }
        .onChange(of: mode) { _ in resetScrub() }
        .onChange(of: locale) { _ in resetScrub() }
    }

    private func resetScrub() {
        release?.cancel()
        scrub = nil
    }
}

private struct ChartBody: View {
    let model: ChartModel
    let locale: AppLocale
    let lineNames: [LineKey: String]
    let emptyText: String
    let height: CGFloat
    @Binding var scrub: Int?
    @Binding var release: DispatchWorkItem?

    /// The day the readout shows: the scrubbed one, else the last with any value.
    private var shown: Int? {
        if let scrub { return scrub }
        for i in stride(from: model.days.count - 1, through: 0, by: -1) where model.lines.contains(where: { $0.values[i] != nil }) {
            return i
        }
        return nil
    }

    private func valueText(_ value: Double) -> String {
        model.mode == .gap ? formatPercent(value / 100, locale) : formatPesos(Int((value * 100).rounded()), locale)
    }

    var body: some View {
        if model.isEmpty {
            styled(emptyText, BlType.small())
                .frame(maxWidth: .infinity)
                .frame(height: height)
        } else {
            chart
        }
    }

    private var chart: some View {
        let index = shown
        let day = index.map { model.days[$0] }
        let entries: [(key: LineKey, name: String, value: Double?)] = model.lines.map { line in
            (line.key, lineNames[line.key] ?? line.key.rawValue, index.flatMap { line.values[$0] })
        }
        var spokenParts: [String] = []
        if let day { spokenParts.append(formatDay(day, locale)) }
        for entry in entries {
            if let value = entry.value { spokenParts.append("\(entry.name) \(valueText(value))") }
        }
        return VStack(alignment: .leading, spacing: 8) {
            Legend(
                day: day.map { formatDay($0, locale, short: true) },
                scrubbing: scrub != nil,
                entries: entries.map { LegendEntry(id: $0.key, name: $0.name, value: $0.value.map(valueText) ?? "–") }
            )
            GeometryReader { proxy in
                Plot(model: model, scrub: scrub)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in scrubTo(value.location.x, proxy.size.width) }
                            .onEnded { _ in letGo() }
                    )
            }
            .frame(height: height)
            XAxis(ticks: model.xTicks)
                .frame(height: 26)
                .padding(.top, -8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(Text(verbatim: spokenParts.joined(separator: ", ")))
    }

    private func scrubTo(_ x: CGFloat, _ width: CGFloat) {
        let count = model.days.count
        guard count > 0, width > 0 else { return }
        let index = count == 1 ? 0 : min(max(Int(((x / width) * CGFloat(count - 1)).rounded()), 0), count - 1)
        release?.cancel()
        guard index != scrub else { return }
        Haptics.selection()
        scrub = index
    }

    /// The reading stays a moment after the finger lifts, then the chart goes back to the last day.
    private func letGo() {
        release?.cancel()
        let work = DispatchWorkItem { scrub = nil }
        release = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }
}

private struct LegendEntry: Identifiable {
    let id: LineKey
    let name: String
    let value: String
}

private struct Legend: View {
    let day: String?
    let scrubbing: Bool
    let entries: [LegendEntry]

    var body: some View {
        FlowRow(spacing: 14, lineSpacing: 4) {
            if let day {
                styled(day, mono(12.5, weight: 500, color: scrubbing ? Bl.text : Bl.dim, height: 1.4))
            }
            ForEach(entries) { entry in
                HStack(spacing: 6) {
                    lineColor(entry.id).frame(width: 10, height: 3)
                    styled(entry.name, mono(12.5, weight: 500, color: lineColor(entry.id), height: 1.4))
                    styled(entry.value, mono(12.5, weight: 600, color: Bl.text, height: 1.4))
                }
                .fixedSize()
            }
        }
    }
}

private struct XAxis: View {
    let ticks: [Tick]

    var body: some View {
        GeometryReader { proxy in
            ForEach(Array(ticks.enumerated()), id: \.offset) { _, tick in
                styled(tick.label, mono(10.5, weight: 500, color: Bl.dim, height: 1))
                    .fixedSize()
                    .alignmentGuide(.leading) { d in
                        // Flutter's `Alignment(pos * 2 − 1, 0)`: the label slides from flush left to flush right.
                        -(proxy.size.width - d.width) * CGFloat(tick.pos)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }
    }
}

private struct Plot: View {
    let model: ChartModel
    let scrub: Int?

    var body: some View {
        Canvas { context, size in
            draw(&context, size)
        }
    }

    private func draw(_ context: inout GraphicsContext, _ size: CGSize) {
        let w = size.width, h = size.height
        for tick in model.yTicks {
            let y = (CGFloat(tick.pos) * h).rounded() + 0.5
            var grid = Path()
            grid.move(to: CGPoint(x: 0, y: y))
            grid.addLine(to: CGPoint(x: w, y: y))
            context.stroke(grid, with: .color(Bl.line), lineWidth: 1)
        }

        let count = model.days.count
        let stride = min(max(Int((Double(count) / Double(maxVertices)).rounded(.up)), 1), max(count, 1))
        for line in model.lines {
            let color = lineColor(line.key)
            var path = Path()
            var first: CGPoint?
            var last: CGPoint?
            var pen = false
            for i in 0..<count {
                // Every `stride`-th day, and always the last one so the line ends on today.
                if i % stride != 0 && i != count - 1 { continue }
                guard let value = line.values[i] else {
                    pen = false
                    continue
                }
                let point = CGPoint(x: CGFloat(model.xPos(i)) * w, y: CGFloat(model.yPos(value)) * h)
                if pen {
                    path.addLine(to: point)
                } else {
                    path.move(to: point)
                    pen = true
                }
                if first == nil { first = point }
                last = point
            }
            guard let start = first, let end = last else { continue }

            // The leading line (blue, or the gap) sits on a soft wash down to the axis.
            if line.key != .oficial && start != end {
                var area = path
                area.addLine(to: CGPoint(x: end.x, y: h))
                area.addLine(to: CGPoint(x: start.x, y: h))
                area.closeSubpath()
                context.fill(area, with: .linearGradient(Gradient(colors: [color.opacity(0.2), color.opacity(0)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
            }
            context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            if scrub == nil {
                context.fill(Path(ellipseIn: CGRect(x: end.x - 3, y: end.y - 3, width: 6, height: 6)), with: .color(color))
            }
        }

        // Axis labels go over the lines, on a patch of the background so both stay readable.
        let labelFont = Font(Fonts.ui(.mono, 10.5, weight: 500) as CTFont)
        for tick in model.yTicks {
            let y = (CGFloat(tick.pos) * h).rounded() + 0.5
            let text = context.resolve(Text(verbatim: tick.label).font(labelFont).foregroundColor(Bl.dim))
            let measured = text.measure(in: CGSize(width: w, height: 40))
            let origin = CGPoint(x: 0, y: y - measured.height - 4)
            context.fill(Path(CGRect(x: origin.x - 2, y: origin.y - 2, width: measured.width + 8, height: measured.height + 4)), with: .color(Bl.ink.opacity(0.72)))
            context.draw(text, at: origin, anchor: .topLeading)
        }

        if let index = scrub, index < count {
            let x = CGFloat(model.xPos(index)) * w
            var rule = Path()
            rule.move(to: CGPoint(x: x, y: 0))
            rule.addLine(to: CGPoint(x: x, y: h))
            context.stroke(rule, with: .color(Bl.lineStrong), lineWidth: 1)
            for line in model.lines {
                guard let value = line.values[index] else { continue }
                let y = CGFloat(model.yPos(value)) * h
                context.fill(Path(ellipseIn: CGRect(x: x - 5.5, y: y - 5.5, width: 11, height: 11)), with: .color(Bl.ink))
                context.fill(Path(ellipseIn: CGRect(x: x - 3.5, y: y - 3.5, width: 7, height: 7)), with: .color(lineColor(line.key)))
            }
        }
    }
}

/// Children left to right, wrapping onto new lines (Flutter's `Wrap`). iOS 16 has `Layout`.
struct FlowRow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 4
    var verticalAlignment: VerticalAlignment = .center

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = arrange(width, subviews)
        let height = rows.reduce(CGFloat(0)) { $0 + $1.height } + lineSpacing * CGFloat(max(rows.count - 1, 0))
        let used = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? used, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                let dy = verticalAlignment == .top ? 0 : (row.height - size.height) / 2
                subviews[index].place(at: CGPoint(x: x, y: y + dy), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.items.isEmpty ? size.width : current.width + spacing + size.width
            if !current.items.isEmpty && needed > width {
                rows.append(current)
                current = Row()
            }
            current.width = current.items.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.items.append(index)
        }
        if !current.items.isEmpty { rows.append(current) }
        return rows
    }
}
