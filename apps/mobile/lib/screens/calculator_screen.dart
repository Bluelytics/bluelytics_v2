/// Calculator: an amount of any currency in pesos (or pesos in that currency) at the blue and the
/// official rate, buy and sell at once.
library;

import 'package:flutter/material.dart' show InputBorder, InputDecoration, Material, MaterialType, TextField, showModalBottomSheet;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../domain/calc.dart';
import '../domain/format.dart';
import '../domain/models.dart';
import '../i18n/strings.dart';
import '../scope.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import '../widgets/glyphs.dart';
import '../widgets/primitives.dart';

class CalculatorScreen extends StatefulWidget {
  const CalculatorScreen({super.key});

  @override
  State<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends State<CalculatorScreen> {
  final TextEditingController _amount = TextEditingController(text: '100');
  final FocusNode _focus = FocusNode();
  String _code = 'USD';

  /// `false`: the amount is in the chosen currency and the results in pesos. `true`: the reverse.
  bool _fromPesos = false;
  String? _copied;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_changed);
  }

  void _changed() => setState(() => _copied = null);

  @override
  void dispose() {
    _amount.dispose();
    _focus.dispose();
    super.dispose();
  }

  Future<void> _pick(List<CalcCurrency> currencies, Strings strings) async {
    _focus.unfocus();
    final chosen = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Bl.surface,
      barrierColor: Bl.ink.withValues(alpha: 0.7),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Bl.radius))),
      builder: (context) => _CurrencySheet(currencies: currencies, selected: _code, strings: strings),
    );
    if (chosen != null && mounted) setState(() => _code = chosen);
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text.replaceAll(nbsp, ' ')));
    await HapticFeedback.lightImpact();
    if (mounted) setState(() => _copied = text);
  }

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final strings = scope.strings;
    final locale = strings.locale;
    final store = scope.store;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final latest = store.latest;
        final currencies = calcCurrencies(store.currencies, locale);
        final currency = currencies.firstWhere((c) => c.code == _code, orElse: () => currencies.first);
        final amount = parseAmount(_amount.text, locale);
        final inputSign = _fromPesos ? r'$' : currency.sign;

        return GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: _focus.unfocus,
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.only(bottom: 40),
            child: ContentWidth(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 24),
                  Semantics(header: true, child: Text(strings.calcTitle, style: BlType.h1())),
                  const SizedBox(height: 8),
                  Text(strings.calcLead, style: BlType.body()),
                  const SizedBox(height: 22),
                  Panel(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('${strings.amount} · ${_fromPesos ? 'ARS' : currency.code}'.toUpperCase(), style: BlType.label()),
                        const SizedBox(height: 2),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Text(inputSign, style: sans(22, weight: 600, color: Bl.soft, height: 1)),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Material(
                                type: MaterialType.transparency,
                                child: TextField(
                                  controller: _amount,
                                  focusNode: _focus,
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')), LengthLimitingTextInputFormatter(15)],
                                  textInputAction: TextInputAction.done,
                                  cursorColor: Bl.brandInk,
                                  cursorWidth: 2,
                                  style: sans(44, weight: 800, tracking: -0.05, height: 1.1, tabular: true),
                                  decoration: InputDecoration(
                                    isCollapsed: true,
                                    border: InputBorder.none,
                                    hintText: '0',
                                    hintStyle: sans(44, weight: 800, color: Bl.dim.withValues(alpha: 0.4), tracking: -0.05, height: 1.1),
                                    semanticCounterText: '',
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const Hairline(strong: true),
                        Row(
                          children: [
                            Expanded(
                              child: Pressable(
                                onTap: () => _pick(currencies, strings),
                                semanticLabel: '${strings.currency}: ${currency.name} (${currency.code})',
                                minHeight: 56,
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 10),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(strings.currency.toUpperCase(), style: BlType.label()),
                                            const SizedBox(height: 3),
                                            Text(
                                              '${currency.code} · ${currency.name}',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: sans(16, weight: 600, height: 1.25),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const GlyphIcon(Glyph.chevronDown, size: 18, color: Bl.brandInk),
                                      const SizedBox(width: 12),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 56, child: Hairline(vertical: true)),
                            Pressable(
                              onTap: () => setState(() {
                                _fromPesos = !_fromPesos;
                                _copied = null;
                              }),
                              semanticLabel: '${strings.swap}: ${_fromPesos ? strings.toPesos : strings.fromPesos}',
                              minHeight: 56,
                              child: Padding(
                                padding: const EdgeInsets.only(left: 14),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const GlyphIcon(Glyph.swap, size: 18, color: Bl.brandInk),
                                    const SizedBox(width: 8),
                                    Text(strings.swap.toUpperCase(), style: mono(11.5, weight: 600, color: Bl.soft, tracking: 0.1, height: 1)),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    (_fromPesos ? '${strings.pesos} → ${currency.name}' : '${currency.name} → ${strings.pesos}').toUpperCase(),
                    style: BlType.label(color: Bl.brandInk),
                  ),
                  const SizedBox(height: 26),
                  if (amount == null)
                    Text(strings.enterAmount, style: BlType.body(color: Bl.dim))
                  else ...[
                    _Result(
                      title: strings.blue,
                      quote: _quoteFor(currency, latest?.blue, latest?.blueEuro),
                      currency: currency,
                      amount: amount,
                      fromPesos: _fromPesos,
                      strings: strings,
                      copied: _copied,
                      onCopy: _copy,
                    ),
                    const SizedBox(height: 26),
                    _Result(
                      title: strings.oficial,
                      quote: _quoteFor(currency, latest?.oficial, latest?.oficialEuro),
                      currency: currency,
                      amount: amount,
                      fromPesos: _fromPesos,
                      strings: strings,
                      copied: _copied,
                      onCopy: _copy,
                    ),
                  ],
                  if (currency.group != CurrencyGroup.main) ...[const SizedBox(height: 20), Text(strings.viaDollar, style: BlType.small())],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  /// Hundredths of a peso per unit of `currency`, buying and selling.
  static ({double buy, double sell})? _quoteFor(CalcCurrency currency, Quote? usd, Quote? eur) {
    final buy = rateFor(currency, usd: usd?.buy, eur: eur?.buy);
    final sell = rateFor(currency, usd: usd?.sell, eur: eur?.sell);
    return buy == null || sell == null ? null : (buy: buy, sell: sell);
  }
}

/// The conversion at one rate (blue or official): what buying costs and what selling pays.
class _Result extends StatelessWidget {
  const _Result({
    required this.title,
    required this.quote,
    required this.currency,
    required this.amount,
    required this.fromPesos,
    required this.strings,
    required this.copied,
    required this.onCopy,
  });

  final String title;
  final ({double buy, double sell})? quote;
  final CalcCurrency currency;
  final double amount;
  final bool fromPesos;
  final Strings strings;
  final String? copied;
  final ValueChanged<String> onCopy;

  /// A rate as text: whole pesos for a dollar, and enough units to be worth a peso for small
  /// currencies (`1.000 IDR = $ 93,80`).
  String _rateLine(double rateHundredths, AppLocale locale) {
    var units = 1;
    while (rateHundredths * units < 100 && units < 1000000000) {
      units *= 10;
    }
    return '${formatInteger(units, locale)} ${currency.code} = ${formatPesos((rateHundredths * units).round(), locale)}';
  }

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    final rates = quote;
    final lines = <(String label, String value, String note)>[];
    if (rates != null) {
      String convert(double rate) =>
          fromPesos ? formatForeign(toForeignHundredths(amount, rate), currency.sign, locale) : formatPesos(toPesosHundredths(amount, rate), locale);
      lines.add((strings.youPay, convert(rates.sell), _rateLine(rates.sell, locale)));
      lines.add((strings.youGet, convert(rates.buy), _rateLine(rates.buy, locale)));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHead(title),
        const SizedBox(height: 12),
        const Hairline(strong: true),
        if (rates == null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Text(strings.noData, style: BlType.body(color: Bl.dim)),
          )
        else
          for (final (label, value, note) in lines)
            Pressable(
              onTap: () => onCopy(value),
              semanticLabel: '$label: $value. $note',
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: Bl.line)),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label.toUpperCase(), style: BlType.label()),
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(value, style: sans(30, weight: 750, tracking: -0.045, height: 1.15, tabular: true)),
                      ),
                      const SizedBox(height: 4),
                      Text(copied == value ? '✓ ${strings.copied}' : note, style: BlType.note(color: copied == value ? Bl.up : Bl.dim)),
                    ],
                  ),
                ),
              ),
            ),
      ],
    );
  }
}

