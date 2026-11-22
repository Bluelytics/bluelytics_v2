# Legacy mobile app (`bluelytics_mobile_v3`) — implementer spec

Analysis date: 2026-11-22. Source: `/home/sicarul/dev/bluelytics/bluelytics_mobile_v3` (read-only).
All `file:line` references are relative to that directory unless prefixed with another repo name.
No secret values appear in this document (Firebase API keys, keystore passwords, Apple team id and the
service-account private key are referred to by name/location only).

---

## 0. TL;DR — things that change the plan

1. **The committed app is React Native 0.69.3, not 0.74.** The "0.74" is an uncommitted, half-done bump:
   only `package.json` + `package-lock.json` are staged (RN 0.69.3 -> 0.74.3, React 18.0.0 -> 18.2.0) and
   `android/build.gradle` has an unstaged SDK 33 -> 34 change. No native project file was migrated, so the
   working tree cannot build. `HEAD` = `ca2cf88` (2023-12-19, "Update android release") is the last
   releasable state: RN 0.69.3, Android `versionCode 8` / `versionName "1.6"`, targetSdk 33.
2. **Both public store listings return "not found" today** (unauthenticated checks from an Argentine IP):
   Google Play `id=com.bluelytics.mobileapp` -> HTTP 404; App Store id `1637362540` /
   bundle `com.bluelytics.mobile` -> iTunes Lookup `resultCount: 0` (storefronts default/AR/AM/US) and
   `apps.apple.com/ar/app/bluelytics/id1637362540` -> 404. Control lookups of another app returned 200 / 1 result.
   The premise "the app is in the stores and working" must be confirmed in Play Console / App Store Connect.
   Installed copies keep working regardless, so the API and push contracts below still matter.
3. **The push pipeline is alive.** `GET https://api.bluelytics.com.ar/v2/alerts` returned `alert_id: 1885`,
   `alert_at: 2026-11-20T20:00:54Z`. Installed apps subscribed to FCM topic `alertas-blue` are still being
   notified by `bluescraper/src/alerts.py`. The rewrite must keep sending the same message (section 2.5).
4. **The app never creates the Android notification channel the sender targets.** The sender sets
   `channel_id='Dolar Blue'`; no revision of this repo creates that channel, so Android 8+ devices show
   alerts in FCM's fallback channel `fcm_fallback_notification_channel` ("Miscellaneous").
5. **The app consumes exactly two endpoints and seven fields** (section 1.5). Returning `null`, a string
   number, or dropping `oficial` crashes the installed app on launch.
6. **The Android release keystore is not in the repo and not on this machine** under the project tree or
   `~/.gradle/gradle.properties` (file absent). Without it (or a Play upload-key reset) no Android update can ship.
7. **Any store update is a re-platforming, not a bump**: Play requires targetSdk 36 for updates since
   2026-08-31 and 16 KB page support; Apple requires a current Xcode/SDK and privacy manifests. RN 0.69
   meets none of these. Current RN is 0.88.x (0.89 RC).

---

## 1. App features, screen by screen

Total app code: 794 lines of JavaScript (Flow-annotated header in `App.js`, otherwise plain JS, no TypeScript):
`index.js` (14), `App.js` (32), `navigator/BottomNavigator.js` (56), `navigator/TabBarIcon.js` (13),
`screens/ValueScreen.js` (188), `screens/CalculatorScreen.js` (346), `screens/SettingsScreen.js` (145).

UI language: Spanish (Argentina), written without accents. Light theme only, white backgrounds. Portrait only on iOS
(`ios/bluelytics_mobile_v3/Info.plist:74-78`). Brand colors: blue `#221199` (Dólar Blue), green `#229922` (Oficial),
tab active `#2f95dc`, tab inactive `#cccccc`.

### 1.1 Entry + navigator

- `index.js:5-14` — imports `@react-native-firebase/messaging`, registers a **no-op** background handler
  (`messaging().setBackgroundMessageHandler(async remoteMessage => {});`, lines 11-12) and registers the root
  component under the name from `app.json` (`"name": "Bluelytics"`). That name is hard-wired in native code:
  `android/.../MainActivity.java:15` (`return "Bluelytics";`) and `ios/bluelytics_mobile_v3/AppDelegate.mm:49`
  (`RCTAppSetupDefaultRootView(bridge, @"Bluelytics", initProps)`). Do not rename `app.json.name`.
- `App.js:19-30` — `<StatusBar />` + `<NavigationContainer>` wrapping `BottomNavigator`. `createStackNavigator`
  is imported and instantiated (`App.js:13,17`) but never used.
- `navigator/BottomNavigator.js:16-41` — `createBottomTabNavigator()` (React Navigation 6), `initialRouteName="Value"`,
  default header shown. Three tabs:

| Route name | Component | `title` (header + tab label) | FontAwesome icon |
|---|---|---|---|
| `Value` | `ValueScreen` | `Cotizacion Dolar-ARS` | `dollar` |
| `Calculator` | `CalculatorScreen` | `Calculadora Blue` | `calculator` |
| `Settings` | `SettingsScreen` | `Alertas` | `warning` |

- `navigator/TabBarIcon.js:4-12` — `react-native-vector-icons/dist/FontAwesome`, size 23, `marginBottom: -3`.
- `getHeaderTitle` (`BottomNavigator.js:45-56`) is dead code.
- Tabs are lazy (React Navigation default): `CalculatorScreen` and `SettingsScreen` mount on first visit and
  never unmount.

### 1.2 ValueScreen ("Cotizacion Dolar-ARS") — `screens/ValueScreen.js`

Layout: logo `assets/images/icon.png` (192x192 butterfly mark, height `RFPercentage(10)`), then two blocks:

- "Dolar Blue/Libre" in `#221199` with `Compra` / `Venta` (`ValueScreen.js:85-92`)
- "Dolar Oficial" in `#229922` with `Compra` / `Venta` (`ValueScreen.js:94-101`)

Values are rendered as `valueBuy.toFixed(2)` / `valueSell.toFixed(2)` (`ValueScreen.js:132,140`) — e.g. `1635.00`,
no thousands separator, no currency symbol, no "last update" timestamp.

Data loading (`ValueScreen.js:36-68`):

