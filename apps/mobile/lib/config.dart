/// Build-time constants: hosts, links and identifiers.
library;

/// Marketing version; equal to the `version:` name in pubspec.yaml (test/config_test.dart).
const String appVersion = '2.0.0';

/// The public API (apps/api): the same endpoints every third-party consumer uses.
const String apiBase = 'https://api.bluelytics.com.ar';

/// The website (apps/web), used for links and for the optional `/data/extras.json`.
const String siteBase = 'https://bluelytics.com.ar';

/// FCM topic and Android channel the alert sender uses (packages/core/src/alerts.ts `FCM`).
const String alertsTopic = 'alertas-blue';
const String alertsChannelId = 'Dolar Blue';

abstract final class Links {
  static const String site = siteBase;
  static const String about = '$siteBase/acerca';
  static const String aboutEn = '$siteBase/en/about';
  static const String api = '$siteBase/api';
  static const String apiEn = '$siteBase/en/api';
  static const String source = 'https://github.com/Bluelytics/bluelytics_v2';
  static const String license = 'https://creativecommons.org/licenses/by/4.0/';
  static const String x = 'https://x.com/bluelytics';
  static const String instagram = 'https://www.instagram.com/bluelytics_dolar';
  static const String linkedin = 'https://www.linkedin.com/company/74483029';
}
