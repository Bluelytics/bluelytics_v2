import 'package:bluelytics/domain/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const es = AppLocale.es;
  const en = AppLocale.en;

  test('integers are grouped in threes with the locale separator', () {
    expect(formatInteger(0, es), '0');
    expect(formatInteger(999, es), '999');
    expect(formatInteger(1675, es), '1.675');
    expect(formatInteger(1675, en), '1,675');
    expect(formatInteger(1234567, es), '1.234.567');
    expect(formatInteger(-20, es), '${minus}20');
  });

  test('hundredths always show two decimals', () {
    expect(formatHundredths(165250, es), '1.652,50');
    expect(formatHundredths(165250, en), '1,652.50');
    expect(formatHundredths(5, es), '0,05');
    expect(formatHundredths(-405, es), '${minus}4,05');
  });

  test('prices show cents only when there are any', () {
    expect(formatPesos(171000, es), '\$${nbsp}1.710');
    expect(formatPesos(171000, en), r'$1,710');
    expect(formatPesos(405, es), '\$${nbsp}4,05');
    expect(formatPesosCents(170000, es), '\$${nbsp}1.700,00');
    expect(formatForeign(5848, r'US$', es), 'US\$${nbsp}58,48');
    expect(formatForeign(5848, '€', en), '€58.48');
  });

  test('signed amounts carry a plus or the typographic minus', () {
    expect(formatSignedAmount(3000, es), '+30');
    expect(formatSignedAmount(-2000, es), '${minus}20');
    expect(formatSignedAmount(0, es), '0');
    expect(formatSignedAmount(150, en), '+1.50');
  });

  test('percentages follow the locale and never print a negative zero', () {
    expect(formatPercent(0.049, es), '4,9$nbsp%');
    expect(formatPercent(0.049, en), '4.9%');
    expect(formatPercent(-0.0004, es), '0,0$nbsp%');
    expect(formatSignedPercent(0.0183, es, 2), '+1,83$nbsp%');
    expect(formatSignedPercent(-0.0121, es, 2), '${minus}1,21$nbsp%');
    expect(formatSignedPercent(0, es, 2), '0,00$nbsp%');
    expect(formatPercent(12.5, en, 0), '1,250%');
  });

  test('days in both languages', () {
    expect(formatDay('2026-11-20', es), '20 de noviembre de 2026');
    expect(formatDay('2026-11-20', en), 'November 20, 2026');
    expect(formatDay('2026-09-05', es, short: true), '5 sept 2026');
    expect(formatDay('2026-09-05', en, short: true), 'Sep 5, 2026');
    expect(formatDayNumeric('2026-11-20', es), '20/11');
    expect(formatDayNumeric('2026-11-20', en), '11/20');
    expect(formatDayNumeric('2026-11-20', es, withYear: true), '20/11/26');
    expect(formatMonthShort(2024, 3, es), 'mar 2024');
  });

  test('instants are shown in Argentine time whatever the device time zone', () {
    final lateEvening = DateTime.parse('2026-11-25T19:20:12.572-03:00');
    expect(artDay(lateEvening), '2026-11-25');
    expect(formatTime(lateEvening), '19:20');
    expect(formatDateTime(lateEvening, es), '25 nov 2026, 19:20');
    expect(formatDateTime(lateEvening, en), 'Nov 25, 2026, 19:20');
    // 01:30 UTC is still the previous evening in Buenos Aires.
    final afterMidnightUtc = DateTime.utc(2026, 11, 26, 1, 30);
    expect(artDay(afterMidnightUtc), '2026-11-25');
    expect(formatTime(afterMidnightUtc), '22:30');
  });

  test('elapsed time is coarse', () {
    final now = DateTime.utc(2026, 11, 25, 12);
    expect(formatAgo(now.subtract(const Duration(minutes: 5)), now, es), 'hace 5 min');
    expect(formatAgo(now.subtract(const Duration(hours: 3)), now, en), '3 h ago');
    expect(formatAgo(now.subtract(const Duration(days: 3)), now, es), 'hace 3 días');
    expect(formatAgo(now.add(const Duration(minutes: 5)), now, es), 'hace 0 min');
  });

  test('typed amounts are read in the locale notation', () {
    expect(parseAmount('1.234,5', es), 1234.5);
    expect(parseAmount('1,234.5', en), 1234.5);
    expect(parseAmount(' 100 ', es), 100);
    expect(parseAmount('0,5', es), 0.5);
    expect(parseAmount('', es), isNull);
    expect(parseAmount('12,3,4', es), isNull);
    expect(parseAmount('abc', en), isNull);
  });
}
