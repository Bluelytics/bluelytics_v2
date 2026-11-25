/// Calculator arithmetic (the counterpart of apps/web/src/lib/calc.ts). The dollar and the euro use
/// the published rates; every other currency of `currency.json` is converted through the dollar,
/// like the original app: pesos per unit = dollar rate / units per USD.
library;

import 'currency_names_en.dart';
import 'format.dart';
import 'models.dart';

/// ISO codes of the currencies of the Americas (ARS and USD aside): listed first in the picker.
const Set<String> americas = {
  'BRL', 'CLP', 'UYU', 'PYG', 'BOB', 'PEN', 'COP', 'VES', 'VEF', 'ECS', 'MXN', 'CAD', 'CRC', 'SVC', 'GTQ', 'HNL', //
  'NIO', 'PAB', 'DOP', 'CUP', 'CUC', 'HTG', 'JMD', 'TTD', 'BSD', 'BBD', 'BZD', 'BMD', 'KYD', 'XCD', 'AWG', //
  'ANG', 'SRD', 'GYD', 'FKP',
};

enum CurrencyGroup { main, americas, other }

/// A currency the calculator can convert, with its group in the picker.
class CalcCurrency {
  const CalcCurrency({required this.code, required this.name, required this.group, this.perUsdHundredths});

  final String code;
  final String name;
  final CurrencyGroup group;

  /// Units per US dollar in hundredths; `null` for USD and EUR, which have published rates.
  final int? perUsdHundredths;

  /// Sign before an amount: `US$`, `€`, or the ISO code.
  String get sign => switch (code) {
    'USD' => r'US$',
    'EUR' => '€',
    _ => code,
  };
}

/// USD and EUR first, then the Americas, then the rest; each group sorted by name.
List<CalcCurrency> calcCurrencies(List<Currency> rows, AppLocale locale) {
  final es = locale == AppLocale.es;
  String nameOf(Currency row) => es ? row.name : (currencyNamesEn[row.code] ?? row.name);
  final rest = [
    for (final row in rows)
      if (!const {'USD', 'EUR', 'ARS'}.contains(row.code) && row.perUsdHundredths > 0)
        CalcCurrency(
          code: row.code,
          name: nameOf(row),
          group: americas.contains(row.code) ? CurrencyGroup.americas : CurrencyGroup.other,
          perUsdHundredths: row.perUsdHundredths,
        ),
  ]..sort((a, b) => _fold(a.name).compareTo(_fold(b.name)));
  return [
    CalcCurrency(code: 'USD', name: es ? 'Dólar estadounidense' : 'US dollar', group: CurrencyGroup.main),
    const CalcCurrency(code: 'EUR', name: 'Euro', group: CurrencyGroup.main),
    ...rest.where((c) => c.group == CurrencyGroup.americas),
    ...rest.where((c) => c.group == CurrencyGroup.other),
  ];
}

const Map<String, String> _accents = {'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u', 'ñ': 'n'};

String _fold(String text) {
  final lower = text.toLowerCase();
  final out = StringBuffer();
  for (final rune in lower.runes) {
    final char = String.fromCharCode(rune);
    out.write(_accents[char] ?? char);
  }
  return out.toString();
}

/// Case- and accent-insensitive match of a search text against a currency's name or code.
bool matchesCurrency(CalcCurrency currency, String query) {
  final needle = _fold(query.trim());
  return needle.isEmpty || _fold(currency.name).contains(needle) || currency.code.toLowerCase().contains(needle);
}

/// Hundredths of a peso per unit of `currency`, at the dollar (and euro) quotes given. Unrounded:
/// small currencies need the decimals. `null` when the rate is not available.
double? rateFor(CalcCurrency currency, {required int? usd, required int? eur}) {
  if (currency.code == 'USD') return usd?.toDouble();
  if (currency.code == 'EUR') return eur?.toDouble();
  final perUsd = currency.perUsdHundredths;
  if (usd == null || perUsd == null || perUsd <= 0) return null;
  return usd * 100 / perUsd;
}

/// Pesos in hundredths for `amount` units at `rateHundredths`.
int toPesosHundredths(double amount, double rateHundredths) => (amount * rateHundredths).round();

/// Units of the currency in hundredths for `pesos` at `rateHundredths`.
int toForeignHundredths(double pesos, double rateHundredths) => rateHundredths > 0 ? (pesos * 10000 / rateHundredths).round() : 0;
