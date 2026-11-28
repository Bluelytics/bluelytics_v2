// Calculator: an amount of any currency in pesos (or pesos in that currency) at the blue and the
// official rate, buy and sell at once.
import BluelyticsCore
import SwiftUI
import UIKit

struct CalculatorScreen: View {
    @EnvironmentObject private var model: AppModel
    @State private var amountText = "100"
    @State private var code = "USD"
    /// `false`: the amount is in the chosen currency and the results in pesos. `true`: the reverse.
    @State private var fromPesos = false
    @State private var copied: String?
    @State private var picking: Bool
    @FocusState private var focused: Bool

    init(startOnPicker: Bool = false) {
        _picking = State(initialValue: startOnPicker)
    }

    var body: some View {
        let strings = model.strings
        let locale = strings.locale
        let latest = model.store.latest
        let currencies = calcCurrencies(model.store.currencies, locale)
        let currency = currencies.first { $0.code == code } ?? currencies[0]
        let amount = parseAmount(amountText, locale)
        ScrollView {
            ContentWidth {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 24)
                    styled(strings.calcTitle, BlType.h1()).accessibilityAddTraits(.isHeader)
                    Spacer().frame(height: 8)
                    styled(strings.calcLead, BlType.body()).fixedSize(horizontal: false, vertical: true)
                    Spacer().frame(height: 22)
                    inputPanel(strings, currency)
                    Spacer().frame(height: 10)
                    styled(
                        (fromPesos ? "\(strings.pesos) → \(currency.name)" : "\(currency.name) → \(strings.pesos)").uppercased(),
                        BlType.label(Bl.brandInk)
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer().frame(height: 26)
                    if let amount {
                        ResultBlock(
                            title: strings.blue,
                            quote: quoteFor(currency, latest?.blue, latest?.blueEuro),
                            currency: currency,
                            amount: amount,
                            fromPesos: fromPesos,
                            strings: strings,
                            copied: copied,
                            onCopy: copy
                        )
                        Spacer().frame(height: 26)
                        ResultBlock(
                            title: strings.oficial,
                            quote: quoteFor(currency, latest?.oficial, latest?.oficialEuro),
                            currency: currency,
                            amount: amount,
                            fromPesos: fromPesos,
                            strings: strings,
                            copied: copied,
                            onCopy: copy
                        )
                    } else {
                        styled(strings.enterAmount, BlType.body(Bl.dim))
                    }
                    if currency.group != .main {
                        Spacer().frame(height: 20)
                        styled(strings.viaDollar, BlType.small()).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: amountText) { text in
            // Digits and the two separators only, at most 15 characters (as the Flutter field).
            let clean = String(text.filter { "0123456789.,".contains($0) }.prefix(15))
            if clean != text { amountText = clean }
            copied = nil
        }
        .sheet(isPresented: $picking) {
            CurrencySheet(currencies: currencies, selected: code, strings: strings) { chosen in
                code = chosen
                copied = nil
                picking = false
            } onClose: {
                picking = false
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    private func inputPanel(_ strings: Strings, _ currency: CalcCurrency) -> some View {
        Panel(padding: EdgeInsets(top: 14, leading: 16, bottom: 16, trailing: 16)) {
            VStack(alignment: .leading, spacing: 0) {
                styled("\(strings.amount) · \(fromPesos ? "ARS" : currency.code)".uppercased(), BlType.label())
                Spacer().frame(height: 2)
                HStack(spacing: 10) {
                    styled(fromPesos ? "$" : currency.sign, sans(22, weight: 600, color: Bl.soft, height: 1))
                    TextField("", text: $amountText, prompt: Text(verbatim: "0").foregroundColor(Bl.dim.opacity(0.4)))
                        .keyboardType(.decimalPad)
                        .focused($focused)
                        .textStyle(sans(44, weight: 800, tracking: -0.05, height: 1.1, tabular: true))
                        .accessibilityLabel(Text(verbatim: "\(strings.amount) \(fromPesos ? "ARS" : currency.code)"))
                        .toolbar {
                            ToolbarItemGroup(placement: .keyboard) {
                                Spacer()
                                Button(strings.close) { focused = false }
                            }
                        }
                }
                Spacer().frame(height: 12)
                Hairline(strong: true)
                HStack(spacing: 0) {
                    Button {
                        focused = false
                        picking = true
                    } label: {
                        HStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 3) {
                                styled(strings.currency.uppercased(), BlType.label())
                                styled("\(currency.code) · \(currency.name)", sans(16, weight: 600, height: 1.25))
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            GlyphIcon(.chevronDown, size: 18, color: Bl.brandInk)
                            Spacer().frame(width: 12)
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(Quiet(minHeight: 56))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: "\(strings.currency): \(currency.name) (\(currency.code))"))
                    .accessibilityAddTraits(.isButton)
                    Hairline(vertical: true).frame(height: 56)
                    Button {
                        fromPesos.toggle()
                        copied = nil
                    } label: {
                        HStack(spacing: 8) {
                            GlyphIcon(.swap, size: 18, color: Bl.brandInk)
                            styled(strings.swap.uppercased(), mono(11.5, weight: 600, color: Bl.soft, tracking: 0.1, height: 1))
                        }
                        .padding(.leading, 14)
                    }
                    .buttonStyle(Quiet(minHeight: 56))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: "\(strings.swap): \(fromPesos ? strings.toPesos : strings.fromPesos)"))
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
    }

    private func copy(_ text: String) {
        UIPasteboard.general.string = text.replacingOccurrences(of: nbsp, with: " ")
        Haptics.light()
        copied = text
        UIAccessibility.post(notification: .announcement, argument: model.strings.copied)
    }

    /// Hundredths of a peso per unit of `currency`, buying and selling.
    private func quoteFor(_ currency: CalcCurrency, _ usd: Quote?, _ eur: Quote?) -> (buy: Double, sell: Double)? {
        guard let buy = rateFor(currency, usd: usd?.buy, eur: eur?.buy), let sell = rateFor(currency, usd: usd?.sell, eur: eur?.sell) else { return nil }
        return (buy, sell)
    }
}

/// The conversion at one rate (blue or official): what buying costs and what selling pays.
private struct ResultBlock: View {
    let title: String
    let quote: (buy: Double, sell: Double)?
    let currency: CalcCurrency
    let amount: Double
    let fromPesos: Bool
    let strings: Strings
    let copied: String?
    let onCopy: (String) -> Void

    /// A rate as text: whole pesos for a dollar, and enough units to be worth a peso for small
    /// currencies (`1.000 IDR = $ 93,80`).
    private func rateLine(_ rate: Double) -> String {
        var units = 1
        while rate * Double(units) < 100 && units < 1_000_000_000 { units *= 10 }
        return "\(formatInteger(units, strings.locale)) \(currency.code) = \(formatPesos(Int((rate * Double(units)).rounded()), strings.locale))"
    }

    private func convert(_ rate: Double) -> String {
        fromPesos
            ? formatForeign(toForeignHundredths(amount, rate), currency.sign, strings.locale)
            : formatPesos(toPesosHundredths(amount, rate), strings.locale)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHead(title)
            Spacer().frame(height: 12)
            Hairline(strong: true)
            if let quote {
                line(strings.youPay, convert(quote.sell), rateLine(quote.sell))
                line(strings.youGet, convert(quote.buy), rateLine(quote.buy))
            } else {
                styled(strings.noData, BlType.body(Bl.dim)).padding(.vertical, 14)
            }
        }
    }

    private func line(_ label: String, _ value: String, _ note: String) -> some View {
        let done = copied == value
        return Button { onCopy(value) } label: {
            VStack(alignment: .leading, spacing: 4) {
                styled(label.uppercased(), BlType.label())
                styled(value, sans(30, weight: 750, tracking: -0.045, height: 1.15, tabular: true))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                styled(done ? "✓ \(strings.copied)" : note, BlType.note(done ? Bl.up : Bl.dim))
            }
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
        }
        .buttonStyle(Quiet())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(label): \(value). \(note)"))
        .accessibilityAddTraits(.isButton)
    }
}

/// The currency picker: search on top, then the dollar and the euro, the Americas, and the rest.
private struct CurrencySheet: View {
    let currencies: [CalcCurrency]
    let selected: String
    let strings: Strings
    let onPick: (String) -> Void
    let onClose: () -> Void
    @State private var query = ""

    private struct Entry: Identifiable {
        let id: String
        let header: String?
        let currency: CalcCurrency?
    }

    private var entries: [Entry] {
        var out: [Entry] = []
        var group: CurrencyGroup?
        for currency in currencies where matchesCurrency(currency, query) {
            if currency.group != group {
                group = currency.group
                let title: String
                switch currency.group {
                case .main: title = strings.groupMain
                case .americas: title = strings.groupAmericas
                case .other: title = strings.groupOther
                }
                out.append(Entry(id: "group-\(title)", header: title, currency: nil))
            }
            out.append(Entry(id: currency.code, header: nil, currency: currency))
        }
        return out
    }

    var body: some View {
        let rows = entries
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                styled(strings.chooseCurrency, BlType.h2())
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onClose) {
                    GlyphIcon(.close, size: 20, color: Bl.soft).padding(11)
                }
                .buttonStyle(Quiet())
                .accessibilityLabel(Text(verbatim: strings.close))
            }
            .padding(EdgeInsets(top: 18, leading: Bl.gutter, bottom: 8, trailing: 6))
            HStack(spacing: 10) {
                GlyphIcon(.search, size: 18, color: Bl.dim)
                TextField("", text: $query, prompt: Text(verbatim: strings.searchCurrency).foregroundColor(Bl.dim))
                    .textStyle(sans(16, height: 1.3))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                    .padding(.vertical, 14)
            }
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: 2).fill(Bl.ink.opacity(0.6)))
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Bl.lineStrong, lineWidth: 1))
            .padding(.horizontal, Bl.gutter)
            Spacer().frame(height: 6)
            if rows.isEmpty {
                styled(strings.noMatches, BlType.body(Bl.dim)).padding(Bl.gutter)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(rows) { entry in
                            if let header = entry.header {
                                styled(header.uppercased(), BlType.label(Bl.brandInk))
                                    .accessibilityAddTraits(.isHeader)
                                    .padding(EdgeInsets(top: 18, leading: Bl.gutter, bottom: 8, trailing: Bl.gutter))
                            } else if let currency = entry.currency {
                                row(currency)
                            }
                        }
                    }
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Bl.surface.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }

    private func row(_ currency: CalcCurrency) -> some View {
        let active = currency.code == selected
        return Button { onPick(currency.code) } label: {
            HStack(spacing: 0) {
                styled(currency.code, mono(13, weight: 600, color: active ? Bl.text : Bl.brandInk, tracking: 0.04, height: 1.2))
                    .frame(width: 52, alignment: .leading)
                styled(currency.name, sans(15.5, weight: active ? 600 : 400, color: active ? Bl.text : Bl.soft, height: 1.25))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if active { GlyphIcon(.check, size: 18, color: Bl.up) }
            }
            .padding(.horizontal, Bl.gutter)
            .padding(.vertical, 13)
            .background(active ? Bl.brand.opacity(0.16) : Color.clear)
            .overlay(alignment: .bottom) { Bl.line.frame(height: 1) }
        }
        .buttonStyle(Quiet(minHeight: 48))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(currency.name) (\(currency.code))"))
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}
