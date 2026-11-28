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

/// Alerts already on: a version 1 user carried over.
@MainActor
private final class FakePush: PushBackend {
    var onMessage: ((AlertMessage) -> Void)?
    var supported: Bool { true }
    func enable() async throws -> Bool { true }
    func disable() async throws {}
    func resume() async throws {}
    func legacyEnabled() async throws -> Bool? { true }
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
        let prefs = MemoryPreferences()
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

    private func render(_ shot: Shot, _ model: AppModel) async throws -> Data {
        let root = AppShell(tab: shot.tab, historyMode: shot.mode, historyRange: shot.range, startOnPicker: shot.picker)
            .environmentObject(model)
            .environment(\.motion, false)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIHostingController(rootView: root)
        window.makeKeyAndVisible()
        defer {
            window.rootViewController?.dismiss(animated: false)
            window.isHidden = true
            window.rootViewController = nil
        }
        // Layout, fonts and (for the picker) the sheet's presentation.
        try await Task.sleep(nanoseconds: shot.picker ? 1_200_000_000 : 500_000_000)
        if shot.scroll > 0, let scroll = largestScrollView(in: window) {
            let maxY = max(0, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
            scroll.setContentOffset(CGPoint(x: 0, y: min(shot.scroll, maxY) - scroll.adjustedContentInset.top), animated: false)
            try await Task.sleep(nanoseconds: 300_000_000)
        }
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            _ = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard let png = image.pngData() else { throw XCTSkip("could not encode \(shot.name)") }
        return png
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
