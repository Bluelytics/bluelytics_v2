// The whole app over captured API bodies: what a person sees and can do on each screen.
import 'package:bluelytics/data/api.dart';
import 'package:bluelytics/domain/format.dart';
import 'package:bluelytics/push/alerts.dart';
import 'package:bluelytics/widgets/rate_chart.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

Future<void> openTab(WidgetTester tester, String label) async {
  await tester.tap(find.bySemanticsLabel(label).last);
  await tester.pump();
}

void main() {
  group('today', () {
    testWidgets('shows the blue dollar, its move since the previous close and the other rates', (tester) async {
      await pumpApp(tester);
      expect(find.text('Dólar blue hoy'), findsOneWidget);
      expect(find.text('1.710'), findsOneWidget, reason: 'the sell price, large');
      expect(find.bySemanticsLabel('+10, +0,59$nbsp%'), findsWidgets);
      expect(find.text('vs. cierre del 24 nov 2026'), findsOneWidget);
      expect(find.textContaining('ACTUALIZADO 25 NOV 2026, 19:20'), findsOneWidget, reason: 'Argentine time, whatever the device zone');
      expect(find.text('\$${nbsp}1.690'), findsWidgets);
      expect(find.text('\$${nbsp}1.700,00'), findsOneWidget);
      expect(find.byType(RateChart), findsOneWidget);
      expect(find.text('Dólar oficial'.toUpperCase()), findsWidgets);
      expect(find.text('Otros tipos de dólar'), findsOneWidget);
      expect(find.text('DÓLAR MEP'), findsOneWidget);
      expect(find.text('Dólares a pesos'), findsOneWidget);
      expect(find.text('\$${nbsp}1.710.000'), findsOneWidget, reason: 'US\$ 1.000 at the sell price');
    });

    testWidgets('in English every label and number format changes', (tester) async {
      await pumpApp(tester, locale: AppLocale.en);
      expect(find.text('Blue dollar today'), findsOneWidget);
      expect(find.text('1,710'), findsOneWidget);
      expect(find.text('vs. Nov 24, 2026 close'), findsOneWidget);
      expect(find.text(r'$1,700.00'), findsOneWidget);
      expect(find.text('Dollars to pesos'), findsOneWidget);
    });

    testWidgets('the section with other dollar rates disappears when nobody serves it', (tester) async {
      await pumpApp(tester, store: fixtureStore(fail: {Feed.extras}));
      expect(find.text('1.710'), findsOneWidget);
      expect(find.text('Otros tipos de dólar'), findsNothing);
      expect(find.text('Dólares a pesos'), findsOneWidget);
    });

    testWidgets('without network and without cache it says so and offers to retry', (tester) async {
      final harness = await pumpApp(tester, store: fixtureStore(fail: Feed.values.toSet()));
      expect(find.text('No pudimos traer las cotizaciones.'), findsOneWidget);
      expect(find.text('REINTENTAR'), findsOneWidget);
      expect(harness.store.hasData, isFalse);
    });

    testWidgets('offline with a cache: the last known prices stay, marked as such', (tester) async {
      final store = fixtureStore();
      await tester.runAsync(store.refresh);
      // The next start, ten minutes later, cannot reach the API.
      final offline = fixtureStore(fail: Feed.values.toSet(), cache: store.cache, clock: () => fixtureNow.add(const Duration(minutes: 10)));
      await tester.runAsync(offline.restore);
      await pumpApp(tester, store: offline);
      expect(find.text('1.710'), findsOneWidget);
      expect(find.textContaining('SIN CONEXIÓN'), findsOneWidget);
    });

    testWidgets('fits a small phone with the largest text the app allows', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpApp(tester, size: const Size(320, 568));
      expect(tester.takeException(), isNull);
      for (final tab in ['Histórico', 'Calcular', 'Alertas', 'Hoy']) {
        await openTab(tester, tab);
        expect(tester.takeException(), isNull, reason: tab);
      }
    });

    testWidgets('fits a tablet in landscape', (tester) async {
      await pumpApp(tester, size: const Size(1180, 820));
      expect(tester.takeException(), isNull);
      for (final tab in ['Histórico', 'Calcular', 'Alertas']) {
        await openTab(tester, tab);
        expect(tester.takeException(), isNull, reason: tab);
      }
    });
  });

  group('language', () {
    testWidgets('the toggle switches the whole app and is remembered', (tester) async {
      final harness = await pumpApp(tester);
      await tester.tap(find.bySemanticsLabel('Switch to English'));
      await tester.pump();
      expect(find.text('Blue dollar today'), findsOneWidget);
      expect(find.text('1,710'), findsOneWidget);
      expect(harness.settings.locale, AppLocale.en);
      expect(harness.settings.prefs.getString('locale'), 'en');
      await tester.tap(find.bySemanticsLabel('Cambiar a español'));
      await tester.pump();
      expect(find.text('Dólar blue hoy'), findsOneWidget);
    });
  });

  group('history', () {
    testWidgets('one year by default; the table is the newest day first', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Histórico');
      expect(find.text('Dólar blue y oficial, día por día desde 2011.'), findsOneWidget);
      expect(find.byType(RateChart), findsWidgets);
      expect(find.text('VARIACIÓN'), findsOneWidget);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -520));
      await tester.pump();
      expect(find.text('25/11/26'), findsOneWidget);
      expect(find.text('24/11/26'), findsOneWidget);
      final newest = tester.getTopLeft(find.text('25/11/26')).dy;
      expect(newest, lessThan(tester.getTopLeft(find.text('24/11/26')).dy));
    });

    testWidgets('range and mode can be changed', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Histórico');
      await tester.tap(find.text('1M'));
      await tester.pump();
      expect(find.textContaining('días con datos'), findsOneWidget);
      final month = tester.widget<RateChart>(find.byType(RateChart).last).days;
      expect(month.first.day.compareTo('2026-10-26'), greaterThanOrEqualTo(0));
      await tester.tap(find.text('MÁX'));
      await tester.pump();
      expect(tester.widget<RateChart>(find.byType(RateChart).last).days.length, greaterThan(500));
      await tester.tap(find.text('BRECHA').first);
      await tester.pump();
      expect(tester.takeException(), isNull);
    });

    testWidgets('the gap tile on Today opens History on the gap', (tester) async {
      await pumpApp(tester);
      await tester.ensureVisible(find.text('BRECHA CAMBIARIA'));
      await tester.pump();
      await tester.tap(find.text('BRECHA CAMBIARIA'));
      await tester.pump();
      expect(find.text('Dólar blue y oficial, día por día desde 2011.'), findsOneWidget);
    });

    testWidgets('touching the chart reads the day under the finger', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Histórico');
      await tester.tap(find.text('1M'));
      await tester.pump();
      final chart = find.byType(RateChart).last;
      final box = tester.getRect(chart);
      await tester.tapAt(Offset(box.left + 40, box.center.dy));
      await tester.pump();
      expect(
        find.descendant(of: chart, matching: find.textContaining('oct 2026')),
        findsOneWidget,
        reason: 'the left edge of the last month',
      );
      // The reading goes back to the last day by itself.
      await tester.pump(const Duration(seconds: 4));
      expect(find.descendant(of: chart, matching: find.textContaining('25 nov 2026')), findsOneWidget);
    });
  });

  group('calculator', () {
    testWidgets('dollars to pesos at both rates, and back', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Calcular');
      expect(find.text('Escribí un monto.'), findsNothing, reason: 'starts with an amount');
      await tester.enterText(find.byType(EditableText), '250');
      await tester.pump();
      // Blue: buy at the sell price (1.710), sell at the buy price (1.690).
      expect(find.text('\$${nbsp}427.500'), findsOneWidget);
      expect(find.text('\$${nbsp}422.500'), findsOneWidget);
      // Official: 1.630 and 1.580.
      expect(find.text('\$${nbsp}407.500'), findsOneWidget);
      expect(find.text('\$${nbsp}395.000'), findsOneWidget);

      await tester.tap(find.bySemanticsLabel(RegExp('^Invertir')));
      await tester.pump();
      await tester.enterText(find.byType(EditableText), '171.000');
      await tester.pump();
      expect(find.text('US\$${nbsp}100,00'), findsOneWidget);
    });

    testWidgets('an amount that is not a number asks for one', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Calcular');
      await tester.enterText(find.byType(EditableText), '');
      await tester.pump();
      expect(find.text('Escribí un monto.'), findsOneWidget);
    });

    testWidgets('any currency can be picked by searching; it converts through the dollar', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Calcular');
      await tester.enterText(find.byType(EditableText), '100');
      await tester.pump();
      await tester.tap(find.bySemanticsLabel(RegExp('^Moneda:')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Elegí la moneda'), findsOneWidget);
      expect(find.text('MONEDAS DE AMÉRICA (VÍA DÓLAR)'), findsOneWidget);
      await tester.enterText(find.byType(EditableText).last, 'real bras');
      await tester.pump();
      await tester.tap(find.bySemanticsLabel('Real brasileño (BRL)'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Elegí la moneda'), findsNothing);
      // 100 BRL × 1.710 / 5,93.
      expect(find.text('\$${nbsp}28.836,42'), findsOneWidget);
      expect(find.textContaining('Convertido a través del dólar'), findsOneWidget);
    });

    testWidgets('tapping a result copies it', (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied.add(((call.arguments as Map<Object?, Object?>)['text'])! as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await pumpApp(tester);
      await openTab(tester, 'Calcular');
      await tester.enterText(find.byType(EditableText), '250');
      await tester.pump();
      await tester.tap(find.text('\$${nbsp}427.500'));
      await tester.pump();
      expect(copied, [r'$ 427.500']);
      expect(find.text('✓ Copiado'), findsOneWidget);
    });
  });

  group('alerts', () {
    testWidgets('the switch subscribes and shows the state', (tester) async {
      final push = FakePush();
      final harness = await pumpApp(tester, push: push);
      await openTab(tester, 'Alertas');
      expect(find.text('DESACTIVADAS'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Alertas del dólar blue'));
      await tester.pump();
      await tester.pump();
      expect(push.calls, ['enable']);
      expect(harness.alerts.enabled, isTrue);
      expect(find.text('ACTIVADAS'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Alertas del dólar blue'));
      await tester.pump();
      await tester.pump();
      expect(push.calls, ['enable', 'disable']);
      expect(find.text('DESACTIVADAS'), findsOneWidget);
    });

    testWidgets('a refused permission is explained', (tester) async {
      await pumpApp(tester, push: FakePush(grant: false));
      await openTab(tester, 'Alertas');
      await tester.tap(find.bySemanticsLabel('Alertas del dólar blue'));
      await tester.pump();
      await tester.pump();
      expect(find.text('DESACTIVADAS'), findsOneWidget);
      expect(find.textContaining('Las notificaciones están bloqueadas'), findsOneWidget);
    });

    testWidgets('where push does not exist the switch says so and does nothing', (tester) async {
      final harness = await pumpApp(tester);
      await openTab(tester, 'Alertas');
      expect(find.textContaining('solo están disponibles en la app para iOS y Android'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Alertas del dólar blue'));
      await tester.pump();
      expect(harness.alerts.enabled, isFalse);
    });

    testWidgets('shows the last alert and the version', (tester) async {
      await pumpApp(tester);
      await openTab(tester, 'Alertas');
      expect(find.text('Última alerta'), findsOneWidget);
      expect(find.text('Subió el dólar blue'), findsOneWidget);
      expect(find.textContaining('1.740'), findsWidgets);
      expect(find.text('Versión 2.0.0 · © Bluelytics'), findsOneWidget);
    });

    testWidgets('an alert that arrives while the app is open shows as a banner, then leaves', (tester) async {
      final push = FakePush(legacy: true);
      await pumpApp(tester, push: push);
      push.receive(const AlertMessage(title: 'Subió el dólar blue', body: 'Venta: \$ 1.740'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Subió el dólar blue'), findsOneWidget);
      await tester.pump(const Duration(seconds: 9));
      expect(find.text('Subió el dólar blue'), findsNothing);
    });
  });
}
