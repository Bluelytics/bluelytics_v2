// Every icon in the app, drawn as strokes in a 24×24 box: the line weight matches the hairline
// look of the rest of the interface. The tab bar gets them as template images.
import BluelyticsCore
import SwiftUI
import UIKit

enum Glyph: CaseIterable {
    case today, history, calculator, bell, swap, chevronDown, arrowRight, external, check, search, close, refresh

    /// Strokes and filled parts, in the 24×24 box.
    var paths: (stroke: CGPath, fill: CGPath) {
        let line = CGMutablePath()
        let fill = CGMutablePath()
        func poly(_ xy: [CGFloat]) {
            line.move(to: CGPoint(x: xy[0], y: xy[1]))
            var i = 2
            while i < xy.count {
                line.addLine(to: CGPoint(x: xy[i], y: xy[i + 1]))
                i += 2
            }
        }
        switch self {
        case .today:
            // The blade: a rising stroke with its sliver.
            poly([3, 19, 9, 13, 13, 16, 21, 5])
            poly([15.5, 5, 21, 5, 21, 10.5])
        case .history:
            poly([4, 4, 4, 20, 20, 20])
            poly([7.5, 15.5, 11, 11.5, 14, 13.5, 19, 7])
        case .calculator:
            line.addRect(CGRect(x: 5, y: 3.5, width: 14, height: 17))
            poly([8.5, 8, 15.5, 8])
            for y: CGFloat in [12.5, 16.5] {
                for x: CGFloat in [8.75, 12, 15.25] {
                    fill.addRect(CGRect(x: x - 0.75, y: y - 0.75, width: 1.5, height: 1.5))
                }
            }
        case .bell:
            line.move(to: CGPoint(x: 5, y: 17))
            line.addLine(to: CGPoint(x: 7, y: 14.5))
            line.addLine(to: CGPoint(x: 7, y: 10.5))
            line.addCurve(to: CGPoint(x: 12, y: 5), control1: CGPoint(x: 7, y: 7.2), control2: CGPoint(x: 9.2, y: 5))
            line.addCurve(to: CGPoint(x: 17, y: 10.5), control1: CGPoint(x: 14.8, y: 5), control2: CGPoint(x: 17, y: 7.2))
            line.addLine(to: CGPoint(x: 17, y: 14.5))
            line.addLine(to: CGPoint(x: 19, y: 17))
            line.closeSubpath()
            poly([10.2, 20, 13.8, 20])
            poly([12, 3, 12, 5])
        case .swap:
            poly([8, 20, 8, 5])
            poly([4.5, 8.5, 8, 5, 11.5, 8.5])
            poly([16, 4, 16, 19])
            poly([12.5, 15.5, 16, 19, 19.5, 15.5])
        case .chevronDown:
            poly([6, 9.5, 12, 15.5, 18, 9.5])
        case .arrowRight:
            poly([4, 12, 19, 12])
            poly([13.5, 6.5, 19, 12, 13.5, 17.5])
        case .external:
            poly([7, 17, 17, 7])
            poly([9.5, 7, 17, 7, 17, 14.5])
        case .check:
            poly([5, 12.5, 10, 17.5, 19, 7])
        case .search:
            line.addEllipse(in: CGRect(x: 5, y: 5, width: 11, height: 11))
            poly([15, 15, 20, 20])
        case .close:
            poly([6, 6, 18, 18])
            poly([18, 6, 6, 18])
        case .refresh:
            line.addArc(center: CGPoint(x: 12, y: 12), radius: 7, startAngle: -0.6, endAngle: -0.6 + 5.0, clockwise: false)
            poly([14.5, 4.5, 18.6, 7.2, 15.6, 11])
        }
        return (line, fill)
    }

    /// A template image for UIKit (the tab bar), `size` points square.
    func image(size: CGFloat, stroke: CGFloat) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        let image = renderer.image { context in
            let cg = context.cgContext
            cg.scaleBy(x: size / 24, y: size / 24)
            let (line, fill) = paths
            cg.setStrokeColor(UIColor.black.cgColor)
            cg.setFillColor(UIColor.black.cgColor)
            cg.setLineWidth(stroke * 24 / size)
            cg.setLineCap(.square)
            cg.setLineJoin(.miter)
            cg.addPath(line)
            cg.strokePath()
            cg.addPath(fill)
            cg.fillPath()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }
}

struct GlyphIcon: View {
    let glyph: Glyph
    var size: CGFloat = 22
    var color: Color
    var stroke: CGFloat = 1.6

    init(_ glyph: Glyph, size: CGFloat = 22, color: Color, stroke: CGFloat = 1.6) {
        self.glyph = glyph
        self.size = size
        self.color = color
        self.stroke = stroke
    }

    var body: some View {
        Canvas { context, canvasSize in
            let scale = canvasSize.width / 24
            let (line, fill) = glyph.paths
            let transform = CGAffineTransform(scaleX: scale, y: scale)
            context.stroke(Path(line).applying(transform), with: .color(color), style: StrokeStyle(lineWidth: stroke, lineCap: .square, lineJoin: .miter))
            context.fill(Path(fill).applying(transform), with: .color(color))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The up/down triangle that goes with every move, so colour is never the only cue.
struct DirectionMark: View {
    let direction: Direction
    var size: CGFloat = 10
    let color: Color

    init(_ direction: Direction, size: CGFloat = 10, color: Color) {
        self.direction = direction
        self.size = size
        self.color = color
    }

    var body: some View {
        if direction != .flat {
            Canvas { context, canvas in
                let w = canvas.width, h = canvas.height
                var path = Path()
                if direction == .up {
                    path.move(to: CGPoint(x: w / 2, y: h * 0.1))
                    path.addLine(to: CGPoint(x: w * 0.95, y: h * 0.9))
                    path.addLine(to: CGPoint(x: w * 0.05, y: h * 0.9))
                } else {
                    path.move(to: CGPoint(x: w / 2, y: h * 0.9))
                    path.addLine(to: CGPoint(x: w * 0.05, y: h * 0.1))
                    path.addLine(to: CGPoint(x: w * 0.95, y: h * 0.1))
                }
                path.closeSubpath()
                context.fill(path, with: .color(color))
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
        }
    }
}
