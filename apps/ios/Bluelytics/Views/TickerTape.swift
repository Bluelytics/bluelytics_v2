// A market tape with every published rate, scrolling like a trading-floor board (the site's
// `Ticker.astro`). It runs on its own, can be dragged sideways and waits while it is held. With
// Reduce Motion it stands still and scrolls like any list.
import BluelyticsCore
import SwiftUI

struct TapeItem: Hashable {
    let label: String
    let value: String
    var direction: Direction? = nil
    var change: String? = nil

    var spoken: String { change.map { "\(label) \(value), \($0)" } ?? "\(label) \(value)" }
}

private struct CopyWidth: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct TickerTape: View {
    let items: [TapeItem]
    let accessibilityName: String

    init(items: [TapeItem], accessibilityName: String) {
        self.items = items
        self.accessibilityName = accessibilityName
    }


    /// Points per second.
    static let speed: Double = 34

    @State private var copyWidth: CGFloat = 0
    @State private var start = Date()
    @State private var heldSince: Date?
    @State private var held: TimeInterval = 0
    @State private var dragged: CGFloat = 0
    @State private var dragging: CGFloat = 0
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if !items.isEmpty {
            // The size comes from this clear strip, never from the tape: the moving tape is three
            // copies wide (thousands of points) and, reported as the ticker's width, it widened the
            // whole Today column so everything under the ticker was centred off screen.
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 38)
                .overlay(alignment: .leading) { content }
                .clipped()
                .background(Bl.navy.opacity(0.45))
                .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "\(accessibilityName): \(items.map(\.spoken).joined(separator: "; "))"))
        }
    }

    @ViewBuilder private var content: some View {
        if !motion || reduceMotion {
            ScrollView(.horizontal, showsIndicators: false) {
                row.padding(.leading, Bl.gutter)
            }
        } else {
            TimelineView(.animation(minimumInterval: nil, paused: heldSince != nil)) { timeline in
                let elapsed = (heldSince ?? timeline.date).timeIntervalSince(start) - held
                let travelled = CGFloat(elapsed * TickerTape.speed) - dragged - dragging
                HStack(spacing: 0) {
                    row.background(GeometryReader { proxy in Color.clear.preference(key: CopyWidth.self, value: proxy.size.width) })
                    row
                    row
                }
                .padding(.leading, Bl.gutter)
                .offset(x: -wrap(travelled))
            }
            .onPreferenceChange(CopyWidth.self) { copyWidth = $0 }
            .simultaneousGesture(
                DragGesture(minimumDistance: 6)
                    .onChanged { value in
                        if heldSince == nil { heldSince = Date() }
                        dragging = value.translation.width
                    }
                    .onEnded { value in
                        dragged += value.translation.width
                        dragging = 0
                        if let since = heldSince { held += Date().timeIntervalSince(since) }
                        heldSince = nil
                    }
            )
        }
    }

    private func wrap(_ x: CGFloat) -> CGFloat {
        guard copyWidth > 0 else { return 0 }
        return x - (x / copyWidth).rounded(.down) * copyWidth
    }

    private var row: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.self) { item in
                TapeCell(item: item)
            }
        }
        .fixedSize()
    }
}

private struct TapeCell: View {
    let item: TapeItem

    var body: some View {
        let direction = item.direction ?? .flat
        let changeColor = directionColor(direction, flat: Bl.dim)
        HStack(spacing: 0) {
            styled(item.label.uppercased(), mono(11, weight: 500, color: Bl.dim, tracking: 0.1, height: 1))
            Spacer().frame(width: 10)
            styled(item.value, mono(12.5, weight: 600, color: Bl.text, height: 1))
            if let change = item.change {
                Spacer().frame(width: 10)
                if direction != .flat {
                    DirectionMark(direction, size: 7, color: changeColor)
                    Spacer().frame(width: 5)
                }
                styled(change, mono(11.5, weight: 500, color: changeColor, height: 1))
            }
            Spacer().frame(width: 18)
            styled("/", mono(12.5, weight: 500, color: Bl.lineStrong, height: 1))
            Spacer().frame(width: 18)
        }
        .lineLimit(1)
        .fixedSize()
    }
}
