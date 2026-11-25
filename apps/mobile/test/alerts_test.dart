import 'package:bluelytics/push/alerts.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/harness.dart';

Future<AlertsController> controller(PushBackend backend, [Map<String, Object> saved = const {}]) async {
  SharedPreferences.setMockInitialValues(saved);
  return AlertsController(backend: backend, prefs: await SharedPreferences.getInstance());
}

void main() {
  test('off by default, and Firebase is left alone until someone turns alerts on', () async {
    final push = FakePush();
    final alerts = await controller(push);
    await alerts.init();
    expect(alerts.enabled, isFalse);
    expect(push.calls, isEmpty);
  });

  test('turning on subscribes and remembers; turning off unsubscribes', () async {
    final push = FakePush();
    final alerts = await controller(push);
    await alerts.init();
    await alerts.setEnabled(true);
    expect(alerts.enabled, isTrue);
    expect(alerts.problem, isNull);
    expect(alerts.prefs.getBool('alerts_enabled'), isTrue);
    await alerts.setEnabled(false);
    expect(alerts.enabled, isFalse);
    expect(alerts.prefs.getBool('alerts_enabled'), isFalse);
    expect(push.calls, ['enable', 'disable']);
  });

  test('a refused permission leaves alerts off and says why', () async {
    final alerts = await controller(FakePush(grant: false));
    await alerts.init();
    await alerts.setEnabled(true);
    expect(alerts.enabled, isFalse);
    expect(alerts.problem, AlertsProblem.denied);
  });

  test('a network failure keeps the previous state', () async {
    final push = FakePush(fail: true);
    final alerts = await controller(push, {'alerts_enabled': true});
    await alerts.init();
    expect(alerts.enabled, isTrue);
    await alerts.setEnabled(false);
    expect(alerts.enabled, isTrue, reason: 'still subscribed: the unsubscribe did not go through');
    expect(alerts.problem, AlertsProblem.failed);
    push.fail = false;
    await alerts.setEnabled(false);
    expect(alerts.enabled, isFalse);
    expect(alerts.problem, isNull);
  });

  test('a saved "on" resumes listening at start', () async {
    final push = FakePush();
    final alerts = await controller(push, {'alerts_enabled': true});
    await alerts.init();
    expect(alerts.enabled, isTrue);
    expect(push.calls, ['resume']);
  });

  test('the first run after updating from version 1 carries its switch over, once', () async {
    final push = FakePush(legacy: true);
    final alerts = await controller(push);
    await alerts.init();
    expect(alerts.enabled, isTrue);
    expect(alerts.prefs.getBool('alerts_enabled'), isTrue);
    expect(push.calls, ['enable'], reason: 'asks for the notification permission version 1 never requested');

    // The person turns alerts off: the old app's "on" must not come back.
    await alerts.setEnabled(false);
    final again = AlertsController(backend: FakePush(legacy: true), prefs: alerts.prefs);
    await again.init();
    expect(again.enabled, isFalse);
  });

  test('carried over from version 1 but notifications refused: off, and unsubscribed', () async {
    final push = FakePush(legacy: true, grant: false);
    final alerts = await controller(push);
    await alerts.init();
    expect(alerts.enabled, isFalse);
    expect(alerts.prefs.getBool('alerts_enabled'), isFalse);
    expect(push.calls, ['enable', 'disable']);
  });

  test('carried over from version 1 while offline: still on, as the device is still subscribed', () async {
    final push = FakePush(legacy: true, fail: true);
    final alerts = await controller(push);
    await alerts.init();
    expect(alerts.enabled, isTrue);
    expect(alerts.prefs.getBool('alerts_enabled'), isTrue);
    expect(alerts.problem, isNull);
  });

  test('version 1 had alerts off, or left no trace: off, and Firebase is not touched', () async {
    for (final legacy in [false, null]) {
      final push = FakePush(legacy: legacy);
      final alerts = await controller(push);
      await alerts.init();
      expect(alerts.enabled, isFalse);
      expect(alerts.prefs.getBool('alerts_enabled'), isFalse);
      expect(push.calls, isEmpty);
    }
  });

  test('where push does not exist the switch does nothing', () async {
    final alerts = await controller(const NoPush());
    await alerts.init();
    await alerts.setEnabled(true);
    expect(alerts.supported, isFalse);
    expect(alerts.enabled, isFalse);
    expect(alerts.prefs.getBool('alerts_enabled'), isNull);
  });
}
