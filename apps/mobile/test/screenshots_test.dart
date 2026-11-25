// Renders every screen to build/screenshots/ for a visual check and for the store listings:
//
//   SCREENSHOTS=1 flutter test test/screenshots_test.dart
//   SCREENSHOTS=1 SCREENSHOT_SIZE=430x932@3 flutter test test/screenshots_test.dart   # 1290×2796, App Store 6.7"
//   SCREENSHOTS=1 SCREENSHOT_SIZE=360x640@3 flutter test test/screenshots_test.dart   # 1080×1920, Google Play
//
// SCREENSHOT_SIZE is the screen in logical pixels and its pixel ratio (default 390x844@2).
// It asserts nothing about pixels, so a font or engine update never fails the suite.
@Tags(['screenshots'])
library;

import 'dart:io';

import 'package:bluelytics/domain/format.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

Future<void> shoot(WidgetTester tester, String name) async {
  await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/screenshots/$name.png'));
}

({Size size, double ratio}) screen() {
  final match = RegExp(r'^(\d+)x(\d+)@(\d+(?:\.\d+)?)$').firstMatch(Platform.environment['SCREENSHOT_SIZE'] ?? '390x844@2');
  if (match == null) throw ArgumentError('SCREENSHOT_SIZE must look like 390x844@2');
  return (size: Size(double.parse(match.group(1)!), double.parse(match.group(2)!)), ratio: double.parse(match.group(3)!));
}

void main() {
  final enabled = Platform.environment['SCREENSHOTS'] == '1';
  setUp(() => autoUpdateGoldenFiles = true);
  tearDown(() => autoUpdateGoldenFiles = false);

  for (final locale in AppLocale.values) {
    testWidgets('screens (${locale.name})', (tester) async {
      final (:size, :ratio) = screen();
      await pumpApp(tester, locale: locale, size: size, pixelRatio: ratio, push: FakePush(legacy: true));
      final tag = locale.name;
      await shoot(tester, '$tag-1-today');

      await tester.drag(find.byType(SingleChildScrollView).first, const Offset(0, -620));
      await tester.pump();
      await shoot(tester, '$tag-2-today-more');
      await tester.drag(find.byType(SingleChildScrollView).first, const Offset(0, -600));
      await tester.pump();
      await tester.drag(find.byType(SingleChildScrollView).first, const Offset(0, -600));
      await tester.pump();
      await shoot(tester, '$tag-3-today-end');

      await tester.tap(find.bySemanticsLabel(locale == AppLocale.es ? 'Histórico' : 'History').last);
      await tester.pump();
      await shoot(tester, '$tag-4-history');
      await tester.tap(find.text(locale == AppLocale.es ? 'MÁX' : 'MAX'));
      await tester.pump();
      await tester.tap(find.text(locale == AppLocale.es ? 'BRECHA' : 'GAP').first);
      await tester.pump();
      await shoot(tester, '$tag-5-history-gap');

      await tester.tap(find.bySemanticsLabel(locale == AppLocale.es ? 'Calcular' : 'Convert').last);
      await tester.pump();
      await shoot(tester, '$tag-6-calculator');
      await tester.tap(find.bySemanticsLabel(RegExp(locale == AppLocale.es ? '^Moneda:' : '^Currency:')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await shoot(tester, '$tag-7-currencies');
      await tester.tap(find.bySemanticsLabel(locale == AppLocale.es ? 'Cerrar' : 'Close'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      await tester.tap(find.bySemanticsLabel(locale == AppLocale.es ? 'Alertas' : 'Alerts').last);
      await tester.pump();
      await shoot(tester, '$tag-8-alerts');
    }, skip: !enabled);
  }
}