```js
const [dolar, setDolar] = useState({});
const [loading, setLoading] = useState(true);
useEffect(() => {
      fetch('https://api.bluelytics.com.ar/v2/latest')
      .then(response => response.json())
      .then(json => setDolar(json))
      .catch(error => console.error(error))
      .finally(() => { setLoading(false); });
}, [loading]);
const onRefresh = React.useCallback(() => { setLoading(true); });
```

Refresh triggers:

1. Mount.
2. Pull-to-refresh (`RefreshControl refreshing={loading} onRefresh={onRefresh}`, line 75).
3. App returns to foreground: `AppState` `"change"` listener calls `onRefresh()` when `nextAppState === "active"`
   (lines 55-68).

There is no polling timer.

**Every trigger issues two requests.** The effect depends on `[loading]`, so it runs when `loading` goes
`false -> true` *and again* when the `finally` sets it `true -> false`. Mount = 2 GETs, each refresh = 2 GETs,
each foreground = 2 GETs.

Error handling: only `console.error`. On failure the previous values stay on screen (blank on first load).
No retry, no offline message, no error boundary.

Rendering guards (`ValueScreen.js:84-101`): a block renders only if `'blue' in dolar` / `'oficial' in dolar`.
Inside a block, `data.valor.value_buy` and `data.valor.value_sell` are used unguarded.

History: until commit `4773db3` (2023-12-19, "Remove tax calculation") the Oficial "Venta" showed
`(valueSell * 1.75).toFixed(2)` with caption `(+75% impuestos)`. Builds made before that commit still do this
(see open question on iOS build 3).

Deprecated API: `AppState.removeEventListener` (`ValueScreen.js:59`) exists in RN 0.69 but is gone in 0.74
(verified against the public RN sources); it only runs on unmount, which never happens for this tab.

### 1.3 CalculatorScreen ("Calculadora Blue") — `screens/CalculatorScreen.js`

Layout top to bottom: help text `Debajo podes elegir desde o a que moneda queres convertir pesos argentinos.`;
a currency `Picker` (`prompt="Elegi la moneda a convertir"`); a numeric `TextInput` (initial `'1000'`) followed by the
unit label (`ARS`, or the selected code when inverted); an `Invertir` button (FontAwesome `arrows-v`, `#221199`);
two result blocks "Blue/Libre" (`#221199`) and "Oficial" (`#229922`), each with `Compra <unit>` / `Venta <unit>`.

Data loading (`CalculatorScreen.js:44-60`):

```js
fetch('https://api.bluelytics.com.ar/data/json/currency.json')
  .then(response => response.json())
  .then(json => json.concat([usdVal]))            // usdVal = {code:'USD', name:'USA Dollar', value:1}
  .then(json => json.sort((a, b) => a.name > b.name))
  .then(json => setCurrencyData(json))             // builds currencyMap[code] = value
  .then(() => {
    fetch('https://api.bluelytics.com.ar/v2/latest')
      .then(response => response.json())
      .then(json => setDolar(json))
      .catch(error => console.error(error))
      .finally(() => { setLoading(false); });
  });
```

- Runs on first mount only, and (same `[loading]` bug) **twice**: 2x `currency.json` + 2x `/v2/latest`.
- Nothing ever sets `loading` back to `true`: calculator rates are **never refreshed** for the life of the process.
- The outer chain has **no `.catch`**: if `currency.json` fails or is not an array, `/v2/latest` is never
  requested and the results stay at the placeholder forever.

Conversion formulas (`CalculatorScreen.js:79-91`), `currencyMap[code]` = units of that currency per 1 USD:

```js
// not inverted: input is ARS, output is the selected currency
toCurrency   = (valorIn, dolarValue, currCode) => ((parseFloat(valorIn) / dolarValue) * currencyMap[currCode]).toFixed(2);
// inverted: input is the selected currency, output is ARS
fromCurrency = (valorIn, dolarValue, currCode) => ((parseFloat(valorIn) / currencyMap[currCode]) * dolarValue).toFixed(2);
```

Four outputs, each computed with the matching rate (`CalculatorScreen.js:93-135`):
`blueSell <- dolar.blue.value_sell`, `blueBuy <- dolar.blue.value_buy`,
`oficialSell <- dolar.oficial.value_sell`, `oficialBuy <- dolar.oficial.value_buy`.

Guard (`CalculatorScreen.js:70-77`): outputs fall back to `'-'` when the input is empty or NaN, `'blue'` is not in
`dolar`, `dolar.blue.value_sell` is NaN, or `currencyMap[selectedValue]` is NaN. `dolar.oficial` is **not** guarded.

Display (`CalculatorScreen.js:276,284`): `parseFloat(value).toLocaleString('en-US')` — e.g. `1,234.56`; the
placeholder `'-'` therefore renders as `NaN`. This is why Android uses the intl JSC flavor
(`android/app/build.gradle:114`, `org.webkit:android-jsc-intl:+`).

`Invertir` (`CalculatorScreen.js:150-157`): new input = `((parseFloat(blueBuy) + parseFloat(blueSell)) / 2).toFixed(2)`,
then toggles `inverted`.

Input validation (`CalculatorScreen.js:144-148`): accepts the keystroke only if `!isNaN(newValue)`, stores `trim()`ed.

Analytics (`CalculatorScreen.js:62-67`): `analytics().logSelectContent({content_type: 'selected_currency', item_id: selectedValue})`
on mount (`USD`) and on every picker change.

Quirks an implementer must know (all present in the shipped app):

- The live `currency.json` already contains `USD` (`"Dólar estadounidense"`, `1.00`); the app appends a second
  `USD` (`"USA Dollar"`), producing two picker items with the same `key`/`value`.
- `sort((a, b) => a.name > b.name)` returns a boolean, not a number, so it is not a valid comparator: the list
  order is essentially **the order the API returns**. Keep the server order stable and sensible.
- The API rounds `value` to 2 decimals (`bluelytics_api/v2.go:17-19`, `fmt.Sprintf("%.2f", n)`), so `BTC`, `XAU`,
  `XPD`, `XPT` are served as `0.00`; inverted conversion divides by zero and shows `∞`.
- History: until `4773db3` the Oficial sell rate was multiplied by `1.75` here too.

### 1.4 SettingsScreen ("Alertas") — `screens/SettingsScreen.js`

One row: label `Activar Alertas Dolar Blue` + `Switch` (track `#767577`/`#81b0ff`, thumb `#221199`/`#f4f3f4`), then the
text `Mientras tengas activadas las alertas, recibiras notificaciones en el celular cada vez que haya un cambio
significativo en el valor de venta del Dolar Blue.` No network calls to the Bluelytics API.

