// Renders the eight views of the Flutter screenshot test, in both languages, to PNG files:
//
//   TEST_RUNNER_SNAPSHOT_DIR=$PWD/build/screenshots xcodebuild test ... (see tool/ci.sh)
//
// The views are fed from the fixtures (no network) with the clock at the fixtures' capture time.
// Nothing is compared against stored images, so a font or OS update never fails the suite; without
// SNAPSHOT_DIR the test is skipped.
import BluelyticsCore
import SwiftUI
import UIKit
import XCTest
@testable import Bluelytics

private let fixtureNow = Date(timeIntervalSince1970: 1_795_645_260) // 2026-11-25T22:21:00Z

private func fixture(_ name: String) -> String {
    let bundle = Bundle(for: ScreenshotTests.self)
    let url = bundle.url(forResource: name, withExtension: "json")
        ?? bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
    guard let url, let text = try? String(contentsOf: url, encoding: .utf8) else {
        fatalError("missing fixture \(name).json")
    }
    return text
}

/// Answers every feed from the fixtures.
private final class FixtureClient: HTTPClient, @unchecked Sendable {
    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        guard let feed = Feed.allCases.first(where: { $0.url == url.absoluteString }) else { return (404, Data()) }
        return (200, Data(fixture(feed.rawValue).utf8))
    }
}

/// Alerts already on (saved in the preferences below).
@MainActor
private final class FakePush: PushBackend {
    var onMessage: ((AlertMessage) -> Void)?
    var supported: Bool { true }
    func enable() async throws -> Bool { true }
    func disable() async throws {}
    func resume() async throws {}
}

private struct Shot {
    let name: String
    let tab: AppTab
    var mode: ChartMode = .rates
    var range: RangePreset = .y1
    var picker = false
    var scroll: CGFloat = 0
}

private let shots: [Shot] = [
    Shot(name: "1-today", tab: .today),
    Shot(name: "2-today-more", tab: .today, scroll: 620),
    Shot(name: "3-today-end", tab: .today, scroll: 1820),
    Shot(name: "4-history", tab: .history),
    Shot(name: "5-history-gap", tab: .history, mode: .gap, range: .max),
    Shot(name: "6-calculator", tab: .calculator),
    Shot(name: "7-currencies", tab: .calculator, picker: true),
    Shot(name: "8-alerts", tab: .alerts),
]

@MainActor
final class ScreenshotTests: XCTestCase {
    func testScreens() async throws {
        let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? ""
        try XCTSkipIf(dir.isEmpty, "set SNAPSHOT_DIR (TEST_RUNNER_SNAPSHOT_DIR for xcodebuild) to write screenshots")
        let out = URL(fileURLWithPath: dir, isDirectory: true)
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        for locale in AppLocale.allCases {
            let model = try await loadedModel(locale)
            for shot in shots {
                let png = try await render(shot, model)
                try png.write(to: out.appendingPathComponent("\(locale.rawValue)-\(shot.name).png"))
            }
        }
    }

    private func loadedModel(_ locale: AppLocale) async throws -> AppModel {
        let prefs = MemoryPreferences(["alerts_enabled": true])
        let store = AppStore(api: BluelyticsAPI(client: FixtureClient()), cache: MemoryCacheStore(), clock: { fixtureNow })
        let model = AppModel(
            store: store,
            settings: BluelyticsCore.Settings(prefs: prefs, deviceLocale: locale),
            alerts: AlertsController(backend: FakePush(), prefs: prefs)
        )
        await store.refresh(force: true)
        await model.alerts.initialize()
        model.markRestored()
        XCTAssertTrue(store.hasData, "the fixtures did not load")
        return model
    }

    /// The app's scene. A window outside a scene is never put on screen, so it draws nothing
    /// (the first CI run wrote 16 white images that way).
    private func windowScene() async throws -> UIWindowScene {
        for _ in 0..<50 {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first { return scene }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("the test host has no window scene")
        throw CancellationError()
    }

    private func render(_ shot: Shot, _ model: AppModel) async throws -> Data {
        let root = AppShell(tab: shot.tab, historyMode: shot.mode, historyRange: shot.range, startOnPicker: shot.picker)
            .environmentObject(model)
            .environment(\.motion, false)
        let scene = try await windowScene()
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.windowLevel = .alert + 1
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = UIHostingController(rootView: root)
        window.makeKeyAndVisible()
        defer {
            window.rootViewController?.dismiss(animated: false)
            window.isHidden = true
            window.rootViewController = nil
        }
        // Layout, fonts and (for the picker) the sheet's presentation; sleeping lets the main run
        // loop turn, so SwiftUI commits its frames.
        try await settle(window, seconds: shot.picker ? 1.5 : 0.8)
        if shot.scroll > 0 {
            guard let scroll = largestScrollView(in: window) else {
                XCTFail("\(shot.name): no scroll view to scroll")
                throw CancellationError()
            }
            let top = -scroll.adjustedContentInset.top
            let maxY = max(top, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
            scroll.setContentOffset(CGPoint(x: 0, y: min(top + shot.scroll, maxY)), animated: false)
            try await settle(window, seconds: 0.4)
        }
        var image = capture(window, hierarchy: true)
        if !looksReal(image) {
            // Once more after another frame, then straight from the layer tree.
            try await settle(window, seconds: 1)
            image = capture(window, hierarchy: true)
            if !looksReal(image) { image = capture(window, hierarchy: false) }
        }
        let (colours, brightness) = measure(image)
        XCTAssertTrue(
            looksReal(image),
            "\(shot.name) looks blank: \(colours) distinct colours, mean brightness \(String(format: "%.2f", brightness))"
        )
        guard let png = image.pngData() else {
            XCTFail("could not encode \(shot.name)")
            throw CancellationError()
        }
        return png
    }

    private func settle(_ window: UIWindow, seconds: Double) async throws {
        let steps = max(1, Int(seconds / 0.1))
        for _ in 0..<steps {
            window.setNeedsLayout()
            window.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private func capture(_ window: UIWindow, hierarchy: Bool) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = window.windowScene?.screen.scale ?? UIScreen.main.scale
        format.opaque = true
        return UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { context in
            if hierarchy {
                _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            } else {
                window.layer.render(in: context.cgContext)
            }
        }
    }

    /// The app is dark and busy: a real screen has many colours and is mostly dark. A blank capture
    /// is one colour (white, or black).
    private func looksReal(_ image: UIImage) -> Bool {
        let (colours, brightness) = measure(image)
        return colours >= 12 && brightness < 0.6
    }

    /// Distinct colours and mean brightness (0–1) of the image shrunk to 36×78.
    private func measure(_ image: UIImage) -> (colours: Int, brightness: Double) {
        guard let cg = image.cgImage else { return (0, 1) }
        let width = 36, height = 78
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            ) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return (0, 1) }
        var colours = Set<UInt32>()
        var total = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = UInt32(pixels[i]), g = UInt32(pixels[i + 1]), b = UInt32(pixels[i + 2])
            colours.insert(r << 16 | g << 8 | b)
            total += Double(r + g + b) / (3 * 255)
        }
        return (colours.count, total / Double(width * height))
    }

    private func largestScrollView(in view: UIView) -> UIScrollView? {
        var best: UIScrollView?
        func visit(_ view: UIView) {
            if let scroll = view as? UIScrollView, !scroll.isHidden, scroll.window != nil,
               scroll.contentSize.height > scroll.bounds.height,
               scroll.contentSize.height > (best?.contentSize.height ?? 0) {
                best = scroll
            }
            view.subviews.forEach(visit)
        }
        visit(view)
        return best
    }
}
