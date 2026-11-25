/// Display formatting for both languages; a port of apps/web/src/lib/format.ts so the app and the
/// site print every number the same way. Spanish follows es-AR: `.` thousands, `,` decimals,
/// `$ 1.675`, `4,9 %`, 24-hour clock. Money is always an integer number of hundredths of a peso.
library;

enum AppLocale {
  es,
  en
  ;

  static AppLocale fromCode(String? code) => code == 'en' ? AppLocale.en : AppLocale.es;
}

const String nbsp = ' ';

/// Typographic minus (U+2212).
const String minus = '−';

const _months = {
  AppLocale.es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  AppLocale.en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const _monthsShort = {
  AppLocale.es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  AppLocale.en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

String _thousands(AppLocale locale) => locale == AppLocale.es ? '.' : ',';
String _decimal(AppLocale locale) => locale == AppLocale.es ? ',' : '.';

String _group(String digits, String separator) {
  final out = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(separator);
    out.write(digits[i]);
  }
  return out.toString();
}

/// `1675` → `1.675` (es) / `1,675` (en). Negative values use the typographic minus.
String formatInteger(int value, AppLocale locale) {
  final text = _group(value.abs().toString(), _thousands(locale));
  return value < 0 ? '$minus$text' : text;
}

/// Hundredths → `1.652,50` / `1,652.50`.
String formatHundredths(int hundredths, AppLocale locale) {
  final abs = hundredths.abs();
  final whole = _group((abs ~/ 100).toString(), _thousands(locale));
  final text = '$whole${_decimal(locale)}${(abs % 100).toString().padLeft(2, '0')}';
  return hundredths < 0 ? '$minus$text' : text;
}

/// Whole pesos when the amount has no cents, two decimals otherwise: `1.675` or `4,05`.
String formatAmount(int hundredths, AppLocale locale) {
  return hundredths % 100 == 0 ? formatInteger(hundredths ~/ 100, locale) : formatHundredths(hundredths, locale);
}

String _withCurrency(String amount, AppLocale locale, [String sign = r'$']) {
  return locale == AppLocale.es ? '$sign$nbsp$amount' : '$sign$amount';
}

/// A price: `$ 1.675` / `$1,675`, with cents only when there are any (`$ 4,05`).
String formatPesos(int hundredths, AppLocale locale) => _withCurrency(formatAmount(hundredths, locale), locale);

/// A price always with cents: `$ 1.652,50` / `$1,652.50`.
String formatPesosCents(int hundredths, AppLocale locale) => _withCurrency(formatHundredths(hundredths, locale), locale);

/// An amount of another currency, always with cents: `US$ 58,48` / `US$58.48`.
String formatForeign(int hundredths, String sign, AppLocale locale) => _withCurrency(formatHundredths(hundredths, locale), locale, sign);

/// `+20` / `−20` / `0`, with cents only when there are any.
String formatSignedAmount(int hundredths, AppLocale locale) {
  final text = formatAmount(hundredths.abs(), locale);
  if (hundredths > 0) return '+$text';
  return hundredths < 0 ? '$minus$text' : text;
}

int _pow10(int exponent) {
  var result = 1;
  for (var i = 0; i < exponent; i++) {
    result *= 10;
  }
  return result;
}

/// A ratio as a percentage: `0.049` → `4,9 %` / `4.9%`.
String formatPercent(double ratio, AppLocale locale, [int digits = 1]) {
  final unit = _pow10(digits);
  final scaled = (ratio.abs() * 100 * unit).round();
  final negative = ratio < 0 && scaled != 0;
  final whole = _group((scaled ~/ unit).toString(), _thousands(locale));
  final fraction = digits > 0 ? '${_decimal(locale)}${(scaled % unit).toString().padLeft(digits, '0')}' : '';
  final text = '${negative ? minus : ''}$whole$fraction';
  return locale == AppLocale.es ? '$text$nbsp%' : '$text%';
}

/// `+0,9 %` / `−0,9 %` / `0,0 %`.
String formatSignedPercent(double ratio, AppLocale locale, [int digits = 1]) {
  final text = formatPercent(ratio, locale, digits);
  final zero = (ratio.abs() * 100 * _pow10(digits)).round() == 0;
  return text.startsWith(minus) || zero ? text : '+$text';
}

String monthName(int month, AppLocale locale) => _months[locale]![month - 1];

String monthShort(int month, AppLocale locale) => _monthsShort[locale]![month - 1];

/// `day` is `YYYY-MM-DD`. Long: `20 de noviembre de 2026` / `November 20, 2026`;
/// short: `20 nov 2026` / `Nov 20, 2026`.
String formatDay(String day, AppLocale locale, {bool short = false}) {
  final year = day.substring(0, 4);
  final month = int.parse(day.substring(5, 7));
  final date = int.parse(day.substring(8, 10));
  final name = short ? monthShort(month, locale) : monthName(month, locale);
  if (locale == AppLocale.es) return short ? '$date $name $year' : '$date de $name de $year';
  return '$name $date, $year';
}

/// `20/11` (es) / `11/20` (en), optionally with the year: compact axis and table labels.
String formatDayNumeric(String day, AppLocale locale, {bool withYear = false}) {
  final dd = day.substring(8, 10);
  final mm = day.substring(5, 7);
  final year = withYear ? '/${day.substring(2, 4)}' : '';
  return locale == AppLocale.es ? '$dd/$mm$year' : '$mm/$dd$year';
}

/// `mar 2024` / `Mar 2024`: axis labels.
String formatMonthShort(int year, int month, AppLocale locale) => '${monthShort(month, locale)} $year';

/// Argentina keeps UTC−3 all year (no daylight saving since 2009).
const Duration _artOffset = Duration(hours: -3);

DateTime _art(DateTime instant) => instant.toUtc().add(_artOffset);

String _two(int value) => value.toString().padLeft(2, '0');

/// The Argentine calendar day of an instant, `YYYY-MM-DD`.
String artDay(DateTime instant) {
  final t = _art(instant);
  return '${t.year.toString().padLeft(4, '0')}-${_two(t.month)}-${_two(t.day)}';
}

/// Argentine wall-clock time of an instant: `19:45`.
String formatTime(DateTime instant) {
  final t = _art(instant);
  return '${_two(t.hour)}:${_two(t.minute)}';
}

/// Argentine date and time of an instant: `20 nov 2026, 19:45` / `Nov 20, 2026, 19:45`.
String formatDateTime(DateTime instant, AppLocale locale) {
  return '${formatDay(artDay(instant), locale, short: true)}, ${formatTime(instant)}';
}

/// Coarse elapsed time: `hace 5 min` / `5 min ago`, then hours, then days.
String formatAgo(DateTime from, DateTime now, AppLocale locale) {
  final minutes = now.difference(from).inMinutes.clamp(0, 1 << 31);
  String amount;
  if (minutes < 60) {
    amount = '$minutes min';
  } else if (minutes < 48 * 60) {
    amount = '${minutes ~/ 60} h';
  } else {
    amount = locale == AppLocale.es ? '${minutes ~/ 1440} días' : '${minutes ~/ 1440} days';
  }
  return locale == AppLocale.es ? 'hace $amount' : '$amount ago';
}

/// Parses an amount typed in either notation (`1.234,5` or `1,234.5`); `null` when it is not a number.
double? parseAmount(String text, AppLocale locale) {
  var clean = text.trim().replaceAll(RegExp(r'[\s$ ]'), '');
  if (clean.isEmpty) return null;
  if (locale == AppLocale.es) {
    clean = clean.replaceAll('.', '').replaceFirst(',', '.');
  } else {
    clean = clean.replaceAll(',', '');
  }
  if (!RegExp(r'^\d+(\.\d+)?$').hasMatch(clean)) return null;
  return double.tryParse(clean);
}
