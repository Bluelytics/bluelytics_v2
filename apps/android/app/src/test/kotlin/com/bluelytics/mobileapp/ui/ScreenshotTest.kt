/*
 * Renders every screen to apps/android/build/screenshots/ for a visual check (and the store listing):
 *
 *   SCREENSHOTS=1 ./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest'
 *
 *   SCREENSHOTS=1 SCREENSHOT_SIZE=360x640@3 ./gradlew ...   # 1080 × 1920, Google Play
 *
 * SCREENSHOT_SIZE is the screen in dp and its density; the default, 390x844@2 (780 × 1688 px), is the
 * size of the Flutter app's screenshots. It asserts nothing about pixels, so a font or renderer
 * update never fails the suite. Skipped without SCREENSHOTS=1.
 */
package com.bluelytics.mobileapp.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performSemanticsAction
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.support.FakePush
import com.bluelytics.mobileapp.support.openTab
import com.bluelytics.mobileapp.support.pumpApp
import com.bluelytics.mobileapp.support.tap
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.roundToInt
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w390dp-h844dp-xhdpi")
class ScreenshotTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun setUp() {
        assumeTrue("set SCREENSHOTS=1 to render the screens", System.getenv("SCREENSHOTS") == "1")
        val size = System.getenv("SCREENSHOT_SIZE")?.takeIf { it.isNotBlank() } ?: "390x844@2"
        val match = requireNotNull(Regex("""^(\d+)x(\d+)@(\d+(?:\.\d+)?)$""").find(size)) { "SCREENSHOT_SIZE must look like 390x844@2" }
        val (width, height, ratio) = match.destructured
        RuntimeEnvironment.setQualifiers("w${width}dp-h${height}dp-${(ratio.toFloat() * 160).roundToInt()}dpi")
    }

    @OptIn(ExperimentalRoborazziApi::class)
    private fun shoot(name: String) {
        rule.waitForIdle()
        // Unit tests run in apps/android/app.
        captureScreenRoboImage("../build/screenshots/$name.png")
    }

    private fun scrollBy(dp: Float) {
        val px = dp * rule.density.density
        rule.onAllNodes(hasScrollAction()).onFirst().performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, px) }
        rule.waitForIdle()
    }

    @Test
    fun es() = screens(AppLocale.es)

    @Test
    fun en() = screens(AppLocale.en)

    private fun screens(locale: AppLocale) {
        val es = locale == AppLocale.es
        val harness = rule.pumpApp(locale = locale, push = FakePush())
        // The Alerts screenshot shows the switch on, as in the Flutter app's.
        runBlocking { harness.alerts.setEnabled(true) }
        val tag = locale.name
        shoot("$tag-1-today")
        scrollBy(620f)
        shoot("$tag-2-today-more")
        scrollBy(1200f)
        shoot("$tag-3-today-end")

        rule.openTab(if (es) "Histórico" else "History")
        shoot("$tag-4-history")
        rule.tap(if (es) "Máx" else "Max")
        rule.tap(if (es) "Brecha" else "Gap")
        shoot("$tag-5-history-gap")

        rule.openTab(if (es) "Calcular" else "Convert")
        shoot("$tag-6-calculator")
        rule.tap(if (es) "Moneda:" else "Currency:", substring = true)
        rule.mainClock.advanceTimeBy(400)
        shoot("$tag-7-currencies")
        rule.tap(if (es) "Cerrar" else "Close")
        rule.mainClock.advanceTimeBy(400)

        rule.openTab(if (es) "Alertas" else "Alerts")
        shoot("$tag-8-alerts")
    }
}
