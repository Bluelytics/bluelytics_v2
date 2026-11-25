import 'dart:io';

import 'package:bluelytics/config.dart';
import 'package:bluelytics/push/firebase_options.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final pubspec = File('pubspec.yaml').readAsStringSync();
  final version = RegExp(r'^version:\s*(\S+)\+(\d+)\s*$', multiLine: true).firstMatch(pubspec)!;

  test('the version shown in the app is the one in pubspec.yaml', () {
    expect(appVersion, version.group(1));
  });

  test('the build number is above every code the React Native builds used on Google Play', () {
    // Per-ABI codes were abi × 1.048.576 + 8, with abi up to 4.
    expect(int.parse(version.group(2)!), greaterThan(4 * 1048576 + 8));
  });

  test('the store identifiers are the ones the app has always had', () {
    final gradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(gradle, contains('applicationId = "com.bluelytics.mobileapp"'));
    final xcode = File('ios/Runner.xcodeproj/project.pbxproj').readAsStringSync();
    final bundleIds = RegExp(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);').allMatches(xcode).map((m) => m.group(1)).toSet();
    expect(bundleIds, {'com.bluelytics.mobile', 'com.bluelytics.mobile.RunnerTests'});
  });

  test('the Firebase options belong to those identifiers', () {
    expect(DefaultFirebaseOptions.android.projectId, 'bluelytics-mobile');
    expect(DefaultFirebaseOptions.ios.projectId, 'bluelytics-mobile');
    expect(DefaultFirebaseOptions.ios.iosBundleId, 'com.bluelytics.mobile');
    expect(File('android/app/google-services.json').readAsStringSync(), contains('"package_name": "com.bluelytics.mobileapp"'));
  });

  test('the Android notification channel is the one the sender targets', () {
    final application = File('android/app/src/main/kotlin/com/bluelytics/mobileapp/BluelyticsApplication.kt').readAsStringSync();
    expect(application, contains('ALERTS_CHANNEL_ID = "$alertsChannelId"'));
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:value="$alertsChannelId"'));
    expect(manifest, contains('android.permission.INTERNET'), reason: 'release builds get no network without it');
  });
}