State: AsyncStorage key **`subState`** holding the strings `'true'` / `'false'` (`SettingsScreen.js:62-78`).
On mount the screen shows `...` until the key is read; missing key = off.

Toggle (`SettingsScreen.js:44-60`):

```js
if (newState == true) {
  messaging().subscribeToTopic('alertas-blue')
    .then(() => _storeSub('true'))
    .then(() => analytics().logEvent('subscribe_alertas_blue', {}));
  requestUserPermission()            // messaging().requestPermission()
} else if (newState == false) {
  messaging().unsubscribeFromTopic('alertas-blue')
    .then(() => _storeSub('false'))
    .then(() => analytics().logEvent('unsubscribe_alertas_blue', {}));
}
```

The switch state is set optimistically before the promise settles; rejections are unhandled, so a failed
subscribe leaves the switch on for the session and off after restart. Subscription state lives only on the
device and in FCM; **the backend has no device registry and no token endpoint**.

### 1.5 API contract consumed by the app (must never break)

Base host is hard-coded: `https://api.bluelytics.com.ar`. Builds made before commit `b551c5b` (2022-07-31,
"Switch to https") — Android `versionName` 1.1 to 1.4 — call **`http://api.bluelytics.com.ar`**. Today plain HTTP
answers `301 -> https://...` for both paths, which OkHttp follows; keep port 80 redirecting.

| Request | Called from | Fields read |
|---|---|---|
| `GET /v2/latest` | `ValueScreen.js:42`, `CalculatorScreen.js:51` | `blue.value_buy`, `blue.value_sell`, `oficial.value_buy`, `oficial.value_sell` |
| `GET /data/json/currency.json` | `CalculatorScreen.js:45` | array items `code`, `name`, `value` |

Requests are bare GETs: no query string, no custom headers, no auth, default user agents (`okhttp/x.y.z` on Android,
`<product>/<build> CFNetwork/... Darwin/...` on iOS). No revision of the app ever read `value_avg`, `oficial_euro`,
`blue_euro`, `last_update`, or called `/v2/alerts`, `/v2/evolution.*`, `/v2/historical`, `/json/last_price`.

Live shapes observed 2026-11-22:

```json
{"oficial":{"value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},
 "blue":{"value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00},
 "oficial_euro":{"value_avg":1712.00,"value_sell":1741.00,"value_buy":1683.00},
 "blue_euro":{"value_avg":1796.00,"value_sell":1815.00,"value_buy":1777.00},
 "last_update":"2026-11-20T19:45:51.758024-03:00"}
```

```json
[{"code":"PAB","name":"Balboa","value":1.00},{"code":"BTC","name":"Bitcoin","value":0.00}, ... 169 items]
```

Response headers today: `/v2/latest` -> `content-type: application/json; charset=UTF-8`,
`access-control-allow-origin: *`, `vary: Origin`, no `cache-control`, `cf-cache-status: DYNAMIC`.
`/data/json/currency.json` -> same plus `cache-control: max-age=7200`, `cf-cache-status: HIT`.

Hard rules derived from the client code:

| Rule | Why (what the installed app does otherwise) |
|---|---|
| `/v2/latest` body must be a JSON **object** | `'blue' in null` / `'blue' in "str"` throws in render -> fatal JS error in a release build, on the initial tab, i.e. a crash on every launch |
| If `blue` is present, `blue.value_buy` and `blue.value_sell` must be non-null JSON **numbers** | `.toFixed(2)` on `null`/`undefined`/string throws (`ValueScreen.js:132,140`) |
| Same for `oficial.value_buy` / `oficial.value_sell` | same |
| `blue` and `oficial` must be present **together** | Calculator checks only `'blue' in dolar` then reads `dolar.oficial.value_sell` (`CalculatorScreen.js:105-113`) |
| `currency.json` must be a JSON **array** of `{code: string, name: string, value: number}` | `.concat`, `.sort`, `.forEach` on it; `name` is the picker label, `value` goes through `isNaN` and arithmetic |
| `value` = units of that currency per 1 USD | conversion formulas in 1.3 |
| Keep array order stable (currently roughly alphabetical by Spanish name) | client-side sort is a no-op in practice |
| Keep both paths on `api.bluelytics.com.ar`, HTTPS with TLS 1.2 allowed, HTTP redirecting | hard-coded URLs; `minSdkVersion 21` devices need TLS 1.2 |
| Do not put bot challenges / UA filtering on the API host | clients are `okhttp` and `CFNetwork`, not browsers |

Safe failure modes for the API: a non-JSON body (the `.catch` swallows the parse error) or a JSON object without
`blue`/`oficial`. Unsafe: JSON `null`, a bare string/number, `null` rate values.

Caching notes for the rewrite:

- The app adds no cache-busting, so both endpoints can be served from the edge or as static objects.
- **Both platforms honor `Cache-Control` on the device.** iOS uses `NSURLSession`'s shared cache; Android RN 0.69.3
  builds its OkHttp client with a 10 MB disk cache (`OkHttpClientProvider.createClientBuilder`, cache dir
  `http-cache`, verified in the public RN source). A long client `max-age` on `/v2/latest` would make
  pull-to-refresh and foreground refresh return stale rates inside the app. Keep the browser/client `max-age`
  short (<= 60 s, or none as today) and do long caching with `s-maxage` / CDN-only headers.
  `currency.json` is already cached on devices for 2 h (`max-age=7200`).
- Traffic shape per user: 2 GETs of `/v2/latest` on cold start and on every foreground; first visit to the
  calculator adds 2x `currency.json` + 2x `/v2/latest`.

---

## 2. Push notifications

### 2.1 Client side summary

| Item | Value | Where |
|---|---|---|
| Library | `@react-native-firebase/messaging` 15.2.0 (Android Firebase BoM 30.3.0 -> `firebase-messaging` 23.0.6; iOS Firebase 9.3.0) | `package.json:17`, `ios/Podfile.lock:13,70,501` |
| FCM topic | **`alertas-blue`** (only one; unchanged since commit `a22853e`, 2020-10-10) | `screens/SettingsScreen.js:49,56` |
| Topic opt-in | user toggle; default off | `screens/SettingsScreen.js:44-60` |
| Background handler | registered, empty | `index.js:11-12` |
| Foreground handler (`onMessage`) | none | — |
| Tap handling (`getInitialNotification`, `onNotificationOpenedApp`) | none | — |
| Token retrieval / upload | none | — |
| Android notification channel creation | **none, anywhere** | see 2.2 |
| `firebase.json` (RNFB config) | absent | — |
| `react-native-push-notification` 8.1.1 | in `package.json` (line 27 at `HEAD`, 28 in the working tree), never imported, no manifest entries, no iOS pod: inert | — |

