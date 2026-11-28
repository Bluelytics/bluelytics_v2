/* Build-time constants: hosts, links and identifiers. */
package com.bluelytics.mobileapp

/** Marketing version, from `versionName` in app/build.gradle.kts. */
val appVersion: String = BuildConfig.VERSION_NAME

/** The public API (apps/api): the same endpoints every third-party consumer uses. */
const val API_BASE = "https://api.bluelytics.com.ar"

/** The website (apps/web), used for links and for the optional `/data/extras.json`. */
const val SITE_BASE = "https://bluelytics.com.ar"

/** FCM topic and Android channel the alert sender uses (packages/core/src/alerts.ts `FCM`). */
const val ALERTS_TOPIC = "alertas-blue"
const val ALERTS_CHANNEL_ID = "Dolar Blue"

object Links {
    const val SITE = SITE_BASE
    const val ABOUT = "$SITE_BASE/acerca"
    const val ABOUT_EN = "$SITE_BASE/en/about"
    const val API = "$SITE_BASE/api"
    const val API_EN = "$SITE_BASE/en/api"
    const val SOURCE = "https://github.com/Bluelytics/bluelytics_v2"
    const val LICENSE = "https://creativecommons.org/licenses/by/4.0/"
    const val X = "https://x.com/bluelytics"
    const val INSTAGRAM = "https://www.instagram.com/bluelytics_dolar"
    const val LINKEDIN = "https://www.linkedin.com/company/74483029"
}
