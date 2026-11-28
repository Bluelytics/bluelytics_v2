// Geist for text and figures, Geist Mono for labels and tabular numbers. Both are variable fonts:
// the weight is set on the `wght` axis, so any value from 100 to 900 is a real cut (750 included),
// never a synthetic bold.
import CoreText
import SwiftUI
import UIKit

enum FontFamily {
    case sans
    case mono

    /// The default named instance of each file; the `wght` variation moves it along the axis.
    var postScriptName: String {
        switch self {
        case .sans: return "Geist-Regular"
        case .mono: return "GeistMono-Regular"
        }
    }

    var file: String {
        switch self {
        case .sans: return "Geist-Variable"
        case .mono: return "GeistMono-Variable"
        }
    }
}

enum Fonts {
    /// `wght` as a 4-byte tag, the key CoreText wants in a variation dictionary.
    private static let weightAxis = NSNumber(value: 0x7767_6874)
    private static var cache: [String: UIFont] = [:]
    private static let lock = NSLock()

    /// Info.plist lists both files under UIAppFonts; this covers a build where they end up
    /// somewhere the system did not look (the test bundle, a renamed folder).
    static func registerIfNeeded() {
        for family in [FontFamily.sans, .mono] where UIFont(name: family.postScriptName, size: 12) == nil {
            let url = Bundle.main.url(forResource: family.file, withExtension: "ttf")
                ?? Bundle.main.url(forResource: family.file, withExtension: "ttf", subdirectory: "Fonts")
            if let url { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
        }
    }

    static func ui(_ family: FontFamily, _ size: CGFloat, weight: Double, tabular: Bool = false) -> UIFont {
        let key = "\(family.postScriptName)|\(size)|\(weight)|\(tabular)"
        lock.lock()
        defer { lock.unlock() }
        if let font = cache[key] { return font }
        var attributes: [CFString: Any] = [
            kCTFontNameAttribute: family.postScriptName,
            kCTFontVariationAttribute: [weightAxis: weight],
        ]
        if tabular {
            // kNumberSpacingType (6) / kMonospacedNumbersSelector (0): tabular figures.
            attributes[kCTFontFeatureSettingsAttribute] = [
                [kCTFontFeatureTypeIdentifierKey: 6, kCTFontFeatureSelectorIdentifierKey: 0],
            ]
        }
        let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
        let font = CTFontCreateWithFontDescriptor(descriptor, size, nil) as UIFont
        cache[key] = font
        return font
    }
}

/// One text style of the Flutter app's `sans(…)` / `mono(…)`: family, size, weight on the axis,
/// colour, tracking in em (CSS `letter-spacing`), and a line-height multiple.
struct TextStyle {
    var family: FontFamily
    var size: CGFloat
    var weight: Double
    var color: Color
    var tracking: CGFloat = 0
    var height: CGFloat? = nil
    var tabular = false
    /// The wordmark and the hero's big figure keep their own size whatever the text-size setting.
    var scales = true

    func with(color: Color) -> TextStyle {
        var copy = self
        copy.color = color
        return copy
    }

    func with(weight: Double) -> TextStyle {
        var copy = self
        copy.weight = weight
        return copy
    }
}

func sans(_ size: CGFloat, weight: Double = 400, color: Color = Bl.text, tracking: CGFloat = 0, height: CGFloat? = nil, tabular: Bool = false) -> TextStyle {
    TextStyle(family: .sans, size: size, weight: weight, color: color, tracking: tracking, height: height, tabular: tabular)
}

func mono(_ size: CGFloat, weight: Double = 500, color: Color = Bl.text, tracking: CGFloat = 0, height: CGFloat? = nil) -> TextStyle {
    TextStyle(family: .mono, size: size, weight: weight, color: color, tracking: tracking, height: height)
}

enum BlType {
    /// The small uppercase mono label over every figure. Write the text in upper case.
    static func label(_ color: Color = Bl.dim) -> TextStyle { mono(11, weight: 500, color: color, tracking: 0.14, height: 1.3) }
    static func body(_ color: Color = Bl.soft) -> TextStyle { sans(15, color: color, height: 1.5) }
    static func small(_ color: Color = Bl.dim) -> TextStyle { sans(13, color: color, height: 1.45) }
    /// Screen titles.
    static func h1() -> TextStyle { sans(34, weight: 800, tracking: -0.05, height: 1.05) }
    /// Section titles (with the blade tick, see `SectionHead`).
    static func h2() -> TextStyle { sans(21, weight: 800, tracking: -0.035, height: 1.15) }
    /// Mono caption under figures.
    static func note(_ color: Color = Bl.dim) -> TextStyle { mono(11.5, weight: 500, color: color, tracking: 0.04, height: 1.3) }
}

/// How much the person's text-size setting enlarges text. Like the Flutter app it stops at 1.3×,
/// a size the big figures can still take; past that the layout would no longer fit a phone.
func textScale(_ size: DynamicTypeSize) -> CGFloat {
    let body: CGFloat
    switch size {
    case .xSmall: body = 14
    case .small: body = 15
    case .medium: body = 16
    case .large: body = 17
    case .xLarge: body = 19
    case .xxLarge: body = 21
    case .xxxLarge: body = 23
    default: body = 28 // the accessibility sizes
    }
    return min(max(body / 17, 0.82), 1.3)
}

private struct Styled: ViewModifier {
    let style: TextStyle
    @Environment(\.dynamicTypeSize) private var dynamicType

    func body(content: Content) -> some View {
        let scale = style.scales ? textScale(dynamicType) : 1
        let size = style.size * scale
        let font = Fonts.ui(style.family, size, weight: style.weight, tabular: style.tabular)
        let extra = style.height.map { max(0, ($0 * size) - font.lineHeight) } ?? 0
        return content
            .font(Font(font as CTFont))
            .tracking(style.tracking * size)
            .lineSpacing(extra)
            .foregroundColor(style.color)
    }
}

extension View {
    func textStyle(_ style: TextStyle) -> some View { modifier(Styled(style: style)) }
}

/// `Text(…)` in a style, in one call.
func styled(_ text: String, _ style: TextStyle) -> some View {
    Text(verbatim: text).textStyle(style)
}
