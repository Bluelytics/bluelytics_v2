/// Alerts over Firebase Cloud Messaging. Firebase is only started when alerts are (being turned)
/// on, so a device that never asks for alerts never talks to Firebase.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../config.dart';
import 'alerts.dart';
import 'firebase_options.dart';

class FirebasePush implements PushBackend {
  final StreamController<AlertMessage> _messages = StreamController.broadcast();
  StreamSubscription<RemoteMessage>? _foreground;

  static const MethodChannel _legacy = MethodChannel('bluelytics/legacy');

  @override
  bool get supported => Platform.isAndroid || Platform.isIOS;

  @override
  Stream<AlertMessage> get messages => _messages.stream;

  Future<FirebaseMessaging> _messaging() async {
    if (Firebase.apps.isEmpty) await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    return FirebaseMessaging.instance;
  }

  @override
  Future<bool> enable() async {
    final messaging = await _messaging();
    // Off in the manifest and Info.plist: no token exists until someone asks for alerts.
    await messaging.setAutoInitEnabled(true);
    final settings = await messaging.requestPermission(alert: true, badge: false, sound: true);
    final status = settings.authorizationStatus;
    if (status != AuthorizationStatus.authorized && status != AuthorizationStatus.provisional) return false;
    if (Platform.isIOS) await _waitForApnsToken(messaging);
    await messaging.subscribeToTopic(alertsTopic);
    await _listen(messaging);
    return true;
  }

  @override
  Future<void> disable() async {
    final messaging = await _messaging();
    await messaging.unsubscribeFromTopic(alertsTopic);
    await messaging.setAutoInitEnabled(false);
    await _foreground?.cancel();
    _foreground = null;
  }

  @override
  Future<void> resume() async {
    final messaging = await _messaging();
    // Keeps the token fresh for devices that carried their subscription over from version 1.
    await messaging.setAutoInitEnabled(true);
    await _listen(messaging);
  }

  Future<void> _listen(FirebaseMessaging messaging) async {
    // iOS shows nothing for a message that arrives while the app is open unless asked to; Android
    // never does, so the app shows its own banner from the stream.
    if (Platform.isIOS) await messaging.setForegroundNotificationPresentationOptions(alert: true, badge: false, sound: true);
    _foreground ??= FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;
      _messages.add(AlertMessage(title: notification.title ?? '', body: notification.body ?? ''));
    });
  }

  /// A topic subscription on iOS needs the APNs token, which arrives a moment after permission.
  Future<void> _waitForApnsToken(FirebaseMessaging messaging) async {
    for (var attempt = 0; attempt < 20; attempt++) {
      if (await messaging.getAPNSToken() != null) return;
      await Future<void>.delayed(const Duration(milliseconds: 250));
    }
    throw StateError('APNs token not available');
  }

  /// The React Native app kept its switch in AsyncStorage under `subState` (`'true'`/`'false'`).
  @override
  Future<bool?> legacyEnabled() async {
    if (Platform.isAndroid) {
      // An SQLite database, read natively (android/.../MainActivity.kt).
      return _legacy.invokeMethod<bool>('alertsEnabled');
    }
    if (Platform.isIOS) {
      final support = await getApplicationSupportDirectory();
      final documents = await getApplicationDocumentsDirectory();
      for (final path in [
        '${support.path}/${DefaultFirebaseOptions.ios.iosBundleId}/RCTAsyncLocalStorage_V1/manifest.json',
        '${support.path}/RCTAsyncLocalStorage_V1/manifest.json',
        '${documents.path}/RCTAsyncLocalStorage_V1/manifest.json',
      ]) {
        final file = File(path);
        if (!file.existsSync()) continue;
        final manifest = jsonDecode(await file.readAsString());
        final value = manifest is Map ? manifest['subState'] : null;
        if (value is String) return value == 'true';
      }
    }
    return null;
  }
}
