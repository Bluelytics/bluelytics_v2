import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:bluelytics/app.dart';
import 'package:bluelytics/data/api.dart';
import 'package:bluelytics/data/cache.dart';
import 'package:bluelytics/data/settings.dart';
import 'package:bluelytics/data/store.dart';
import 'package:bluelytics/domain/format.dart';
import 'package:bluelytics/push/alerts.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fonts.dart';

/// The moment the fixtures were captured (their `last_update`), so "today" is stable.
final DateTime fixtureNow = DateTime.utc(2026, 11, 25, 22, 21);

String fixture(String name) => File('test/fixtures/$name.json').readAsStringSync();

/// An HTTP client that answers every feed from test/fixtures. `fail` makes the listed feeds return
/// 503; `overrides` replaces a body.
MockClient fixtureClient({Set<Feed> fail = const {}, Map<Feed, String> overrides = const {}, List<Uri>? log}) {
  return MockClient((request) async {
    log?.add(request.url);
    final feed = Feed.values.firstWhere((f) => f.url == request.url.toString());
    if (fail.contains(feed)) return http.Response('unavailable', 503);
    return http.Response.bytes(utf8.encode(overrides[feed] ?? fixture(feed.name)), 200, headers: {'content-type': 'application/json; charset=utf-8'});
  });
}

AppStore fixtureStore({Set<Feed> fail = const {}, Map<Feed, String> overrides = const {}, CacheStore? cache, DateTime Function()? clock}) {
  return AppStore(
    api: BluelyticsApi(
      client: fixtureClient(fail: fail, overrides: overrides),
    ),
    cache: cache ?? MemoryCacheStore(),
    clock: clock ?? () => fixtureNow,
  );
}

/// A push backend that records what the app asked of it.
class FakePush implements PushBackend {
  FakePush({this.grant = true, this.legacy, this.fail = false});

  bool grant;
  bool? legacy;
  bool fail;
  final List<String> calls = [];
  final StreamController<AlertMessage> _incoming = StreamController<AlertMessage>.broadcast();

  /// An alert arriving while the app is open.
  void receive(AlertMessage message) => _incoming.add(message);

  @override
  bool get supported => true;

  @override
  Future<bool> enable() async {
    calls.add('enable');
    if (fail) throw StateError('network');
    return grant;
  }

  @override
  Future<void> disable() async {
    calls.add('disable');
    if (fail) throw StateError('network');
  }

  @override
  Future<void> resume() async => calls.add('resume');

  @override
  Future<bool?> legacyEnabled() async => legacy;

  @override
  Stream<AlertMessage> get messages => _incoming.stream;
}

class Harness {
  Harness(this.store, this.settings, this.alerts);

  final AppStore store;
  final Settings settings;
  final AlertsController alerts;
}

/// Pumps the whole app over fixture data on a phone-sized surface, with motion reduced so every
/// frame is the settled one.
Future<Harness> pumpApp(
  WidgetTester tester, {
  AppLocale locale = AppLocale.es,
  AppStore? store,
  PushBackend push = const NoPush(),
  Size size = const Size(390, 844),
  double pixelRatio = 1,
  bool load = true,
  bool reduceMotion = true,
}) async {
  await loadAppFonts();
  tester.view.physicalSize = size * pixelRatio;
  tester.view.devicePixelRatio = pixelRatio;
  addTearDown(tester.view.reset);
  if (reduceMotion) {
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
  }
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final settings = Settings(prefs: prefs, deviceLocale: locale);
  final appStore = store ?? fixtureStore();
  final alerts = AlertsController(backend: push, prefs: prefs);
  // The full history is decoded on another isolate, which needs real time to answer.
  if (load) await tester.runAsync(() => appStore.refresh());
  await tester.runAsync(() => alerts.init());
  await tester.pumpWidget(BluelyticsApp(store: appStore, settings: settings, alerts: alerts));
  // Asset images decode off the fake clock.
  await tester.runAsync(() => precacheImage(const AssetImage('assets/brand/mark.png'), tester.element(find.byType(BluelyticsApp))));
  await tester.pump();
  return Harness(appStore, settings, alerts);
}
