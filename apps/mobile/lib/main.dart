import 'dart:async';
import 'dart:io';
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'data/api.dart';
import 'data/cache.dart';
import 'data/settings.dart';
import 'data/store.dart';
import 'domain/format.dart';
import 'push/alerts.dart';
import 'push/firebase_push.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final deviceLanguage = PlatformDispatcher.instance.locale.languageCode;
  final settings = Settings(prefs: prefs, deviceLocale: deviceLanguage == 'es' ? AppLocale.es : AppLocale.en);
  final store = AppStore(api: BluelyticsApi(), cache: FileCacheStore(getApplicationCacheDirectory));
  final push = Platform.isAndroid || Platform.isIOS ? FirebasePush() : const NoPush();
  final alerts = AlertsController(backend: push, prefs: prefs);

  // What was on screen last time comes back before the first frame; the network follows.
  await store.restore();
  runApp(BluelyticsApp(store: store, settings: settings, alerts: alerts));
  unawaited(store.refresh());
  unawaited(alerts.init());
}
