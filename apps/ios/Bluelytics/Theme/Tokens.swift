// The one dark palette of the social cards' "Editorial Bold" (packages/social/design/final/card.mjs
// TOKENS), as on the website (apps/web/src/styles/global.css `:root`).
import BluelyticsCore
import SwiftUI
import UIKit

extension Color {
    /// `0xAARRGGBB`, as the Dart tokens were written.
    init(argb: UInt32) {
        self.init(
            .sRGB,
            red: Double((argb >> 16) & 0xFF) / 255,
            green: Double((argb >> 8) & 0xFF) / 255,
            blue: Double(argb & 0xFF) / 255,
            opacity: Double((argb >> 24) & 0xFF) / 255
        )
    }
}

extension UIColor {
    convenience init(argb: UInt32) {
        self.init(
            red: CGFloat((argb >> 16) & 0xFF) / 255,
            green: CGFloat((argb >> 8) & 0xFF) / 255,
            blue: CGFloat(argb & 0xFF) / 255,
            alpha: CGFloat((argb >> 24) & 0xFF) / 255
        )
    }
}

enum Bl {
    static let ink = Color(argb: 0xFF04_0A14)
    static let navy = Color(argb: 0xFF06_203D)
    static let surface = Color(argb: 0xFF06_1325)
    static let surface2 = Color(argb: 0xFF0A_1C34)

    /// Hairlines: brand-ink at 13 % and 30 %.
    static let line = Color(argb: 0x217D_BEFF)
    static let lineStrong = Color(argb: 0x4D7D_BEFF)

    static let text = Color(argb: 0xFFF4_F8FC)
    static let soft = Color(argb: 0xFFC3_D6EA)
    static let muted = Color(argb: 0xFFA9_BDD3)
    static let dim = Color(argb: 0xFF93_A9C2)

    static let brand = Color(argb: 0xFF1C_7FD6)
    static let brandDeep = Color(argb: 0xFF00_69AC)
    static let brandInk = Color(argb: 0xFF7D_BEFF)

    static let up = Color(argb: 0xFF2F_D67B)
    static let down = Color(argb: 0xFFFF_5D5D)
    static let warn = Color(argb: 0xFFFB_BF24)
    static let upBg = Color(argb: 0x242F_D67B)
    static let downBg = Color(argb: 0x24FF_5D5D)
    static let flatBg = Color(argb: 0x1AC3_D6EA)

    static let lineBlue = Color(argb: 0xFF4B_A3F0)
    static let lineOficial = Color(argb: 0xFF5C_C46E)
    static let lineGap = Color(argb: 0xFFFB_BF24)

    static let radius: CGFloat = 4

    /// Side gutter of every screen, and the widest a column of content gets on iPad.
    static let gutter: CGFloat = 16
    static let maxWidth: CGFloat = 620

    enum UI {
        static let ink = UIColor(argb: 0xFF04_0A14)
        static let text = UIColor(argb: 0xFFF4_F8FC)
        static let dim = UIColor(argb: 0xFF93_A9C2)
        static let brandInk = UIColor(argb: 0xFF7D_BEFF)
        static let line = UIColor(argb: 0x217D_BEFF)
    }
}

func directionColor(_ direction: Direction, flat: Color = Bl.soft) -> Color {
    switch direction {
    case .up: return Bl.up
    case .down: return Bl.down
    case .flat: return flat
    }
}

func lineColor(_ key: LineKey) -> Color {
    switch key {
    case .blue: return Bl.lineBlue
    case .oficial: return Bl.lineOficial
    case .gap: return Bl.lineGap
    }
}
