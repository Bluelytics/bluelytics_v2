// Alerts: the push switch, the last alert sent, and what Bluelytics is.
import BluelyticsCore
import SwiftUI
import UIKit

struct AlertsScreen: View {
    init() {}

    @EnvironmentObject private var model: AppModel

    var body: some View {
        let strings = model.strings
        let es = strings.locale == .es
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ContentWidth {
                    VStack(alignment: .leading, spacing: 0) {
                        Spacer().frame(height: 24)
                        styled(strings.alertsTitle, BlType.h1()).accessibilityAddTraits(.isHeader)
                        Spacer().frame(height: 8)
                        styled(strings.alertsLead, BlType.body()).fixedSize(horizontal: false, vertical: true)
                        Spacer().frame(height: 22)
                        SwitchPanel(alerts: model.alerts, strings: strings)
                        Spacer().frame(height: 36)
                        SectionHead(strings.lastAlert)
                        Spacer().frame(height: 14)
                        Hairline(strong: true)
                        if let alert = model.store.alert {
                            LastAlert(alert: alert, strings: strings)
                        } else {
                            styled(strings.noAlertYet, BlType.body(Bl.dim)).padding(.vertical, 14)
                        }
                        Spacer().frame(height: 36)
                        SectionHead(strings.aboutTitle)
                        Spacer().frame(height: 12)
                        styled(strings.aboutBody, BlType.body()).fixedSize(horizontal: false, vertical: true)
                        Spacer().frame(height: 16)
                        Hairline(strong: true)
                        LinkRow(label: strings.linkSite, detail: "bluelytics.com.ar", url: es ? Links.site : "\(Links.site)/en/")
                        LinkRow(label: strings.linkMethod, detail: nil, url: es ? Links.about : Links.aboutEn)
                        LinkRow(label: strings.linkApi, detail: "api.bluelytics.com.ar", url: es ? Links.api : Links.apiEn)
                        LinkRow(label: strings.linkSource, detail: "GitHub", url: Links.source)
                        LinkRow(label: strings.linkLicense, detail: nil, url: Links.license)
                        Spacer().frame(height: 22)
                        styled(strings.follow.uppercased(), BlType.label())
                        Spacer().frame(height: 6)
                        HStack(spacing: 22) {
                            SocialLink(label: "X", url: Links.x)
                            SocialLink(label: "Instagram", url: Links.instagram)
                            SocialLink(label: "LinkedIn", url: Links.linkedin)
                        }
                        Spacer().frame(height: 28)
                        styled(strings.disclaimer, BlType.small()).fixedSize(horizontal: false, vertical: true)
                        Spacer().frame(height: 10)
                        styled("\(strings.version(appVersion)) · © Bluelytics", BlType.note())
                    }
                }
                Spacer().frame(height: 24)
                Wordmark()
            }
            .padding(.bottom, 8)
        }
    }
}

private struct SwitchPanel: View {
    let alerts: AlertsController
    let strings: Strings

    var body: some View {
        let on = alerts.enabled
        let enabled = alerts.supported && !alerts.busy
        let problem: String? = alerts.problem.map { $0 == .denied ? strings.alertsDenied : strings.alertsFailed }
        Panel {
            VStack(alignment: .leading, spacing: 0) {
                Button {
                    Task { await alerts.setEnabled(!on) }
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            styled(strings.alertsToggle, sans(17, weight: 700, tracking: -0.02, height: 1.2))
                                .fixedSize(horizontal: false, vertical: true)
                            styled((on ? strings.alertsOn : strings.alertsOff).uppercased(), BlType.label(on ? Bl.up : Bl.dim))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        SquareSwitch(on: on)
                            .opacity(alerts.supported ? (alerts.busy ? 0.5 : 1) : 0.35)
                    }
                }
                .buttonStyle(Quiet(minHeight: 48))
                .disabled(!enabled)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: strings.alertsToggle))
                .accessibilityValue(Text(verbatim: on ? strings.alertsOn : strings.alertsOff))
                .accessibilityAddTraits(.isButton)
                Spacer().frame(height: 12)
                Hairline()
                Spacer().frame(height: 12)
                styled(alerts.supported ? strings.alertsHelp : strings.alertsUnsupported, BlType.small(Bl.muted))
                    .fixedSize(horizontal: false, vertical: true)
                if let problem {
                    Spacer().frame(height: 10)
                    styled(problem, BlType.small(Bl.down))
                        .fixedSize(horizontal: false, vertical: true)
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: problem) }
                }
            }
        }
    }
}

/// A square-cut switch, in the angular language of the rest of the interface.
private struct SquareSwitch: View {
    let on: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: on ? .trailing : .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(on ? Bl.brand : Bl.ink.opacity(0.6))
                .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(on ? Bl.brand : Bl.lineStrong, lineWidth: 1))
            RoundedRectangle(cornerRadius: 1)
                .fill(on ? Bl.text : Bl.dim)
                .frame(width: 22, height: 22)
                .padding(4)
        }
        .frame(width: 54, height: 30)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: on)
    }
}

private struct LastAlert: View {
    let alert: AlertInfo
    let strings: Strings

    var body: some View {
        let locale = strings.locale
        let move = Move.between(alert.current.sell, alert.previous?.sell)
        let direction = move?.direction ?? .flat
        let title = direction == .up ? strings.alertRose : (direction == .down ? strings.alertFell : strings.alertMoved)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if direction != .flat { DirectionMark(direction, size: 10, color: directionColor(direction)) }
                styled(title, sans(17, weight: 700, tracking: -0.02, height: 1.2))
            }
            Spacer().frame(height: 10)
            styled(strings.sell.uppercased(), BlType.label())
            Spacer().frame(height: 4)
            styled(formatPesos(alert.current.sell, locale), sans(34, weight: 800, tracking: -0.05, height: 1.1, tabular: true))
            if let move {
                Spacer().frame(height: 10)
                MoveChip(move: move, locale: locale)
            }
            Spacer().frame(height: 10)
            styled(formatDateTime(alert.at, locale), BlType.note())
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
        .accessibilityElement(children: .combine)
    }
}

private struct LinkRow: View {
    let label: String
    let detail: String?
    let url: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let target = URL(string: url) { openURL(target) }
        } label: {
            HStack(spacing: 0) {
                styled(label, sans(15.5, weight: 500, height: 1.25))
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let detail {
                    styled(detail, BlType.note())
                    Spacer().frame(width: 10)
                }
                GlyphIcon(.external, size: 16, color: Bl.brandInk, stroke: 1.4)
            }
            .padding(.vertical, 14)
            .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
        }
        .buttonStyle(Quiet(minHeight: 50))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isLink)
    }
}

private struct SocialLink: View {
    let label: String
    let url: String
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let target = URL(string: url) { openURL(target) }
        } label: {
            styled(label, sans(15.5, weight: 600, color: Bl.brandInk, height: 1.25))
        }
        .buttonStyle(Quiet())
        .accessibilityAddTraits(.isLink)
    }
}
