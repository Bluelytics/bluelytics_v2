# Bluelytics mobile app

The Bluelytics app for Android and iOS, written in Flutter, in the dark "Editorial Bold" style of
[bluelytics.com.ar](https://bluelytics.com.ar). It replaces the React Native app (versions 1.x) and
keeps its store identifiers, so it ships as an update to the same listings.

| Screen | What it shows |
| --- | --- |
| **Hoy** / Today | Blue dollar sell price, its move since the previous close, buy and average, a chart of the last month, the official dollar, the gap, both euros, the other dollar rates (MEP, CCL, cripto, tarjeta, mayorista) and a dollars-to-pesos table |
| **Histórico** / History | Blue and official since 2011, or the gap between them, over 1 month to the whole history; a summary of the period and every day as a table. Touch the chart to read a day |
| **Calcular** / Convert | Any of about 165 currencies to pesos and back, at the blue and official rates. Tap a result to copy it |
| **Alertas** / Alerts | The push alert switch, the last alert, and links to the site, the API and the source |

Spanish and English, following the device language, with a toggle in the header. The last data
fetched is kept on disk, so the app opens instantly and still shows prices without a connection.

## Requirements

| To | You need |
| --- | --- |
| Run the tests, work on the interface | Flutter 3.38 (Dart 3.10) |
| Build for Android | The Android SDK and **JDK 17 to 21**. Gradle 8.14 does not run on newer JDKs; point Flutter at a suitable one with `flutter config --jdk-dir <path>` |
| Build for iOS | A Mac with Xcode 16 or later and CocoaPods. iOS 15 is the minimum the app supports (Firebase requires it) |

## Everyday commands

Run them in `apps/mobile`.

```sh
flutter pub get
flutter run                 # on a connected phone, a simulator, or -d linux for a desktop window
flutter analyze
flutter test                # the whole suite; needs no network
dart format lib test        # line length 160, set in analysis_options.yaml
```

Two test files only run on request:

```sh
# Every screen in both languages as PNG files in build/screenshots/ (no device needed).
SCREENSHOTS=1 flutter test test/screenshots_test.dart
SCREENSHOTS=1 SCREENSHOT_SIZE=430x932@3 flutter test test/screenshots_test.dart   # 1290×2796, App Store 6.7"
SCREENSHOTS=1 SCREENSHOT_SIZE=360x640@3 flutter test test/screenshots_test.dart   # 1080×1920, Google Play

# The data layer against the production API, to catch a contract change the fixtures hide.
LIVE=1 flutter test test/live_api_test.dart
```

The other tests read captured API bodies in `test/fixtures/`.

If the first run after editing a file fails to *load* some test files with "Unable to connect to
flutter_tester process", run it again: it is the test runner, not the tests.

## Layout

```
lib/
  main.dart, app.dart    start-up; the shell with the header, the four tabs and the alert banner
  config.dart            API hosts, links, the version shown in the app
  domain/                pure Dart: number and date formats, API models, series and chart maths, calculator
  data/                  HTTP client, disk cache, the store the screens listen to, settings
  push/                  alerts: the controller, the Firebase backend, generated Firebase options
  theme/, widgets/       colours and type from the site; chart, ticker tape, blade and the shared pieces
  screens/               one file per tab
  i18n/strings.dart      every string, in Spanish and English
tool/                    scripts that generate the icons and the Firebase options
```

`lib/domain/format.dart` is a port of `apps/web/src/lib/format.ts`: the app and the site print every
number the same way. Money is an integer number of hundredths of a peso throughout.

## Where the data comes from

| Feed | URL | Asked for |
| --- | --- | --- |
| Live quotes | `api.bluelytics.com.ar/v2/latest` | When the app opens or comes back, on pull to refresh, and every 60 s while on screen |
| Last 45 days | `api.bluelytics.com.ar/v2/evolution.json?days=90` | With the live quotes |
| History since 2011 | `api.bluelytics.com.ar/v2/evolution.json` (about 30 kB compressed) | At most every 6 hours |
| Currencies | `api.bluelytics.com.ar/data/json/currency.json` | At most every 6 hours |
| Last alert | `api.bluelytics.com.ar/v2/alerts` | With the live quotes |
| Other dollar rates | `bluelytics.com.ar/data/extras.json` | With the live quotes |

The last one is served by the website (`apps/web/src/pages/data/extras.json.ts`), not by the public
API. Until the website is deployed with that route the request returns 404 and the app leaves the
"Otros tipos de dólar" section out; nothing else depends on it.

## Push alerts

The device subscribes to the Firebase Cloud Messaging topic `alertas-blue`; the sender is the jobs
Worker (`apps/jobs/src/alerts.ts`). Firebase does nothing, and no push token exists, until someone
turns the switch on. Someone updating from version 1 keeps the choice they had.

**The sender is off today** (`PUSH_ENABLED` is `"false"` in `apps/jobs/wrangler.jsonc`), so the switch
subscribes but nothing arrives. To turn alerts on:

1. **iOS only:** in the [Apple Developer](https://developer.apple.com/account/resources/authkeys/list)
   account create an APNs key (`.p8`), and upload it in the Firebase console: project
   `bluelytics-mobile` → Project settings → Cloud Messaging → Apple app configuration. Without it
   iPhones never receive anything.
2. Give the jobs Worker a service account key as the secret `FIREBASE_SERVICE_ACCOUNT_JSON`
   (`docs/MIGRATION.md`, step 0.3). That key is a secret: it never goes in the repository.
3. Set `PUSH_ENABLED` to `"true"` and deploy the jobs Worker.

`android/app/google-services.json` and `ios/Runner/GoogleService-Info.plist` are a different thing:
client identifiers that ship inside every copy of the app. After replacing either, run
`python3 tool/gen_firebase_options.py`, which rewrites `lib/push/firebase_options.dart`.

## Releasing

### Version

`version:` in `pubspec.yaml` is `name+build`, for example `2.0.1+5000001`. Raise both for every
upload, and set `appVersion` in `lib/config.dart` to the same name (a test checks it).

The build number starts at 5,000,000 because the React Native builds used one code per processor
type on Google Play, up to 4,194,312, and a new upload must be higher than every earlier one.

### Android

The app id is `com.bluelytics.mobileapp`, the one the app has always had on Google Play.

1. **Upload key.** Google Play only accepts an update signed with the upload key registered for the
   app. The original keystore is not in this repository. If it is lost and the app uses Play App
   Signing, ask for a reset in Play Console (App integrity → App signing → Request upload key
   reset) with a new key:

   ```sh
   keytool -genkeypair -v -keystore ~/bluelytics-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```

   If the app was never enrolled in Play App Signing and the key is lost, it cannot be updated: publish
   under a new app id (change `applicationId` and `namespace` in `android/app/build.gradle.kts`, add
   that Android app in Firebase and replace `google-services.json`).

2. **Tell Gradle about the key** in `android/key.properties` (ignored by git):

   ```properties
   storeFile=/home/you/bluelytics-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```

   Without this file the release build is signed with the debug key: it installs on a phone for
   testing, and Google Play rejects it.

3. **Build and upload.**

   ```sh
   flutter build appbundle --release
   ```

   Upload `build/app/outputs/bundle/release/app-release.aab` to an internal testing track first.

Without the Android SDK, or with only a newer JDK, the same build runs in a container (Docker):

```sh
tool/android_build.sh          # → build/android/app-release.aab and app-release.apk
```

It uses `android/key.properties` in the same way, and leaves nothing owned by root in the project.

CI builds the bundle too. With the repository secrets `ANDROID_KEYSTORE_BASE64` (the keystore,
`base64 -w0`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` set, the
artifact of the "Mobile app" workflow is signed with the upload key and ready for Google Play.

### iOS

The bundle id is `com.bluelytics.mobile` and signing is automatic for team `9AGK8J3LYF`.

```sh
flutter pub get
cd ios && pod install && cd ..      # the first time; commit the Podfile.lock it writes
open ios/Runner.xcworkspace         # once: sign in to the team in Xcode so it can create the profiles
flutter build ipa --release
```

Upload `build/ios/ipa/*.ipa` with Transporter or from Xcode's Organizer, and try it in TestFlight
before submitting.

**The iOS project has not been built yet.** It was configured on Linux, where Xcode does not run.
The first build on a Mac, or the `iOS build` job of the "Mobile app" workflow, is its first check.

### Before the first submission

- Confirm in Play Console and App Store Connect that both apps still exist. Both public listings
  returned "not found" on 2026-11-22 (`docs/legacy/legacy-mobile.md`).
- Both stores ask for a **privacy policy URL**; the site has no such page yet.
- Data collected, for the stores' privacy forms: nothing about the person. With alerts on, Firebase
  Cloud Messaging holds a push token for the device (a device identifier, used for app functionality,
  not for tracking). The Firebase Analytics SDK is not part of the app.
- Screenshots: see `SCREENSHOT_SIZE` above.

## Icons and launch screen

Generated from the brand marks in `assets/brand/` at the repository root:

```sh
python3 tool/make_art.py                  # needs rsvg-convert (librsvg)
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```
