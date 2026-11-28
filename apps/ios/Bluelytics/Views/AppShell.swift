// The app: the masthead with the language button, the four tabs in the system tab bar, the alert
// banner and the refresh loop.
import BluelyticsCore
import Combine
import SwiftUI
import UIKit

enum AppTab: Hashable, CaseIterable {
    case today, history, calculator, alerts
}

/// The tab bar and navigation chrome in the app's colours and type.
enum ShellAppearance {
    static func apply() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = Bl.UI.ink.withAlphaComponent(0.94)
        appearance.shadowColor = Bl.UI.line
        let font = Fonts.ui(.mono, 10, weight: 500)
        let selectedFont = Fonts.ui(.mono, 10, weight: 600)
        for item in [appearance.stackedLayoutAppearance, appearance.inlineLayoutAppearance, appearance.compactInlineLayoutAppearance] {
            item.normal.iconColor = Bl.UI.dim
            item.normal.titleTextAttributes = [.foregroundColor: Bl.UI.dim, .font: font, .kern: 1.0]
            item.selected.iconColor = Bl.UI.brandInk
            item.selected.titleTextAttributes = [.foregroundColor: Bl.UI.text, .font: selectedFont, .kern: 1.0]
        }
        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

struct AppShell: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab: AppTab
    @State private var historyMode: ChartMode
    private let historyRange: RangePreset
    private let startOnPicker: Bool

    /// How often the live quotes are asked for while the app is on screen.
    static let pollEvery: TimeInterval = 60
    private let poll = Timer.publish(every: AppShell.pollEvery, on: .main, in: .common).autoconnect()

    /// The arguments are for the screenshot tests; the app starts on Today.
    init(tab: AppTab = .today, historyMode: ChartMode = .rates, historyRange: RangePreset = .y1, startOnPicker: Bool = false) {
        _tab = State(initialValue: tab)
        _historyMode = State(initialValue: historyMode)
        self.historyRange = historyRange
        self.startOnPicker = startOnPicker
    }

    var body: some View {
        let strings = model.strings
        ZStack {
            BlBackground()
            if model.restored {
                VStack(spacing: 0) {
                    Masthead(strings: strings, toggle: { model.settings.toggleLocale() })
                    TabView(selection: $tab) {
                        page(.today, strings.tabToday, .today) {
                            TodayScreen(onOpenHistory: { mode in
                                historyMode = mode
                                tab = .history
                            })
                        }
                        page(.history, strings.tabHistory, .history) {
                            HistoryScreen(mode: $historyMode, initialRange: historyRange)
                        }
                        page(.calculator, strings.tabCalculator, .calculator) {
                            CalculatorScreen(startOnPicker: startOnPicker)
                        }
                        page(.alerts, strings.tabAlerts, .bell) {
                            AlertsScreen()
                        }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .tint(Bl.brandInk)
        .environment(\.locale, Locale(identifier: model.locale == .es ? "es_AR" : "en_US"))
        .onReceive(poll) { _ in
            guard scenePhase == .active, model.restored else { return }
            Task { await model.store.refresh() }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active, model.restored else { return }
            Task { await model.store.refresh() }
        }
        .onChange(of: tab) { _ in
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    private func page<Content: View>(_ value: AppTab, _ title: String, _ glyph: Glyph, @ViewBuilder content: () -> Content) -> some View {
        ZStack(alignment: .top) {
            BlBackground()
            content()
            if let banner = model.banner {
                Banner(message: banner, closeLabel: model.strings.close, onClose: { model.dismissBanner() })
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .tabItem {
            Label {
                Text(verbatim: title.uppercased())
            } icon: {
                Image(uiImage: glyph.image(size: 25, stroke: tab == value ? 1.8 : 1.5))
            }
        }
        .tag(value)
        .accessibilityLabel(Text(verbatim: title))
    }
}

private struct Masthead: View {
    let strings: Strings
    let toggle: () -> Void

    var body: some View {
        ContentWidth {
            HStack(spacing: 0) {
                HStack(spacing: 9) {
                    Image("Mark")
                        .resizable()
                        .interpolation(.medium)
                        .frame(width: 28, height: 28)
                    styled("bluelytics", sans(18.5, weight: 800, tracking: -0.045, height: 1))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "Bluelytics"))
                .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: toggle) {
                    styled(strings.otherLanguageCode, mono(12, weight: 500, color: Bl.soft, tracking: 0.12, height: 1))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Bl.lineStrong, lineWidth: 1))
                }
                .buttonStyle(Quiet())
                .accessibilityLabel(Text(verbatim: strings.switchLanguage))
            }
            .frame(height: 52)
        }
        .background(Bl.ink.opacity(0.82))
        .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
    }
}

/// An alert that arrived while the app is open.
private struct Banner: View {
    let message: AlertMessage
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        ContentWidth {
            HStack(spacing: 12) {
                GlyphIcon(.bell, size: 18, color: Bl.brandInk)
                VStack(alignment: .leading, spacing: 2) {
                    if !message.title.isEmpty { styled(message.title, sans(15, weight: 700, height: 1.25)) }
                    if !message.body.isEmpty { styled(message.body, mono(12.5, weight: 500, color: Bl.soft, height: 1.35)) }
                }
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                Button(action: onClose) {
                    GlyphIcon(.close, size: 18, color: Bl.soft).padding(12)
                }
                .buttonStyle(Quiet())
                .accessibilityLabel(Text(verbatim: closeLabel))
            }
        }
        .background(Bl.surface2)
        .overlay(alignment: .bottom) { Bl.brand.frame(height: 2) }
    }
}
