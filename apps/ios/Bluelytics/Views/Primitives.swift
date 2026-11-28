// The small pieces of the "Editorial Bold" look shared by every screen.
import BluelyticsCore
import CoreText
import SwiftUI
import UIKit

// MARK: - Motion

private struct MotionKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// `false` with Reduce Motion on, and in the screenshot tests: loops stop, entrances are skipped.
    var motion: Bool {
        get { self[MotionKey.self] }
        set { self[MotionKey.self] = newValue }
    }
}

/// The site's ease-out (`cubic-bezier(0.2, 0.7, 0.2, 1)`).
func easeOut(_ duration: Double) -> Animation { .timingCurve(0.2, 0.7, 0.2, 1, duration: duration) }

// MARK: - Layout

/// The page background: ink with two soft glows at the top and a faint rule every 64 pt.
struct BlBackground: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            ZStack {
                Bl.ink
                // Flutter's `RadialGradient(center: Alignment(-0.64, -1.1), radius: 0.95)`: the radius is a
                // fraction of the shorter side, the centre an alignment in the box.
                RadialGradient(
                    colors: [Bl.navy.opacity(0.95), Bl.navy.opacity(0)],
                    center: UnitPoint(x: 0.18, y: -0.05),
                    startRadius: 0,
                    endRadius: min(size.width, size.height) * 0.95 * 0.7
                )
                RadialGradient(
                    colors: [Bl.brandDeep.opacity(0.16), Bl.brandDeep.opacity(0)],
                    center: UnitPoint(x: 1, y: 0),
                    startRadius: 0,
                    endRadius: min(size.width, size.height) * 0.7 * 0.7
                )
                Canvas { context, canvas in
                    var y: CGFloat = 0.5
                    while y < canvas.height {
                        var path = Path()
                        path.move(to: CGPoint(x: 0, y: y))
                        path.addLine(to: CGPoint(x: canvas.width, y: y))
                        context.stroke(path, with: .color(Bl.brandInk.opacity(0.035)), lineWidth: 1)
                        y += 64
                    }
                }
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// Centres a screen's column and keeps it readable on iPad.
struct ContentWidth<Content: View>: View {
    var padded = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, padded ? Bl.gutter : 0)
            .frame(maxWidth: Bl.maxWidth)
            .frame(maxWidth: .infinity)
    }
}

/// A 1 pt rule.
struct Hairline: View {
    var strong = false
    var vertical = false

    var body: some View {
        let color = strong ? Bl.lineStrong : Bl.line
        if vertical {
            color.frame(width: 1).frame(maxHeight: .infinity)
        } else {
            color.frame(height: 1).frame(maxWidth: .infinity)
        }
    }
}

/// A hairline panel: no soft card, no shadow.
struct Panel<Content: View>: View {
    var padding = EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [Bl.navy.opacity(0.5), Bl.surface.opacity(0.5)], startPoint: .top, endPoint: .bottom)
            )
            .clipShape(RoundedRectangle(cornerRadius: Bl.radius))
            .overlay(RoundedRectangle(cornerRadius: Bl.radius).strokeBorder(Bl.line, lineWidth: 1))
    }
}

/// A section title with the slanted blade tick in front.
struct SectionHead: View {
    let title: String
    var note: String? = nil

    init(_ title: String, note: String? = nil) {
        self.title = title
        self.note = note
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                LinearGradient(colors: [Bl.brandDeep, Bl.brand], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 18, height: 4.5)
                    .transformEffect(CGAffineTransform(a: 1, b: 0, c: -tan(32 * .pi / 180), d: 1, tx: 4.5 / 2 * tan(32 * .pi / 180), ty: 0))
                styled(title, BlType.h2())
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            if let note {
                styled(note, BlType.small())
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Moves

/// The social cards' diagonal-cut block with the day's move: `▲ +30 │ +1,83 %`.
struct MoveSlab: View {
    let move: Move
    let locale: AppLocale

    var body: some View {
        let style = mono(16.5, weight: 700, color: Bl.ink, tracking: -0.01, height: 1)
        let delta = formatSignedAmount(move.delta, locale)
        let percent = formatSignedPercent(move.ratio, locale, 2)
        HStack(spacing: 0) {
            if move.direction != .flat {
                DirectionMark(move.direction, size: 11, color: Bl.ink)
                Spacer().frame(width: 10)
            }
            styled(delta, style)
            Spacer().frame(width: 11)
            Bl.ink.opacity(0.35).frame(width: 1, height: 18)
            Spacer().frame(width: 11)
            styled(percent, style)
        }
        .lineLimit(1)
        .padding(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 28))
        .background(directionColor(move.direction))
        .clipShape(SlabShape())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(delta), \(percent)"))
    }
}

struct SlabShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - 16, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// The compact inline form of a move: `▲ +10 (+0,62 %)`.
struct MoveChip: View {
    let move: Move
    let locale: AppLocale

    var body: some View {
        let color = directionColor(move.direction)
        let background: Color = move.direction == .up ? Bl.upBg : (move.direction == .down ? Bl.downBg : Bl.flatBg)
        let text = "\(formatSignedAmount(move.delta, locale)) (\(formatSignedPercent(move.ratio, locale, 2)))"
        HStack(spacing: 6) {
            if move.direction != .flat {
                DirectionMark(move.direction, size: 8, color: color)
            }
            styled(text, mono(12, weight: 600, color: color, height: 1.2))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 2).fill(background))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Motion pieces

/// The dot in front of the "updated" stamp: pulsing green when live, still amber when not.
struct LiveDot: View {
    let live: Bool

    init(live: Bool) { self.live = live }

    @Environment(\.motion) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let color = live ? Bl.up : Bl.warn
        Group {
            if live && motion && !reduceMotion {
                TimelineView(.animation) { timeline in
                    let t = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                    dot(color, pulse: t)
                }
            } else {
                dot(color, pulse: nil)
            }
        }
        .frame(width: 7, height: 7)
        .accessibilityHidden(true)
    }

    private func dot(_ color: Color, pulse: Double?) -> some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            if let t = pulse, t < 0.7 {
                let spread = t / 0.7
                let r = 3.5 + 8 * spread
                context.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r)), with: .color(color.opacity(0.6 * (1 - spread))))
            }
            context.fill(Path(ellipseIn: CGRect(x: center.x - 3.5, y: center.y - 3.5, width: 7, height: 7)), with: .color(color))
        }
        .frame(width: 30, height: 30)
        .frame(width: 7, height: 7)
    }
}

