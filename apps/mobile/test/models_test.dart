import 'dart:convert';

import 'package:bluelytics/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

void main() {
  test('hundredths: decimals, strings and junk', () {
    expect(hundredthsOf(1700.00), 170000);
    expect(hundredthsOf(4.07), 407);
    expect(hundredthsOf(1652.5), 165250);
    expect(hundredthsOf('1710.00'), 171000);
    expect(hundredthsOf(0), isNull);
    expect(hundredthsOf(-5), isNull);
    expect(hundredthsOf(null), isNull);
    expect(hundredthsOf(double.nan), isNull);
    expect(hundredthsOf('x'), isNull);
  });

  test('the average is the midpoint, rounded half up', () {
    expect(const Quote(169000, 171000).average, 170000);
    expect(const Quote(163500, 167000).average, 165250);
    expect(const Quote(1, 2).average, 2);
  });

  test('latest: the captured production body', () {
    final latest = Latest.fromJson(jsonDecode(fixture('latest')));
    expect(latest.blue, const Quote(169000, 171000));
    expect(latest.oficial, const Quote(158000, 163000));
    expect(latest.blueEuro, const Quote(183700, 185900));
    expect(latest.oficialEuro, const Quote(171700, 177200));
    expect(latest.updatedAt, DateTime.utc(2026, 11, 25, 22, 20, 12, 572));
  });

  test('latest: missing or malformed parts become null instead of throwing', () {
    expect(Latest.fromJson(null).blue, isNull);
    expect(Latest.fromJson(const <dynamic>[]).blue, isNull);
    final partial = Latest.fromJson(jsonDecode('{"blue":{"value_buy":1690,"value_sell":null},"oficial":"x","last_update":"nope"}'));
    expect(partial.blue, isNull);
    expect(partial.oficial, isNull);
    expect(partial.updatedAt, isNull);
  });

  test('evolution: rows become days, oldest first, with both sources', () {
    final days = parseEvolution(jsonDecode(fixture('recent')));
    expect(days.length, 45);
    expect(days.first.day.compareTo(days.last.day), lessThan(0));
    expect(days.last.day, '2026-11-25');
    expect(days.last.blue, const Quote(169000, 171000));
    expect(days.last.oficial, const Quote(158000, 163000));
    for (var i = 1; i < days.length; i++) {
      expect(days[i - 1].day.compareTo(days[i].day), lessThan(0), reason: 'sorted and unique');
    }
  });

  test('evolution: bad rows are skipped', () {
    final days = parseEvolution(
      jsonDecode(
        '[{"date":"2026-11-25","source":"Blue","value_sell":1710,"value_buy":1690},'
        '{"date":"25/11/2026","source":"Blue","value_sell":1,"value_buy":1},'
        '{"date":"2026-11-24","source":"Blue","value_sell":0,"value_buy":1680},'
        '{"date":"2026-11-24","source":"Otro","value_sell":1,"value_buy":1},'
        '"junk",'
        '{"date":"2026-11-24","source":"Oficial","value_sell":1615,"value_buy":1565}]',
      ),
    );
    expect(days.map((d) => d.day), ['2026-11-24', '2026-11-25']);
    expect(days[0].blue, isNull);
    expect(days[0].oficial, const Quote(156500, 161500));
    expect(days[1].oficial, isNull);
    expect(parseEvolution(null), isEmpty);
    expect(parseEvolution(const {'a': 1}), isEmpty);
  });

  test('currencies: the captured list, without the ones that have no value', () {
    final currencies = parseCurrencies(jsonDecode(fixture('currencies')));
    expect(currencies.length, greaterThan(150));
    expect(currencies.where((c) => c.code == 'BTC'), isEmpty, reason: 'value 0.00');
    final real = currencies.firstWhere((c) => c.code == 'BRL');
    expect(real.name, 'Real brasileño');
    expect(real.perUsdHundredths, 593);
  });

  test('alert: the captured body, and bodies without an alert', () {
    final alert = AlertInfo.fromJson(jsonDecode(fixture('alert')))!;
    expect(alert.id, 1891);
    expect(alert.at, DateTime.utc(2026, 11, 25, 15, 10, 12, 572));
    expect(alert.current.sell, 174000);
    expect(alert.previous!.sell, 172500);
    expect(AlertInfo.fromJson(null), isNull);
    expect(AlertInfo.fromJson(const <String, dynamic>{}), isNull);
  });

  test('extras: prices already in hundredths; entries without a sell price are dropped', () {
    final extras = parseExtras(jsonDecode(fixture('extras')));
    expect(extras.map((e) => e.code), ['mep', 'ccl', 'cripto', 'tarjeta', 'mayorista']);
    expect(extras[3].buy, isNull);
    expect(extras[3].sell, 211900);
    expect(parseExtras(jsonDecode('{"rates":[{"code":"mep","sell":null},{"code":7,"sell":1},"x"]}')), isEmpty);
    expect(parseExtras(const <dynamic>[]), isEmpty);
  });
}
