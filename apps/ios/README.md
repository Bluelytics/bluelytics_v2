# Bluelytics for iOS

The native iPhone and iPad app, in Swift and SwiftUI, in the dark "Editorial Bold" style of
[bluelytics.com.ar](https://bluelytics.com.ar). It is a port of the Flutter app in `apps/mobile`
(same screens, strings, formats, feeds and behaviour) and keeps the store identity of the React
Native app (versions 1.x), so it ships as an update to the same App Store listing.

| Screen | What it shows |
| --- | --- |
| **Hoy** / Today | Blue dollar sell price, its move since the previous close, buy and average, a chart of the last month, the official dollar, the gap, both euros, the other dollar rates (MEP, CCL, cripto, tarjeta, mayorista) and a dollars-to-pesos table |
| **Histórico** / History | Blue and official since 2011, or the gap between them, over 1 month to the whole history; a summary of the period and every day as a table. Touch the chart to read a day |
| **Calcular** / Convert | Any of about 165 currencies to pesos and back, at the blue and official rates. Tap a result to copy it |
| **Alertas** / Alerts | The push alert switch, the last alert, and links to the site, the API and the source |

Spanish and English, following the device language, with a toggle in the header. The last data
fetched is kept on disk, so the app opens instantly and still shows prices without a connection.

## What has been built, and what has not

The app was written on Linux, where Xcode does not run.

- **Checked:** `BluelyticsCore`, the package with everything that is not a view (formats, models,
  the calculator, the chart's scales, the data store and its cache, settings, the alerts switch and
  every string), builds and passes its tests on Linux with the `swift` Docker image. Every app and
  test file passes Swift's syntax check.
- **Not yet checked:** the app target itself (SwiftUI, UIKit, Firebase), the Xcode project file and
  the app's tests have never been compiled. The first build on a Mac, or `tool/ci.sh` on a macOS CI
  runner, is their first check, and is expected to need small fixes.

## Requirements

- macOS with **Xcode 26** or later. Firebase 13 (Swift Package Manager) requires it.
- An iPhone simulator runtime (Xcode → Settings → Components) for the tests.
- For a phone or the App Store: membership of Apple team `9AGK8J3LYF`.
- Linux only for the core: Docker.

There is no CocoaPods and nothing to install: Xcode fetches Firebase the first time it opens the
project. Commit the `Package.resolved` it writes
(`Bluelytics.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`).

## Everyday commands

```sh
cd apps/ios
open Bluelytics.xcodeproj           # scheme "Bluelytics"; ⌘R runs it, ⌘U runs the tests

tool/ci.sh core                     # the core's tests (swift test)
tool/ci.sh test                     # the app's tests on the newest iPhone simulator, and every
                                    # screen in both languages as PNG files in build/screenshots/
tool/ci.sh build                    # a Release device build without signing, as a compile check
tool/ci.sh                          # all three

# The data layer against the production API, to catch a contract change the fixtures hide.
cd BluelyticsCore && LIVE=1 swift test --filter LiveAPITests
```

On Linux (no Mac needed), the core in Docker:

```sh
docker run --rm -v "$PWD/apps/ios/BluelyticsCore":/src:ro -v bluelytics-swift-build:/build -w /src \
  swift:latest swift test --scratch-path /build/core
# add  -e LIVE=1  after `run` for the live test
```

The exact commands for a CI job:

```sh
# Tests on a simulator; TEST_RUNNER_SNAPSHOT_DIR reaches the tests as SNAPSHOT_DIR.
TEST_RUNNER_SNAPSHOT_DIR="$PWD/build/screenshots" xcodebuild test \
  -project apps/ios/Bluelytics.xcodeproj -scheme Bluelytics \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO

# A device build without signing.
xcodebuild build -project apps/ios/Bluelytics.xcodeproj -scheme Bluelytics \
  -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

Without `SNAPSHOT_DIR` the screenshot test is skipped. It compares nothing, so a font or iOS update
never fails it.

## Layout

```
Bluelytics.xcodeproj     the project; the Bluelytics and BluelyticsTests folders are synchronised,
                         so a file added to them is part of the target without editing the project
BluelyticsCore/          Swift package, Foundation only (builds on Linux)
  Sources/…/Format.swift   numbers and dates, a port of apps/web/src/lib/format.ts
  Models, Calc, Series     the feeds' types, the calculator, ranges, summaries and the chart's scales
  API, Cache, Store        the feeds, the disk cache and the store the screens read
  Settings, Alerts         the language, the alerts switch and the carry-over from version 1
  Strings.swift            every string, in Spanish and English
  Tests/                   ports of the Flutter domain, data and alerts tests, with their fixtures
Bluelytics/
  App/                     entry point, app delegate, AppModel (the core objects for SwiftUI)
  Push/FirebasePush.swift  alerts over Firebase Cloud Messaging
  Theme/                   colours and type from the site
  Views/                   one file per tab, the shell, chart, ticker tape, blade and shared pieces
  Resources/               fonts, asset catalog, GoogleService-Info.plist, privacy manifest
Support/                 Info.plist and the entitlements
BluelyticsTests/         screenshot test, configuration test, fixtures
tool/ci.sh               build and test commands
```

Money is an integer number of hundredths of a peso throughout, and the app prints every number the
way the site does.

## Where the data comes from

| Feed | URL | Asked for |
| --- | --- | --- |
| Live quotes | `api.bluelytics.com.ar/v2/latest` | When the app opens or comes back, on pull to refresh, and every 60 s while on screen (at most every 30 s) |
| Last 45 days | `api.bluelytics.com.ar/v2/evolution.json?days=90` | With the live quotes |
| History since 2011 | `api.bluelytics.com.ar/v2/evolution.json` | At most every 6 hours |
| Currencies | `api.bluelytics.com.ar/data/json/currency.json` | At most every 6 hours |
| Last alert | `api.bluelytics.com.ar/v2/alerts` | With the live quotes |
| Other dollar rates | `bluelytics.com.ar/data/extras.json` | With the live quotes |

The last one is served by the website, not by the public API. Until the website is deployed with
that route the request returns 404 and the app leaves the "Otros tipos de dólar" section out.

## Testing on an iPhone

1. Open `Bluelytics.xcodeproj`, sign in to team `9AGK8J3LYF` in Xcode → Settings → Accounts.
2. Plug in the phone (Developer Mode on), pick it as the destination, ⌘R.

What to check:

- **Live prices:** they match bluelytics.com.ar; the stamp says when they were updated.
- **Refresh:** pull down on Today; leave the app and come back.
- **Chart:** drag across it to read a day; it lets go after 3 seconds.
- **Copy:** tap a calculator result; the phone taps back and the text says it was copied.
- **Offline:** open it once online, then in airplane mode: prices stay, marked "Sin conexión".
- **Language:** the EN/ES button in the header; the app starts in the phone's language.
- **Large text and VoiceOver:** Settings → Accessibility → Larger Text at the maximum: nothing is
  cut off. With VoiceOver every figure, switch and link is read.
- **iPad:** the content stays in a 620 pt column.

## Push alerts

The topic is `alertas-blue`, the same as versions 1 and the Flutter app, sent by the jobs Worker
(`apps/jobs/src/alerts.ts`). Firebase is not started, and no push token exists, until someone turns
the switch on (`FirebaseMessagingAutoInitEnabled` is off in Info.plist). Method swizzling is off too:
the app delegate hands the APNs token to Firebase. Someone updating from version 1 keeps the choice
they had. An alert that arrives while the app is open shows as a system banner and in the app.

**The sender is off today** (`PUSH_ENABLED` is `"false"` in `apps/jobs/wrangler.jsonc`). To turn
alerts on:

1. In the [Apple Developer](https://developer.apple.com/account/resources/authkeys/list) account
   create an APNs key (`.p8`) and upload it in the Firebase console: project `bluelytics-mobile` →
   Project settings → Cloud Messaging → Apple app configuration. Without it iPhones never receive
   anything.
2. Give the jobs Worker a service account key as the secret `FIREBASE_SERVICE_ACCOUNT_JSON`
   (`docs/MIGRATION.md`, step 0.3). That key is a secret: it never goes in the repository.
3. Set `PUSH_ENABLED` to `"true"` and deploy the jobs Worker.

`Bluelytics/Resources/GoogleService-Info.plist` is a different thing: client identifiers that ship
inside every copy of the app.

`Support/Bluelytics.entitlements` says `aps-environment` `development`; Xcode switches it to
production when it signs an App Store build.

## Releasing

### Version

`MARKETING_VERSION` (2.0.0) and `CURRENT_PROJECT_VERSION` (5000000) are in the project's build
settings. Raise both for every upload, and set `appVersion` in
`BluelyticsCore/Sources/BluelyticsCore/Config.swift` to the same version (a test checks it).

The build number starts at 5,000,000 to stay above every build of the earlier apps.

### Upload

The bundle id is `com.bluelytics.mobile` and signing is automatic for team `9AGK8J3LYF`.

1. Xcode: destination "Any iOS Device", Product → Archive.
2. Organizer → Distribute App → App Store Connect.
3. Try it in TestFlight before submitting.

Info.plist already declares no non-exempt encryption (`ITSAppUsesNonExemptEncryption` false), and
`PrivacyInfo.xcprivacy` declares no tracking and the one required-reason API used (UserDefaults).

### Before the first submission

- Confirm in App Store Connect that the app still exists (the public listing returned "not found"
  on 2026-11-22, `docs/legacy/legacy-mobile.md`).
- Privacy policy URL: `https://bluelytics.com.ar/privacy.html`. It dates from 2020; consider adding
  Firebase Cloud Messaging.
- Data collected, for the privacy form: nothing about the person. With alerts on, Firebase Cloud
  Messaging holds a push token for the device (a device identifier, used for app functionality, not
  for tracking).
- Screenshots: `tool/ci.sh test` on the simulator size the store asks for (an iPhone 6.9" device).

## Differences from the Flutter app

- The tab bar is the system one (with the app's glyphs and type), so it has no underline marker.
- Line heights are approximated with line spacing; the type is the same Geist and Geist Mono.
- The ticker tape pauses while dragged rather than on a touch alone.
- An alert that arrives with the app open also shows the system banner, as it does on iOS in the
  Flutter app.