/// Entrance: the content rises 14 pt while fading in, after `delay`. Skipped with reduced motion.
struct Rise: ViewModifier {
    var delay: Double = 0

    init(delay: Double = 0) { self.delay = delay }

    @State private var shown = false
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let still = !motion || reduceMotion
        content
            .opacity(still || shown ? 1 : 0.2)
            .offset(y: still || shown ? 0 : 14)
            .onAppear {
                guard !shown, !still else { return }
                withAnimation(easeOut(0.7).delay(delay)) { shown = true }
            }
    }
}

extension View {
    func rise(delay: Double = 0) -> some View { modifier(Rise(delay: delay)) }
}

// MARK: - Controls

/// A pressable area with a quiet highlight; at least 44 pt tall for touch.
struct Quiet: ButtonStyle {
    var minHeight: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minHeight: minHeight)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.linear(duration: 0.09), value: configuration.isPressed)
    }
}

/// The segmented control of the site (`.seg`, `.ranges`): mono caps in a hairline box.
struct Segmented<Value: Hashable>: View {
    let values: [Value]
    let selected: Value
    let label: (Value) -> String
    let onChange: (Value) -> Void
    var accessibilityName: String? = nil

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                cell(index, value)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 1))
        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Bl.lineStrong, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityName ?? ""))
    }

    private func cell(_ index: Int, _ value: Value) -> some View {
        let active = value == selected
        return Button {
            onChange(value)
        } label: {
            styled(label(value).uppercased(), mono(11.5, weight: active ? 600 : 500, color: active ? Bl.text : Bl.dim, tracking: 0.1, height: 1))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(active ? Bl.brand.opacity(0.22) : Color.clear)
                .overlay(alignment: .bottom) { (active ? Bl.brand : Color.clear).frame(height: 2) }
                .overlay(alignment: .leading) { (index == 0 ? Color.clear : Bl.line).frame(width: 1) }
        }
        .buttonStyle(Quiet(minHeight: 40))
        .accessibilityLabel(Text(verbatim: label(value)))
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

// MARK: - Wordmark

/// The site footer's outlined wordmark, running off the edge: the last thing on a screen.
struct Wordmark: View {
    var body: some View {
        WordmarkShape()
            .stroke(Bl.lineStrong, lineWidth: 1)
            .frame(height: 92)
            .frame(maxWidth: .infinity, alignment: .leading)
            .clipped()
            .accessibilityHidden(true)
    }
}

/// "bluelytics" in Geist 800 at 104 pt as outlines (SwiftUI text has no stroke).
struct WordmarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let size: CGFloat = 104
        let font = Fonts.ui(.sans, size, weight: 800) as CTFont
        let attributed = NSAttributedString(string: "bluelytics", attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTKernAttributeName as String): -0.025 * size,
        ])
        let line = CTLineCreateWithAttributedString(attributed)
        let outline = CGMutablePath()
        let runs = CTLineGetGlyphRuns(line) as? [CTRun] ?? []
        for run in runs {
            let count = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: count)
            var positions = [CGPoint](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
            for i in 0..<count {
                guard let glyph = CTFontCreatePathForGlyph(font, glyphs[i], nil) else { continue }
                // Glyph outlines are y-up from the baseline; flip them onto a y-down box with the
                // baseline at the font's ascent.
                let transform = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: Bl.gutter + positions[i].x, ty: rect.midY + CTFontGetCapHeight(font) / 2)
                outline.addPath(glyph, transform: transform)
            }
        }
        return Path(outline)
    }
}

// MARK: - Haptics

enum Haptics {
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}
