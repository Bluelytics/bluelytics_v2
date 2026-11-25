// The app's data layer against the production API, to catch a contract change the fixtures hide:
//
//   LIVE=1 flutter test test/live_api_test.dart
//
// Skipped otherwise, so the normal suite never needs a network.
@Tags(['live'])
library;

import 'dart:io';

import 'package:bluelytics/data/api.dart';
import 'package:bluelytics/data/cache.dart';
import 'package:bluelytics/data/store.dart';
import 'package:bluelytics/domain/calc.dart';
import 'package:bluelytics/domain/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final enabled = Platform.environment['LIVE'] == '1';

  test('a cold start fills every screen from api.bluelytics.com.ar', () async {
    final store = AppStore(api: BluelyticsApi(), cache: MemoryCacheStore());
    addTearDown(store.api.close);
    await store.refresh();

    expect(store.offline, isFalse);
    final latest = store.latest!;
    expect(latest.blue!.sell, greaterThan(latest.blue!.buy));
    expect(latest.oficial, isNotNull);
    expect(latest.blueEuro, isNotNull);
    expect(latest.oficialEuro, isNotNull);
    expect(latest.updatedAt, isNotNull);

    expect(store.recent.length, greaterThan(20));
    expect(store.hasFullSeries, isTrue);
    expect(store.series.first.day.compareTo('2012-01-01'), lessThan(0), reason: 'the history goes back to 2011');
    expect(store.series.last.day, store.recent.last.day);

    final snapshot = store.snapshot!;
    expect(snapshot.previousDay, isNotNull);
    expect(snapshot.gap, isNotNull);

    final currencies = calcCurrencies(store.currencies, AppLocale.en);
    expect(currencies.length, greaterThan(100));
    expect(currencies.where((c) => c.group == CurrencyGroup.americas).length, greaterThan(15));
    final untranslated = currencies
        .where((c) => c.name == store.currencies.where((row) => row.code == c.code).firstOrNull?.name && c.code != 'EUR')
        .map((c) => c.code);
    printOnFailure('codes without an English name: ${untranslated.join(', ')}');

    // Printed for whoever runs it by hand.
    // ignore: avoid_print
    print(
      'blue ${formatPesos(latest.blue!.sell, AppLocale.es)} · oficial ${formatPesos(latest.oficial!.sell, AppLocale.es)} · '
      '${store.series.length} days from ${store.series.first.day} to ${store.series.last.day} · ${currencies.length} currencies · '
      'alert ${store.alert?.id} · extras ${store.extras.length}',
    );
  }, skip: !enabled);
}
