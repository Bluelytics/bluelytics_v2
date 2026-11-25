import 'dart:convert';

import 'package:bluelytics/domain/calc.dart';
import 'package:bluelytics/domain/format.dart';
import 'package:bluelytics/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

void main() {
  final rows = parseCurrencies(jsonDecode(fixture('currencies')));

  test('the picker lists the dollar and the euro, then the Americas, then the rest', () {
    final list = calcCurrencies(rows, AppLocale.es);
    expect(list[0].code, 'USD');
    expect(list[1].code, 'EUR');
    expect(list.where((c) => c.code == 'USD' || c.code == 'EUR' || c.code == 'ARS').length, 2, reason: 'no duplicates of the published ones, no pesos');
    final groups = list.map((c) => c.group).toList();
    expect(groups.indexOf(CurrencyGroup.americas), 2);
    expect(groups.lastIndexOf(CurrencyGroup.americas), lessThan(groups.indexOf(CurrencyGroup.other)));
    final american = list.where((c) => c.group == CurrencyGroup.americas).map((c) => c.code).toSet();
    expect(american, containsAll(['BRL', 'CLP', 'UYU', 'PYG', 'BOB', 'PEN', 'COP', 'MXN', 'CAD']));
    expect(list.firstWhere((c) => c.code == 'GBP').group, CurrencyGroup.other);
  });

  test('names are Spanish as stored, or English from the table', () {
    expect(calcCurrencies(rows, AppLocale.es).firstWhere((c) => c.code == 'BRL').name, 'Real brasileño');
    final english = calcCurrencies(rows, AppLocale.en);
    expect(english.firstWhere((c) => c.code == 'BRL').name, 'Brazilian real');
    expect(english.first.name, 'US dollar');
    final names = english.where((c) => c.group == CurrencyGroup.other).map((c) => c.name).toList();
    expect(names.take(3), ['Afghan afghani', 'Albanian lek', 'Algerian dinar'], reason: 'sorted by the name on screen');
  });

  test('search ignores case and accents and matches codes', () {
    final list = calcCurrencies(rows, AppLocale.es);
    List<String> find(String query) => [
      for (final c in list)
        if (matchesCurrency(c, query)) c.code,
    ];
    expect(find('dolar canad'), ['CAD']);
    expect(find('brl'), ['BRL']);
    expect(find('GUARANÍ'), ['PYG']);
    expect(find('  '), hasLength(list.length));
    expect(find('zzzz'), isEmpty);
  });

  test('rates: published for the dollar and the euro, through the dollar for the rest', () {
    final list = calcCurrencies(rows, AppLocale.es);
    final usd = list[0], eur = list[1];
    final brl = list.firstWhere((c) => c.code == 'BRL');
    expect(rateFor(usd, usd: 171000, eur: 185900), 171000);
    expect(rateFor(eur, usd: 171000, eur: 185900), 185900);
    // 1 USD = 5.93 BRL, so one real is 1710 / 5.93 pesos.
    expect(rateFor(brl, usd: 171000, eur: 185900), closeTo(28836.4, 0.1));
    expect(rateFor(brl, usd: null, eur: 185900), isNull);
    expect(rateFor(eur, usd: 171000, eur: null), isNull);
    expect(usd.sign, r'US$');
    expect(eur.sign, '€');
    expect(brl.sign, 'BRL');
  });

  test('conversions round to a hundredth', () {
    expect(toPesosHundredths(100, 171000), 17100000);
    expect(toPesosHundredths(0.5, 171000), 85500);
    expect(toForeignHundredths(100000, 171000), 5848);
    expect(toForeignHundredths(100000, 0), 0);
  });
}
