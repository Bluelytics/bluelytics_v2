// The brand blade behind the hero (geometry in BluelyticsCore/Blade.swift), sweeping in once from
// the left: it fades in while sliding 6 % across.
import BluelyticsCore
import SwiftUI

struct BladeView: View {
    let direction: Direction

    init(direction: Direction) { self.direction = direction }

    @State private var progress: Double = 0
    @Environment(\.motion) private var motion
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        BladeCanvas(direction: direction, progress: progress)
            .onAppear {
                if !motion || reduceMotion {
                    progress = 1
                } else if progress == 0 {
                    withAnimation(easeOut(1.1)) { progress = 1 }
                }
            }
            .accessibilityHidden(true)
    }
}

private struct BladeCanvas: View, Animatable {
    let direction: Direction
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        let shape = Blade.shape(direction)
        Canvas { context, size in
            guard size.width > 0, size.height > 0, progress > 0 else { return }
            // SVG `preserveAspectRatio="xMaxYMid slice"`: cover, anchored to the right edge.
            let scale = max(size.width / Blade.width, size.height / Blade.height)
            let dx = size.width - Blade.width * scale - (1 - progress) * 0.06 * size.width
            let dy = (size.height - Blade.height * scale) / 2
            let alpha = 0.8 * progress
            context.clip(to: Path(CGRect(origin: .zero, size: size)))
            context.translateBy(x: dx, y: dy)
            context.scaleBy(x: scale, y: scale)

            let bounds = shape.bandBounds
            let band = BladeCanvas.path(shape.band)
            context.fill(
                band,
                with: .linearGradient(
                    Gradient(stops: [
                        .init(color: Bl.brandDeep.opacity(0), location: 0),
                        .init(color: Color(argb: 0xFF00_5E9D).opacity(0.85 * alpha), location: 0.35),
                        .init(color: Bl.brand.opacity(alpha), location: 1),
                    ]),
                    startPoint: CGPoint(x: bounds.minX, y: bounds.maxY),
                    endPoint: CGPoint(x: bounds.maxX, y: bounds.minY)
                )
            )
            let sliverColor: Color = direction == .up ? Bl.up : (direction == .down ? Bl.down : Bl.brandInk)
            context.fill(BladeCanvas.path(shape.sliver), with: .color(sliverColor.opacity(alpha)))
        }
    }

    static func path(_ points: [Blade.Point]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: CGPoint(x: first.x, y: first.y))
        for point in points.dropFirst() { path.addLine(to: CGPoint(x: point.x, y: point.y)) }
        path.closeSubpath()
        return path
    }
}
