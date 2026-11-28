package com.bluelytics.mobileapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Unit tests run with the module directory (apps/android/app) as the working directory. */
class ConfigTest {
    private val gradle = File("build.gradle.kts").readText()

    @Test
    fun `the version shown in the app is the one in build gradle`() {
        val name = Regex("""versionName = "([^"]+)"""").find(gradle)!!.groupValues[1]
        assertEquals(name, appVersion)
        assertEquals(name, BuildConfig.VERSION_NAME)
    }

    @Test
    fun `the version code is above every code the React Native builds used on Google Play`() {
        // Per-ABI codes were abi × 1.048.576 + 8, with abi up to 4.
        assertTrue(BuildConfig.VERSION_CODE > 4 * 1048576 + 8)
    }

    @Test
    fun `the store identifier is the one the app has always had`() {
        assertTrue(gradle.contains("applicationId = \"com.bluelytics.mobileapp\""))
        assertEquals("com.bluelytics.mobileapp", BuildConfig.APPLICATION_ID)
        val services = File("google-services.json").readText()
        assertTrue(services.contains("\"package_name\": \"com.bluelytics.mobileapp\""))
        assertTrue(services.contains("\"project_id\": \"bluelytics-mobile\""))
    }

    @Test
    fun `the notification channel is the one the sender targets`() {
        assertEquals("Dolar Blue", ALERTS_CHANNEL_ID)
        assertEquals("alertas-blue", ALERTS_TOPIC)
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:value=\"$ALERTS_CHANNEL_ID\""))
        assertTrue("release builds get no network without it", manifest.contains("android.permission.INTERNET"))
        assertTrue("no token until alerts are turned on", Regex("""firebase_messaging_auto_init_enabled"\s+android:value="false"""").containsMatchIn(manifest))
    }
}