### 2.2 Android notification channels

Searched `index.js`, all JS, `AndroidManifest.xml`, both `Main*.java` files and the full git history for
`createChannel`, `channelId`, `default_notification_channel`, `PushNotification`: **no channel is ever created and
no default channel id is declared.**

- `android/app/src/main/AndroidManifest.xml` contains only the `INTERNET` permission and `MainActivity`. No
  `<service>`, `<receiver>` or `<meta-data>`; everything messaging-related comes from manifest merging of the
  RNFB and Firebase libraries.
- RNFB's manifest sets `com.google.firebase.messaging.default_notification_channel_id` to
  `${firebaseJsonNotificationChannelId}`, which is empty because there is no `firebase.json`.
- The sender targets `channel_id='Dolar Blue'` (`bluescraper/src/alerts.py:113`). The FCM Android SDK
  (`CommonNotificationBuilder.getOrCreateChannel`) checks the message channel, logs
  `Notification Channel requested (Dolar Blue) has not been created by the app. Manifest configuration, or default, value will be used.`,
  finds no usable manifest default, and creates/uses **`fcm_fallback_notification_channel`** (label from the
  SDK's `fcm_fallback_notification_channel_label` resource, "Miscellaneous"), importance `IMPORTANCE_DEFAULT`
  (sound, no heads-up).

Consequence: on installed Android apps the alerts appear under "Miscellaneous". Sending or omitting
`channel_id` produces identical behavior today; keep sending `Dolar Blue` so a future app release can create
that exact id (case- and space-sensitive) and take over routing with no backend change.

Also not configured: `default_notification_icon` (FCM falls back to the launcher icon as small icon). RNFB 15.2.0
sets `default_notification_color` to `@color/white` when `firebase.json` is absent, so the per-message
`color: '#221199'` from the sender is what gives the notification its blue accent — keep sending it.

### 2.3 Permission flow

- **iOS**: on toggle-on, `messaging().requestPermission()` (`SettingsScreen.js:18-27`) shows the system prompt once
  (default options alert/badge/sound). It is called after `subscribeToTopic`, not awaited, and a denial is not
  surfaced: the switch stays on and nothing arrives. Device registration with APNs is RNFB's automatic default.
  `Info.plist:63-67` declares `UIBackgroundModes` `fetch` + `remote-notification`. Both entitlements files contain
  `aps-environment = development` (`bluelytics_mobile_v3Debug.entitlements:5-6`, `...Release.entitlements:5-6`);
  distribution signing substitutes the production value.
- **Android 12 and below**: no runtime permission.
- **Android 13+**: `POST_NOTIFICATIONS` is declared only via the merged `firebase-messaging` 23.0.6 manifest and is
  **never requested at runtime** — RNFB 15.2.0's `requestPermission()` is `if (isAndroid) return Promise.resolve(1);`.
  For the targetSdk 33 build (`versionCode 8`) a fresh install on Android 13+ has notifications blocked until the
  user enables them in system settings. This is an existing bug, independent of the backend.

### 2.4 What the device does with a message

| App state | Android | iOS |
|---|---|---|
| Background / killed | FCM SDK posts a system notification built from the `notification` block: title, body, accent `#221199`, fallback channel | APNs alert with title/body, no sound (sender sets none) |
| Foreground | delivered to JS, no `onMessage` listener -> **nothing shown** | not presented (no foreground presentation options configured) |
| Tap | launches `MainActivity` (launcher intent) | opens the app |

The app reads **nothing** from the message: no `data` keys, no deep link, no click action. It depends entirely
on the OS/FCM SDK rendering a `notification` payload. A data-only message would display nothing.

### 2.5 The sender today — `bluescraper/src/alerts.py`

Runs once per scrape cycle (`bluescraper/src/entrypoint.sh:16`, after the scrapers and `refresh_dolar.py`).
Credentials: `credentials.Certificate("/bluelytics-mobile-firebase-adminsdk.json")` (`alerts.py:97`), a
service-account key for project `bluelytics-mobile` copied into the image (`bluescraper/Dockerfile:18`). The file
`bluescraper/bluelytics-mobile-firebase-adminsdk.json` is git-ignored there and **contains a private key — never
copy it into the monorepo**; store it as a deploy secret. `firebase-admin` is unpinned (`Dockerfile:10`) and uses
the FCM HTTP v1 API.

Trigger logic (`alerts.py:10-76`):

- `value_min` / `value_max` = min/max over per-minute averages of `value_sell` from `dolar_values` where
  `scraped_at` is between `now() - 6 hours` and `now() - 15 minutes` and `source <> 'oficial'`.
- current = `value_buy`, `value_sell` from `dolar_latest where tipo = 'blue'`.
- last alert = newest row of `alertas_dolar` (`value_sell`, `alert_at`).
- Send when all hold:
  1. `(now - alerta_at_last).seconds > 10*60` (`alerts.py:67`)
  2. `value_current_sell > value_max or value_current_sell < value_min` (`alerts.py:68`)
  3. `abs((value_current_sell / value_last_alert - 1.0) * 100) > 0.5` (`alerts.py:69-70`)
- After sending: `insert into alertas_dolar values(DEFAULT, CURRENT_TIMESTAMP, value_current_buy, value_current_sell)`.

Bugs to fix, not copy: `.seconds` is the seconds *component* of the timedelta (0-86399), not total seconds;
`datetime.datetime.now()` is naive and compared with a DB `timestamp`; an empty `alertas_dolar` table raises
(`now - None`). Table DDL: `bluelytics_database/schema/notifications.sql:2-7`.

Message text (`alerts.py:82-95`), `value_prev` = sell value stored with the previous alert:

```python
title = 'Subió el Dólar Blue' if value_current > value_prev else 'Bajó el Dólar Blue'
body = 'Venta: {:.2f} ({}{:.2f} / {}{:.2f}%)'.format(
    value_current,
    '+' if value_current > value_prev else '', value_current - value_prev,
    '+' if value_current > value_prev else '', (float(value_current / value_prev) - 1.0)*100)
```

Examples: `Subió el Dólar Blue` / `Venta: 1670.00 (+12.00 / +0.72%)`;
`Bajó el Dólar Blue` / `Venta: 1630.00 (-20.00 / -1.21%)` (the minus comes from the number itself).

Message object (`alerts.py:100-117`):

```python
messaging.Message(
    notification = messaging.Notification(title = title, body = body),
    android = messaging.AndroidConfig(
        collapse_key='dolar-blue', priority='high', ttl=1200,
        notification=messaging.AndroidNotification(
            title = title, body = body, color='#221199', channel_id='Dolar Blue')),
    topic = 'alertas-blue')
```

### 2.6 EXACT message the new backend must send

`POST https://fcm.googleapis.com/v1/projects/bluelytics-mobile/messages:send`
with `Authorization: Bearer <OAuth2 access token>` (service account of project `bluelytics-mobile`, scope
`https://www.googleapis.com/auth/firebase.messaging`) and body:

```json
{
  "message": {
    "topic": "alertas-blue",
    "notification": {
      "title": "Subió el Dólar Blue",
      "body": "Venta: 1670.00 (+12.00 / +0.72%)"
    },
    "android": {
      "collapse_key": "dolar-blue",
      "priority": "high",
      "ttl": "1200s",
      "notification": {
        "title": "Subió el Dólar Blue",
        "body": "Venta: 1670.00 (+12.00 / +0.72%)",
        "color": "#221199",
        "channel_id": "Dolar Blue"
      }
    }
  }
}
```

Non-negotiable for installed apps:

1. Same Firebase project: id `bluelytics-mobile`, sender id / project number `741788018211`. Topics are
   per-project; another project reaches nobody.
2. Topic string exactly `alertas-blue`.
3. A top-level `notification` with `title` and `body` (display message). Not data-only.
4. No `android.notification.click_action`, no `condition`, no `restricted_package_name` other than
   `com.bluelytics.mobileapp`. A `data` map is allowed and ignored.
5. FCM HTTP v1 only (the legacy HTTP API is shut down).

Parity fields, harmless to keep: `collapse_key` `dolar-blue`, `priority` `high`, `ttl` 1200 s, `color` `#221199`,
`channel_id` `Dolar Blue`.

JS equivalent of the text formatting:

```js
const up = current > prev;
const sign = up ? '+' : '';
const title = up ? 'Subió el Dólar Blue' : 'Bajó el Dólar Blue';
const body = `Venta: ${current.toFixed(2)} (${sign}${(current - prev).toFixed(2)} / ${sign}${((current / prev - 1) * 100).toFixed(2)}%)`;
```

No SDK is required on a serverless/edge runtime: sign an RS256 JWT with the service-account key, exchange it at
`https://oauth2.googleapis.com/token`, cache the token (1 h), POST the JSON above.

Optional, additive, not sent today (decide separately; they change iOS UX but cannot break the app):
`apns.payload.aps.sound = "default"`, `apns.headers["apns-collapse-id"] = "dolar-blue"`,
`apns.headers["apns-expiration"] = <now + 1200>`. Today iOS gets a silent alert with APNs default expiry, so an
iPhone that was offline can receive a stale alert later.

---

## 3. Identifiers

| Item | Value | Source |
|---|---|---|
| Android `applicationId` / Java package | `com.bluelytics.mobileapp` | `android/app/build.gradle:140`, `android/app/src/main/AndroidManifest.xml:3` |
| Android `versionCode` / `versionName` | `8` / `"1.6"` | `android/app/build.gradle:143-144` |
| Android per-ABI APK version codes | `abi * 1048576 + versionCode`, abi map `armeabi-v7a:1, x86:2, arm64-v8a:3, x86_64:4` -> 1048584, 2097160, 3145736, 4194312 | `android/app/build.gradle:263-267` |
| Android SDK levels at `HEAD` | min 21, compile 33, target 33 (working tree: 34/34, unstaged) | `android/build.gradle:5-8` |
| iOS bundle id | `com.bluelytics.mobile` (differs from Android) | `ios/bluelytics_mobile_v3.xcodeproj/project.pbxproj:718,747`, `ios/GoogleService-Info.plist` `BUNDLE_ID` |
| iOS marketing version / build | `1.0` (hard-coded) / `3` | `ios/bluelytics_mobile_v3/Info.plist:20`, `project.pbxproj:700,734` |
| iOS deployment target | 12.4 | `ios/Podfile:6`, `project.pbxproj:708,737` |
| iOS Xcode target / product name | `bluelytics_mobile_v3` | `project.pbxproj:719,748` |
| App Store id (from the website link) | `1637362540` | `bluelytics_frontend/app/index.html:165` |
| Display name | `Bluelytics` | `app.json`, `android/.../res/values/strings.xml:2`, `Info.plist:8` |
| JS package name / version | `Bluelytics` / `1.2.0` (stale, unrelated to store versions) | `package.json:2-3` |
| Firebase project id | **`bluelytics-mobile`** | both Firebase config files |
| Firebase project number / GCM sender id | `741788018211` | same |
| Firebase Android app id | `1:741788018211:android:6ebd2fc0042a1dd5a67396` | `android/app/google-services.json` |
| Firebase iOS app id | `1:741788018211:ios:fc1640d88cd23699a67396` | `ios/GoogleService-Info.plist` |
| Firebase storage bucket / RTDB URL | `bluelytics-mobile.appspot.com` / `https://bluelytics-mobile.firebaseio.com` | same |

Version history (Android, from git): 1.1/3 (2020-05), 1.2/4 (2020-10-10), 1.3/5 (2020-10-18), 1.4/6 (2022-07-30),
1.5/7 (2022-07-31), 1.6/8 (2023-12-19). iOS build numbers: 1, 2, 3 (2022-08-01); no iOS project change after
2022-08-02.

Firebase client config files — **both are tracked in git**:

- `android/app/google-services.json` — project info, one Android client, one API key entry, two OAuth client entries.
- `ios/GoogleService-Info.plist` — keys `API_KEY`, `CLIENT_ID`, `REVERSED_CLIENT_ID`, `ANDROID_CLIENT_ID`,
  `GCM_SENDER_ID`, `BUNDLE_ID`, `PROJECT_ID`, `STORAGE_BUCKET`, `GOOGLE_APP_ID`, `DATABASE_URL`, feature flags.

These are client identifiers shipped inside every app binary, not server secrets, but they do include API keys.

Signing:

- Android debug: `android/app/debug.keystore` (tracked, 2,257 bytes, the stock RN template debug keystore),
  referenced at `android/app/build.gradle:221-226`.
- Android release: `android/app/build.gradle:227-232` reads four Gradle properties —
  **`BLUELYTICS_UPLOAD_STORE_FILE`, `BLUELYTICS_UPLOAD_STORE_PASSWORD`, `BLUELYTICS_UPLOAD_KEY_ALIAS`,
  `BLUELYTICS_UPLOAD_KEY_PASSWORD`**. They are defined nowhere in the repo (`android/gradle.properties` has none,
  in no revision), `~/.gradle/gradle.properties` does not exist on this machine, and the only keystore file under
  `/home/sicarul/dev/bluelytics` is the debug one. Because the properties are dereferenced unconditionally, even a
  debug Gradle configuration fails without them.
- iOS: automatic signing (`CODE_SIGN_STYLE = Automatic`, `project.pbxproj:699`), `DEVELOPMENT_TEAM` present at
  `project.pbxproj:701,735` (value not reproduced here), entitlements files per configuration. No provisioning
  profiles, `.p12` or `.p8` files in the repo. The APNs key/certificate lives in the Firebase console.

---

## 4. Build / release setup

There is **no** fastlane, no CI config, no README, no release script. `Gemfile` only pins CocoaPods:
`ruby '2.7.5'`, `gem 'cocoapods', '~> 1.11', '>= 1.11.2'` (`Gemfile:3-4`; `Gemfile.lock` resolves CocoaPods 1.11.3,
Bundler 2.2.27, and records Ruby 2.7.4p191). `package.json:5-11` scripts: `android`, `ios`, `start`, `test`, `lint`.
The release procedure is manual and inferred: `cd android && ./gradlew bundleRelease` (an ignored
`android/app/build/outputs/bundle/release/app-release.aab`, 44 MB, exists) and Xcode Archive for iOS.

### 4.1 Toolchain at `HEAD` (the state that last shipped)

| Component | Version | Source |
|---|---|---|
| React Native / React | 0.69.3 / 18.0.0 | `git show HEAD:package.json` |
| JS engine | JSC on both platforms; Hermes off | `android/app/build.gradle:82`, `ios/Podfile:25` |
| New Architecture | off | `android/gradle.properties:38` |
| Gradle wrapper | 7.3.3 | `android/gradle/wrapper/gradle-wrapper.properties:3` |
| Android Gradle Plugin | 7.2.0 | `android/build.gradle:23` |
| google-services plugin | 4.3.13 | `android/build.gradle:26` |
| NDK | 21.4.7075529 (24.0.8215888 on aarch64 hosts) | `android/build.gradle:9-15` |
| Flipper | 0.125.0 (debug) | `android/gradle.properties:28`, `ios/Podfile:27,41` |
| Release build | ProGuard on, per-ABI APK splits on, no universal APK, multidex | `android/app/build.gradle:96,101,146,212-219` |
| Jetifier | enabled | `android/gradle.properties:25` |
| CocoaPods / iOS Firebase | 1.11.3 / 9.3.0 static frameworks, analytics without IDFA | `ios/Podfile.lock`, `ios/Podfile:3-4` |
| Lockfile | npm `package-lock.json`, lockfileVersion 1 | — |
| Required JDK / Node (era-appropriate) | JDK 11; Node 14-16, npm 6-8 | AGP 7.2 / RN 0.69 requirements |

Key dependency versions (resolved, identical in both lockfiles apart from RN/React):
`@react-native-firebase/{app,messaging,analytics}` 15.2.0, `@react-navigation/native` 6.0.11, `bottom-tabs` 6.3.2,
`stack` 6.2.2, `react-native-reanimated` 2.9.1, `react-native-gesture-handler` 2.5.0, `react-native-screens` 3.15.0,
`react-native-safe-area-context` 4.3.1, `react-native-vector-icons` 9.2.0, `@react-native-picker/picker` 1.16.8,
`@react-native-async-storage/async-storage` 1.17.7, `react-native-responsive-fontsize` 0.4.3.

Declared but unused in JS: `react-native-push-notification`, `@react-native-community/toolbar-android`,
`react-native-tab-view`, `react-number-format`, `@react-navigation/stack` (imported, unused),
`@react-native-masked-view/masked-view`, `typescript`.

### 4.2 The uncommitted working tree (do not import)

| `git status` | File | Change | Secret? |
|---|---|---|---|
| ` M` (unstaged) | `android/build.gradle` | `buildToolsVersion` 33.0.0 -> 34.0.0, `compileSdkVersion` 33 -> 34, `targetSdkVersion` 33 -> 34 | no |
| `M ` (staged) | `package.json` | `react` 18.0.0 -> 18.2.0, `react-native` 0.69.3 -> 0.74.3, adds `@types/react` 18.3.3 | no |
| `M ` (staged) | `package-lock.json` | regenerated for the above (+7,844 / -3,985 lines) | no |

None are keystores or secrets; there are no untracked non-ignored files. This state cannot build because the
native projects are still the 0.69 template:

- `android/settings.gradle:6` `includeBuild('../node_modules/react-native-gradle-plugin')` — package no longer exists (now `@react-native/gradle-plugin`).
- `android/app/build.gradle:86` `apply from: "../../node_modules/react-native/react.gradle"` — file removed in RN 0.71+.
- `android/build.gradle:38,42` local Maven repos inside `node_modules/react-native/android` and `jsc-android/dist` — gone.
- RN 0.74 needs Gradle 8.6, AGP 8.x, Kotlin 1.9.22, JDK 17, NDK 26.1, minSdk 23, Node >= 18 (verified against the 0.74.3 template); the repo has Gradle 7.3.3 / AGP 7.2.0 / minSdk 21.
- `MainApplication.java`, `MainApplicationReactNativeHost.java`, `jni/*` and `AppDelegate.mm` use 0.69-only APIs.
- `ios/Podfile:14,27,41,58` use `get_default_flags()`, `FlipperConfiguration`, `use_flipper!()`, `__apply_Xcode_12_5_M1_post_install_workaround` — removed.
- `babel.config.js` still uses `metro-react-native-babel-preset` 0.70.3; `ios/Podfile.lock` is still 0.69.3.

### 4.3 Known breakages with 2026 toolchains (for the `HEAD` 0.69.3 state)

Checked today (repo contents, public sources, this machine):

- **Google Play** (policy page fetched today): since 2026-08-31 new apps and updates must target API 36;
  existing apps must target API 35+ to stay available to new users on newer Android versions. `HEAD` targets 33,
  the working tree 34.
- This machine has OpenJDK 27, Node 20.20.2, npm 12.2.3, pnpm 12.22.0 and no Ruby. Per the published
  compatibility matrices Gradle 7.3.3 runs on JDK 17 at most and AGP 7.2 expects JDK 11, so the legacy Android
  build needs an older JDK installed side by side. Nothing was built during this analysis.
- `android/settings.gradle:2-3` includes a project `:react-native-firebase` at
  `../node_modules/react-native-firebase/android`; that package is not a dependency (leftover from RNFB v5).
  Gradle 7 only warns about a missing project directory; Gradle 8 is documented to reject it.
- `project.pbxproj:408` hard-codes `export NODE_BINARY=/opt/homebrew/bin/node` in the bundling phase (Apple-silicon Homebrew only).
- Icon fonts and build scripts are referenced through `../node_modules/...` relative paths in
  `android/settings.gradle:3,4,6`, `android/build.gradle:38,42`, `android/app/build.gradle:86,156-158,333`,
  `ios/Podfile:1-2` and the Xcode project (fonts, `react-native-xcode.sh`). `node_modules` must sit inside the app directory.
- `ValueScreen.js:59` uses `AppState.removeEventListener`, absent from RN 0.74+.

Expected from general knowledge of this RN generation (not re-tested here; treat as likely):

- Play's 16 KB page-size requirement for updates targeting Android 15+: RN 0.69 native libraries are 4 KB aligned.
- `pod install` fails on the boost 1.76.0 podspec (its download host was retired); Flipper 0.125.0 and
  RCT-Folly 2021.06.28 do not compile on Xcode 15+ without patches.
- App Store Connect requires a current Xcode/iOS SDK and privacy manifests for Firebase and other SDKs;
  Firebase iOS 9.3.0 has none.
- RN 0.69.3 predates the 0.69.7 patch for the November 2022 `com.facebook.react:react-native:+` resolution
  incident (`android/app/build.gradle:277`); the `excludeGroup` at `android/build.gradle:44-50` only partly protects.
- Old libraries (`toolbar-android` 0.2.1, `masked-view` 0.2.7, `picker` 1.16.8) may still declare `jcenter()`, which is gone.
- Reanimated 2.9.1, gesture-handler 2.5, screens 3.15, RNFB 15 do not support the New Architecture, which is
  mandatory in current RN.

Other defects worth knowing before any release:

- iOS launch screen is the RN template: labels `bluelytics_mobile_v3` and `Powered by React Native`
  (`ios/bluelytics_mobile_v3/LaunchScreen.storyboard:25,31`). `assets/images/splash.png` is unused.
- `Info.plist:42-43` has an empty `NSLocationWhenInUseUsageDescription`; `Info.plist:27-41` has an ATS exception
  literally named `New Exception Domain`; `Info.plist:72` requires `armv7`.
- `AndroidManifest.xml:13` sets `usesCleartextTraffic="true"` in release.
- `__tests__/App-test.js` is the template smoke test (Jest 26) with no Firebase mocks.

---

## 5. Tracked-file inventory

- **111 tracked files**, **3,220,893 bytes (3.07 MiB)** apparent size; `git ls-files -z | xargs -0 du -ch | tail -1` prints `3,4M total`.
- 53 commits on `master` (= `origin/master`, `git@github.com:sicarul/bluelytics_mobile_v3.git`), 2020-05-19 to 2023-12-19.

By top-level directory:

| Dir | Files | Bytes |
|---|---|---|
| `android/` | 53 | 2,185,838 |
| root | 17 | 622,817 (of which `package-lock.json` 614,312 in the working tree; 552,553 at `HEAD`) |
| `ios/` | 31 | 340,513 |
| `assets/` | 2 | 51,644 |
| `screens/` | 3 | 17,771 |
| `navigator/` | 2 | 1,918 |
| `__tests__/`, `.vscode/`, `.bundle/` | 3 | 392 |

By type: 16 `.ttf` = 1,984,216 bytes (62% of everything), 7 `.json` = 618,696, 16 `.png` = 352,964,
`project.pbxproj` 59,317, `gradle-wrapper.jar` 58,695, 13 `.js` = 21,630.

Biggest tracked files: `package-lock.json` (614,312), `android/app/src/main/assets/fonts/MaterialCommunityIcons.ttf`
(546,548), `Fontisto.ttf` (313,528), `FontAwesome5_Solid.ttf` (186,228), `FontAwesome.ttf` (165,548),
`MaterialIcons.ttf` (128,180), `FontAwesome5_Brands.ttf` (125,016), `Ionicons.ttf` (112,472),
`ios/.../AppIcon.appiconset/1024.png` (82,773), `AntDesign.ttf` (70,344).

Tracked items needing a decision before they enter a new monorepo:

| Item | Nature | Suggested handling |
|---|---|---|
| `android/app/debug.keystore` | binary Java keystore, stock template debug key (not a secret) | keep for reproducible debug builds and allow-list it in secret scanning, or drop and regenerate |
| `android/app/google-services.json`, `ios/GoogleService-Info.plist` | Firebase client config incl. API keys and OAuth client ids | required to build; fine in a private repo; if the monorepo is public, restrict the keys in Google Cloud (package + SHA-1 / bundle id) or inject from CI |
| `project.pbxproj` | contains the Apple team id | identifier only; keep |
| 16 icon fonts under `android/app/src/main/assets/fonts/` | 1.98 MB binaries; only `FontAwesome.ttf` is used | keep verbatim for a frozen snapshot; trim in a real update |
| `android/gradle/wrapper/gradle-wrapper.jar` | binary, standard | keep |
| `package-lock.json` | npm lockfile | keep the `HEAD` version if the app stays on npm |
| `.buckconfig`, `android/app/_BUCK`, `android/app/build_defs.bzl`, `.flowconfig`, `.vscode/settings.json`, `assets/images/splash.png`, tvOS targets/scheme | dead template boilerplate | optional removal |

No build outputs and no server credentials are tracked at `HEAD`.

Present on disk but ignored — **exclude all of it**: `node_modules/` (613 MB), `android/app/build/` (1.1 GB,
includes four debug APKs and the release `app-release.aab`), `android/build/`, `android/.gradle/`, `.gradle/`,
`.idea/`, `android/.idea/`, `android/app/app.iml`, `android/com.bluelytics.iml`, `android/local.properties`
(machine-specific `sdk.dir`). `ios/Pods` does not exist here.

Git history warning: `.git` is 142 MB because `refs/original/refs/heads/master` (a `git filter-branch` backup,
commit `f4f128b`) still holds `android/java_pid7522.hprof`, a **436,602,674-byte JVM heap dump**. `master` and
`origin/master` do not contain it. A build-tool heap dump can hold in-memory credentials, so never import
`--all` refs; either import no history or `master` only.

---

## 6. Recommendation: bringing it in as `apps/mobile`

### 6.1 Decision

Import a **frozen snapshot of `HEAD` (`ca2cf88`)**, keep it **outside the pnpm workspace**, and do **no in-place
modernization**. Treat a store update as a separate, explicit project that re-scaffolds the native shells.

Reasons:

- The installed base depends on the API and FCM contracts, not on this source. Nothing in the monorepo migration
  needs the app to build.
- The 0.69 project assumes `node_modules` inside the app directory (hard-coded `../node_modules/...` paths listed
  in 4.3) and relies on undeclared transitive packages (`react-native-gradle-plugin`,
  `@react-native-community/cli-platform-android`, `jsc-android`). pnpm's symlinked, non-hoisted layout breaks
  both; forcing `node-linker=hoisted` would degrade the whole workspace for an app that cannot ship anyway.
- An in-place 0.69 -> current upgrade crosses 19 minor versions and the New Architecture switch while the JS is
  under 800 lines. Regenerating the shells and porting the JS is cheaper and safer than upgrading.

### 6.2 How to import

```sh
# from the bluelytics_v2 root; copies exactly the 111 tracked files at HEAD, no history, no WIP, no build output
mkdir -p apps/mobile
git -C /home/sicarul/dev/bluelytics/bluelytics_mobile_v3 archive --format=tar HEAD | tar -x -C apps/mobile
```

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - '!apps/mobile'   # legacy React Native 0.69 app: own npm lockfile, not a workspace member
```

Also:

- Keep `apps/mobile/package-lock.json` and `apps/mobile/.gitignore`; add `apps/mobile` to the ignore lists of
  the root linter, formatter, type-checker, task runner, dependency-update bot and CI install step.
- Add `apps/mobile/README.md` recording: source commit `ca2cf88`, RN 0.69.3, store versions (Android 1.6/8, iOS
  1.0/3), identifiers from section 3, the four `BLUELYTICS_UPLOAD_*` property names, "frozen, not buildable on
  current toolchains", and a pointer to the contracts in sections 1.5 and 2.6.
- Do **not** copy: the staged/unstaged 0.74 changes, anything ignored (section 5),
  `bluescraper/bluelytics-mobile-firebase-adminsdk.json`, any release keystore, the legacy `.git` directory.
- Do not rename the Android package, iOS bundle id, `app.json.name`, or swap the Firebase config files.

### 6.3 What the rest of the monorepo must do for the installed base

1. Serve `GET /v2/latest` and `GET /data/json/currency.json` on `api.bluelytics.com.ar` under the rules in 1.5.
   Add contract tests that assert: object body; `blue` and `oficial` both present; four rate fields are finite
   numbers; `currency.json` is an array of `{code, name, value}` with numeric `value`.
2. Send alerts with the exact payload in 2.6 through project `bluelytics-mobile`; unit-test the generated JSON
   and the title/body strings against the examples.
3. Provision the service-account key as an infrastructure secret; never commit it.
4. Keep `http://` -> `https://` redirects and TLS 1.2 on the API host; no bot challenges there.

### 6.4 If and when a store update is wanted

Preconditions to settle first (see open questions): listing/account status on both stores, location of the
Android upload keystore, highest `versionCode` already on Play, APNs credential status, remaining active users.

Then, rather than upgrading:

- Scaffold a fresh project on the current React Native (or Expo with prebuild) inside the workspace, in
  TypeScript, as a normal pnpm member that can share API types with the rest of the monorepo.
- Reuse: `com.bluelytics.mobileapp`, `com.bluelytics.mobile`, both Firebase config files, the same upload key,
  component name `Bluelytics`, AsyncStorage key `subState`, topic `alertas-blue`, analytics event names
  (`subscribe_alertas_blue`, `unsubscribe_alertas_blue`, `select_content` with `content_type: 'selected_currency'`).
- Version numbers: Android `versionCode` greater than anything on Play (possibly > 4,194,312 if per-ABI APKs
  were ever uploaded), iOS build > 3 and marketing version > 1.0.
- Fix while porting: double fetch; missing `.catch` and refresh in the calculator; null-safe rendering and an
  error boundary; duplicate USD and the broken sort comparator; zero-valued currencies; request
  `POST_NOTIFICATIONS` on Android 13+; create channel id `Dolar Blue` at startup and declare default
  channel/icon/color; show alerts in foreground; real launch screen; remove the empty location string and ATS
  placeholder; drop unused dependencies; target API 36 with 16 KB pages; current Xcode SDK and privacy manifests.

---

## 7. Open questions for the owner

1. Are the apps still published? Both listings returned not-found on 2026-11-22. If a developer account lapsed,
   is iOS push (APNs credentials) still valid?
2. Where is the Android upload keystore and the four `BLUELYTICS_UPLOAD_*` values? Is Play App Signing enabled
   (allowing an upload-key reset)?
3. What is the highest `versionCode` on Play: 8 (AAB) or a per-ABI code up to 4,194,312? The formula changed in
   commit `9c70dbf` ("Version codes fix").
4. Was any iOS build shipped after build 3 (August 2022)? If not, iPhones still show the Oficial sell rate
   multiplied by 1.75 with `(+75% impuestos)`.
5. How many active installs and `alertas-blue` subscribers remain (Firebase / Play consoles)? This decides
   whether a new release is worth doing at all.
6. Is the currency refresh job dead? `currency.json` serves `ARS` = 232.41 while the official rate is about
   1,575, so non-USD conversions in the calculator (and possibly the euro rates) use stale cross rates.
7. Should the local `refs/original` backup holding the 436 MB heap dump be deleted from the legacy clone?
