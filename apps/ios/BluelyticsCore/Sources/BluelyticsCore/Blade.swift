// The brand blade of the social cards (packages/social/design/final/card.mjs) and of the site's hero
// (apps/web/src/lib/blade.ts): a tapered ribbon along a cubic Bézier plus a thin sliver in the
// direction colour. Built in a fixed 1200×640 box; the app scales it to cover the hero, anchored
// right. Only the geometry lives here; the drawing is in the app.
import Foundation

public enum Blade {
    public static let width = 1200.0
    public static let height = 640.0
    static let extend = 600.0

    public struct Point: Equatable, Sendable {
        public let x: Double
        public let y: Double
    }

    /// Two closed outlines in the 1200×640 box: the band, and the sliver beside it.
    public struct Shape: Equatable, Sendable {
        public let band: [Point]
        public let sliver: [Point]

        /// Bounding box of the band: the band's gradient runs from its bottom-left to its top-right.
        public var bandBounds: (minX: Double, minY: Double, maxX: Double, maxY: Double) {
            var b = (minX: Double.infinity, minY: Double.infinity, maxX: -Double.infinity, maxY: -Double.infinity)
            for p in band {
                b.minX = Swift.min(b.minX, p.x)
                b.minY = Swift.min(b.minY, p.y)
                b.maxX = Swift.max(b.maxX, p.x)
                b.maxY = Swift.max(b.maxY, p.y)
            }
            return b
        }
    }

    private static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

    /// Centre line: up is a growth curve, down an inverted one, flat a long shallow sweep.
    static func curve(_ direction: Direction) -> [(Double, Double)] {
        if direction == .down {
            let p0 = (0.42 * width, -80.0)
            let p3 = (width + 80, 0.78 * height)
            return [p0, (lerp(p0.0, p3.0, 0.12), lerp(p0.1, p3.1, 0.7)), (lerp(p0.0, p3.0, 0.55), p3.1), p3]
        }
        let p0 = (-80.0, (direction == .up ? 0.92 : 0.7) * height)
        let p3 = direction == .up ? (0.98 * width, -80.0) : (width + 80, 0.12 * height)
        return [p0, (lerp(p0.0, p3.0, 0.4), p0.1), (lerp(p0.0, p3.0, 0.75), lerp(p0.1, p3.1, 0.3)), p3]
    }

    /// Point and unit normal of the curve at `t`.
    static func bez(_ p: [(Double, Double)], _ t: Double) -> (x: Double, y: Double, nx: Double, ny: Double) {
        let u = 1 - t
        let b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t
        let d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t
        let dx = d0 * (p[1].0 - p[0].0) + d1 * (p[2].0 - p[1].0) + d2 * (p[3].0 - p[2].0)
        let dy = d0 * (p[1].1 - p[0].1) + d1 * (p[2].1 - p[1].1) + d2 * (p[3].1 - p[2].1)
        let len = Swift.max((dx * dx + dy * dy).squareRoot(), 1e-9)
        return (
            b0 * p[0].0 + b1 * p[1].0 + b2 * p[2].0 + b3 * p[3].0,
            b0 * p[0].1 + b1 * p[1].1 + b2 * p[2].1 + b3 * p[3].1,
            dy / len,
            -dx / len
        )
    }

    public static func shape(_ direction: Direction, width bandWidth: Double = 260, steps n: Int = 64) -> Shape {
        let p = curve(direction)
        let sliverWidth = bandWidth * 0.06
        var top: [Point] = [], bottom: [Point] = [], sTop: [Point] = [], sBottom: [Point] = []
        var last = (x: 0.0, y: 0.0, nx: 0.0, ny: 1.0)
        for i in 0...n {
            let t = Double(i) / Double(n)
            last = bez(p, t)
            let (x, y, nx, ny) = last
            let half = (bandWidth / 2) * pow(t, 0.9)
            let gap = bandWidth * 0.06 * pow(t, 0.6)
            let sliver = sliverWidth * pow(t, 1.1)
            top.append(Point(x: x + nx * half, y: y + ny * half))
            bottom.append(Point(x: x - nx * half, y: y - ny * half))
            sTop.append(Point(x: x + nx * (half + gap + sliver), y: y + ny * (half + gap + sliver)))
            sBottom.append(Point(x: x + nx * (half + gap), y: y + ny * (half + gap)))
        }
        // Run both shapes on past the box along the end tangent, so they never end inside the hero.
        let tx = -last.ny * extend, ty = last.nx * extend
        func extended(_ side: [Point]) -> [Point] { side + [Point(x: side.last!.x + tx, y: side.last!.y + ty)] }
        return Shape(
            band: extended(top) + extended(bottom).reversed(),
            sliver: extended(sTop) + extended(sBottom).reversed()
        )
    }
}
