/// Blue dollar alerts: a push notification whenever the sell price moves significantly. The device
/// subscribes to an FCM topic; the sender is the jobs Worker (apps/jobs/src/alerts.ts).
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A notification that arrived while the app was open (the system shows it otherwise).
class AlertMessage {
  const AlertMessage({required this.title, required this.body});

  final String title;
  final String body;
}

/// The platform side of alerts. `FirebasePush` on phones; `NoPush` on desktop and in tests.
abstract interface class PushBackend {
  /// Whether this build can receive push notifications at all.
  bool get supported;

  /// Asks for permission and subscribes. `false` when the user refuses notifications.
  Future<bool> enable();

  Future<void> disable();

  /// Called at start when alerts are on: keeps foreground messages flowing into [messages].
  Future<void> resume();

  /// Whether the React Native app (versions 1.x) had alerts on, or `null` when it left no trace.
  Future<bool?> legacyEnabled();

  Stream<AlertMessage> get messages;
}

class NoPush implements PushBackend {
  const NoPush();

  @override
  bool get supported => false;

  @override
  Future<bool> enable() async => false;

  @override
  Future<void> disable() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<bool?> legacyEnabled() async => null;

  @override
  Stream<AlertMessage> get messages => const Stream.empty();
}

enum AlertsProblem { denied, failed }

class AlertsController extends ChangeNotifier {
  AlertsController({required this.backend, required this.prefs});

  static const String _key = 'alerts_enabled';

  final PushBackend backend;
  final SharedPreferences prefs;

  bool enabled = false;
  bool busy = false;
  AlertsProblem? problem;

  bool get supported => backend.supported;

  Stream<AlertMessage> get messages => backend.messages;

  /// Reads the saved choice. On the first run after an update from the React Native app it
  /// carries over that app's choice: a device that was subscribed stays subscribed, and the
  /// switch must say so.
  Future<void> init() async {
    if (!supported) return;
    final saved = prefs.getBool(_key);
    if (saved == null) return _firstRun();
    enabled = saved;
    notifyListeners();
    if (enabled) {
      try {
        await backend.resume();
      } on Object {
        // Notifications still arrive through the system; only the in-app banner is lost.
      }
    }
  }

  Future<void> _firstRun() async {
    bool legacy;
    try {
      legacy = await backend.legacyEnabled() ?? false;
    } on Object {
      legacy = false;
    }
    enabled = legacy;
    await prefs.setBool(_key, legacy);
    notifyListeners();
    if (!legacy) return;
    // Version 1 never asked Android 13+ for the notification permission, so a device can be
    // subscribed and still show nothing. Turning alerts on again asks for it; the subscription
    // itself is already there.
    try {
      if (await backend.enable()) return;
    } on Object {
      // Offline, for instance: the device is still subscribed from before.
      return;
    }
    // Refused: off, and no point in receiving what cannot be shown.
    enabled = false;
    await prefs.setBool(_key, false);
    notifyListeners();
    try {
      await backend.disable();
    } on Object {
      // The switch is off either way.
    }
  }

  Future<void> setEnabled(bool value) async {
    if (busy || !supported || value == enabled) return;
    busy = true;
    problem = null;
    notifyListeners();
    try {
      if (value) {
        if (await backend.enable()) {
          enabled = true;
        } else {
          problem = AlertsProblem.denied;
        }
      } else {
        await backend.disable();
        enabled = false;
      }
      await prefs.setBool(_key, enabled);
    } on Object {
      problem = AlertsProblem.failed;
    }
    busy = false;
    notifyListeners();
  }
}