/// The currency picker: search on top, then the dollar and the euro, the Americas, and the rest.
class _CurrencySheet extends StatefulWidget {
  const _CurrencySheet({required this.currencies, required this.selected, required this.strings});

  final List<CalcCurrency> currencies;
  final String selected;
  final Strings strings;

  @override
  State<_CurrencySheet> createState() => _CurrencySheetState();
}

class _CurrencySheetState extends State<_CurrencySheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final strings = widget.strings;
    final matches = [
      for (final currency in widget.currencies)
        if (matchesCurrency(currency, _query)) currency,
    ];
    final rows = <Widget>[];
    CurrencyGroup? group;
    for (final currency in matches) {
      if (currency.group != group) {
        group = currency.group;
        final title = switch (currency.group) {
          CurrencyGroup.main => strings.groupMain,
          CurrencyGroup.americas => strings.groupAmericas,
          CurrencyGroup.other => strings.groupOther,
        };
        rows.add(
          Padding(
            padding: const EdgeInsets.fromLTRB(Bl.gutter, 18, Bl.gutter, 8),
            child: Semantics(
              header: true,
              child: Text(title.toUpperCase(), style: BlType.label(color: Bl.brandInk)),
            ),
          ),
        );
      }
      final active = currency.code == widget.selected;
      rows.add(
        Pressable(
          onTap: () => Navigator.of(context).pop(currency.code),
          selected: active,
          semanticLabel: '${currency.name} (${currency.code})',
          minHeight: 48,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: active ? Bl.brand.withValues(alpha: 0.16) : null,
              border: const Border(bottom: BorderSide(color: Bl.line)),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: Bl.gutter, vertical: 13),
              child: Row(
                children: [
                  SizedBox(
                    width: 52,
                    child: Text(currency.code, style: mono(13, weight: 600, color: active ? Bl.text : Bl.brandInk, tracking: 0.04, height: 1.2)),
                  ),
                  Expanded(
                    child: Text(
                      currency.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: sans(15.5, weight: active ? 600 : 400, color: active ? Bl.text : Bl.soft, height: 1.25),
                    ),
                  ),
                  if (active) const GlyphIcon(Glyph.check, size: 18, color: Bl.up),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      // Keeps the list above the keyboard.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: 0.88,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Bl.gutter, 18, 6, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Semantics(header: true, child: Text(strings.chooseCurrency, style: BlType.h2())),
                  ),
                  Pressable(
                    onTap: () => Navigator.of(context).pop(),
                    semanticLabel: strings.close,
                    child: const Padding(
                      padding: EdgeInsets.all(11),
                      child: GlyphIcon(Glyph.close, size: 20, color: Bl.soft),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Bl.gutter),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: Bl.ink.withValues(alpha: 0.6),
                  border: Border.all(color: Bl.lineStrong),
                  borderRadius: BorderRadius.circular(2),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      const GlyphIcon(Glyph.search, size: 18, color: Bl.dim),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Material(
                          type: MaterialType.transparency,
                          child: TextField(
                            onChanged: (value) => setState(() => _query = value),
                            textInputAction: TextInputAction.search,
                            autocorrect: false,
                            cursorColor: Bl.brandInk,
                            style: sans(16, height: 1.3),
                            decoration: InputDecoration(
                              isCollapsed: true,
                              contentPadding: const EdgeInsets.symmetric(vertical: 14),
                              border: InputBorder.none,
                              hintText: strings.searchCurrency,
                              hintStyle: sans(16, color: Bl.dim, height: 1.3),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: rows.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(Bl.gutter),
                      child: Text(strings.noMatches, style: BlType.body(color: Bl.dim)),
                    )
                  : ListView.builder(
                      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.only(bottom: 24),
                      itemCount: rows.length,
                      itemBuilder: (context, index) => rows[index],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
