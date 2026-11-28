# Bluelytics for Android

The native Bluelytics app for Android, in Kotlin and Jetpack Compose, in the dark "Editorial Bold"
style of [bluelytics.com.ar](https://bluelytics.com.ar). It replaces the React Native app (versions
1.x) and keeps its application id, so it ships as an update to the same Google Play listing. The
iPhone app is a separate native project in `apps/ios`; both follow the same design and behaviour.

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
| Build, test, lint | **Docker** only: `tool/Dockerfile` has the JDK (21) and the Android SDK (platform 37.2, build tools 36). Or locally: JDK 17–21 and the Android SDK with platform `android-37.2` (Android Studio does this) |
| Run on a phone | Android 8.0 (API 26) or later |

The app supports Android 8.0 and later (`minSdk 26`): the variable Geist fonts take their weight
from the `wght` axis, which needs API 26. That is over 97 % of active devices.

## Everyday commands

Run them in `apps/android`. Without a local SDK, prefix any of them with the container (it runs as
you, so nothing in the project ends up owned by root):

```sh
docker build -t bluelytics-android-build tool/
alias gw='docker run --rm -i --user "$(id -u):$(id -g)" -v "$PWD":/src -w /src -v "$HOME/.gradle":/gradle -e GRADLE_USER_HOME=/gradle -e HOME=/tmp -e LIVE -e SCREENSHOTS -e SCREENSHOT_SIZE bluelytics-android-build ./gradlew --console=plain'
```

```sh
./gradlew :app:testDebugUnitTest      # every test on the JVM (Robolectric); needs no network or device
./gradlew :app:lintRelease            # Android lint; errors fail the build, warnings are listed
./gradlew :app:installDebug           # on a connected phone or a running emulator
./gradlew :app:bundleRelease          # → app/build/outputs/bundle/release/app-release.aab
```

Two suites only run on request:

```sh
# Every screen in both languages as PNG files in build/screenshots/ (no device needed).
SCREENSHOTS=1 ./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest'
SCREENSHOTS=1 SCREENSHOT_SIZE=360x640@3 ./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest'   # 1080×1920, Google Play

# The data layer against the production API, to catch a contract change the fixtures hide.
LIVE=1 ./gradlew :app:testDebugUnitTest --tests '*LiveApiTest'
```

`SCREENSHOT_SIZE` is the screen in dp and its density (default `390x844@2`, the size the Flutter app's
screenshots had). The other tests read captured API bodies in `app/src/test/resources/fixtures/`.

## Layout

```
app/src/main/kotlin/com/bluelytics/mobileapp/
  BluelyticsApplication.kt   start-up: the store, settings and alerts; the notification channel
  MainActivity.kt            splash screen, edge to edge, the notification permission prompt
  Config.kt                  API hosts, links, the version shown in the app
  domain/                    pure Kotlin: number and date formats, API models, series and chart maths, calculator
  data/                      HTTP, disk cache, the store the screens observe, settings
  push/                      alerts: the controller and the Firebase backend
  i18n/Strings.kt            every string, in Spanish and English
  ui/theme/                  colours and type from the site
  ui/widgets/                chart, ticker tape, blade and the shared pieces
  ui/screens/                one file per tab
  ui/App.kt                  the shell: header, tabs, alert banner, polling, system back
app/src/test/                unit and interface tests (JVM), fixtures
tool/                        the build image, the container build, the icon generator
```

`domain/Format.kt` is a port of `apps/web/src/lib/format.ts`: the app and the site print every number
the same way. Money is a whole number of hundredths of a peso throughout.

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
API. Until the website serves it, the app leaves the "Otros tipos de dólar" section out; nothing else
depends on it. Refreshes less than 30 s apart reuse what the API already returned.

## Testing on your phone

1. Build the APK (needs Docker; signed with the debug key unless `key.properties` exists):

   ```sh
   tool/build.sh                # → build/android/app-release.apk
   ```

2. On the phone, **uninstall the Bluelytics app from Google Play first**: Android refuses to install a
   build signed with a different key over it.
3. Copy the APK to the phone and open it (allow "install unknown apps" for the file manager), or with
   USB debugging on: `adb install build/android/app-release.apk`.

### What to check

