import SwiftUI

/// Children side by side, each as wide as its share of `weights` (Flutter's `Expanded(flex:)`),
/// as tall as the tallest. For the tables, whose columns must line up from row to row.
struct FlexRow: Layout {
    let weights: [CGFloat]

    init(_ weights: CGFloat...) { self.weights = weights }

    private func widths(_ total: CGFloat, _ count: Int) -> [CGFloat] {
        let used = Array(weights.prefix(count)) + Array(repeating: 1, count: max(0, count - weights.count))
        let sum = used.reduce(0, +)
        return used.map { total * $0 / max(sum, 1) }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let total = proposal.width ?? 320
        let columns = widths(total, subviews.count)
        var height: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            height = max(height, subview.sizeThatFits(ProposedViewSize(width: columns[index], height: nil)).height)
        }
        return CGSize(width: total, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let columns = widths(bounds.width, subviews.count)
        var x = bounds.minX
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: columns[index], height: bounds.height))
            x += columns[index]
        }
    }
}