- **Hoy:** prices match the website, the "vs. cierre" move and the month chart; pull down to refresh.
- **Histórico:** each range (1M … Máx), the gap mode, touching the chart, the day table; the official
  and gap tiles on Hoy open it.
- **Calcular:** an amount, swap direction, another currency (search "real"), tap a result to copy.
- **Alertas:** turning the switch on asks for notification permission (Android 13+); it stays on after
  closing and reopening the app. Nothing arrives until push is turned on (below).
- **Offline:** open it once online, then in airplane mode: prices stay, marked "Sin conexión".
- **Language:** the EN/ES button in the header; the app starts in the phone's language.
- **System:** back from any tab returns to Hoy, then leaves; TalkBack reads every figure; with
  "Remove animations" on, nothing moves; the largest font size cuts nothing off.

## Push alerts

The device subscribes to the Firebase Cloud Messaging topic `alertas-blue`; the sender is the jobs
Worker (`apps/jobs/src/alerts.ts`), which targets the notification channel `Dolar Blue`. Firebase does
nothing, and no push token exists, until someone turns the switch on (automatic initialisation is off
in the manifest).

**The sender is off today** (`PUSH_ENABLED` is `"false"` in `apps/jobs/wrangler.jsonc`), so the switch
subscribes but nothing arrives. To turn alerts on, give the jobs Worker a service account key as the
secret `FIREBASE_SERVICE_ACCOUNT_JSON` (`docs/MIGRATION.md`, step 0.3; that key is a secret and never
goes in the repository), then set `PUSH_ENABLED` to `"true"` and deploy the Worker.

`app/google-services.json` is a different thing: client identifiers that ship inside every copy of
the app.

## Releasing

### Version

`versionName` and `versionCode` in `app/build.gradle.kts`. Raise both for every upload; the version
shown in the app comes from `versionName`.

The version code starts at 5,000,000 because the React Native builds used one code per processor type
on Google Play, up to 4,194,312, and a new upload must be higher than every earlier one.

### Upload key

Google Play only accepts an update signed with the upload key registered for the app. The original
keystore is not in this repository. If it is lost and the app uses Play App Signing, ask for a reset
in Play Console (App integrity → App signing → Request upload key reset) with a new key:

```sh
keytool -genkeypair -v -keystore ~/bluelytics-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

If the app was never enrolled in Play App Signing and the key is lost, it cannot be updated: publish
under a new application id (change `applicationId` and `namespace` in `app/build.gradle.kts`, add
that Android app in Firebase and replace `google-services.json`).

Tell Gradle about the key in `key.properties`, next to `settings.gradle.kts` (ignored by git):

```properties
storeFile=/home/you/bluelytics-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Or set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD` in the environment (CI). Without either, the release build is signed with the
debug key: it installs on a phone for testing, and Google Play rejects it.

### Build and upload

```sh
tool/build.sh test lint        # tests, lint, then build/android/app-release.aab and app-release.apk
```

It builds in the container from `tool/Dockerfile`, uses `key.properties` as above (the keystore is
mounted read-only), keeps Gradle's caches in the Docker volume `bluelytics-gradle`, and leaves nothing
owned by root in the project. Release builds are shrunk with R8.

Upload `build/android/app-release.aab` to an internal testing track first.

### Before the first submission

- Confirm in Play Console that the app still exists: the public listing returned "not found" on
  2026-11-22 (`docs/legacy/legacy-mobile.md`).
- Google Play asks for a **privacy policy URL**: `https://bluelytics.com.ar/privacy.html`, the one
  already registered. It dates from 2020 and only names Google Play Services; consider adding Firebase
  Cloud Messaging.
- Data collected, for the Data safety form: nothing about the person. With alerts on, Firebase Cloud
  Messaging holds a push token for the device (a device identifier, used for app functionality, not
  for tracking). Firebase Analytics is disabled in the manifest.
- Screenshots: see `SCREENSHOT_SIZE` above. The 512 px listing icon is written to
  `build/art/play-icon-512.png` by `tool/make_art.py`.

## Icons and splash

Generated from the brand marks in `assets/brand/` at the repository root, straight into
`app/src/main/res` (adaptive and themed launcher icon, splash icon, notification icon, header mark):

```sh
python3 tool/make_art.py       # needs rsvg-convert (librsvg)
```
