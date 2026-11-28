// The whole app over captured API bodies: what a person sees and can do on each screen.
package com.bluelytics.mobileapp.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.click
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import com.bluelytics.mobileapp.data.Feed
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.NBSP
import com.bluelytics.mobileapp.push.AlertMessage
import com.bluelytics.mobileapp.support.FakePush
import com.bluelytics.mobileapp.support.fixtureNow
import com.bluelytics.mobileapp.support.fixtureStore
import com.bluelytics.mobileapp.support.openTab
import com.bluelytics.mobileapp.support.pumpApp
import com.bluelytics.mobileapp.support.tap
import com.bluelytics.mobileapp.support.testScope
import com.bluelytics.mobileapp.ui.screens.AMOUNT_FIELD_TAG
import com.bluelytics.mobileapp.ui.screens.CURRENCY_SEARCH_TAG
import com.bluelytics.mobileapp.ui.screens.HISTORY_LIST_TAG
import com.bluelytics.mobileapp.ui.widgets.CHART_TAG
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w390dp-h844dp-xhdpi")
class AppTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private fun exists(text: String, substring: Boolean = false) =
        rule.onAllNodes(hasText(text, substring = substring) or hasContentDescription(text, substring = substring)).fetchSemanticsNodes().isNotEmpty()

    private fun assertShown(text: String, substring: Boolean = false, reason: String = text) = assertTrue("expected: $reason", exists(text, substring))

    private fun assertGone(text: String, substring: Boolean = false) = assertFalse("not expected: $text", exists(text, substring))

    private fun scrollTo(text: String, substring: Boolean = false) {
        rule.onAllNodes(hasText(text, substring = substring) or hasContentDescription(text, substring = substring)).onFirst().performScrollTo()
        rule.waitForIdle()
    }

    // Today.

    @Test
    fun `today - shows the blue dollar, its move since the previous close and the other rates`() {
        rule.pumpApp()
        assertShown("Dólar blue hoy")
        assertShown("Venta \$${NBSP}1.710", reason = "the sell price, large")
        assertShown("+10, +0,59$NBSP%")
        assertShown("vs. cierre del 24 nov 2026")
        assertShown("ACTUALIZADO 25 NOV 2026, 19:20", substring = true, reason = "Argentine time, whatever the device zone")
        assertShown("\$${NBSP}1.690")
        assertShown("\$${NBSP}1.700,00")
        rule.onNodeWithTag(CHART_TAG).assertExists()
        assertShown("DÓLAR OFICIAL")
        scrollTo("Otros tipos de dólar")
        assertShown("DÓLAR MEP")
        scrollTo("Dólares a pesos")
        scrollTo("\$${NBSP}1.710.000")
    }

    @Test
    fun `today - in English every label and number format changes`() {
        rule.pumpApp(locale = AppLocale.en)
        assertShown("Blue dollar today")
        assertShown("Sell \$1,710")
        assertShown("vs. Nov 24, 2026 close")
        assertShown("\$1,700.00")
        scrollTo("Dollars to pesos")
    }

    @Test
    fun `today - the section with other dollar rates disappears when nobody serves it`() {
        rule.pumpApp(store = fixtureStore(testScope(), fail = setOf(Feed.extras)))
        assertShown("Venta \$${NBSP}1.710")
        assertGone("Otros tipos de dólar")
        scrollTo("Dólares a pesos")
    }

    @Test
    fun `today - without network and without cache it says so and offers to retry`() {
        val harness = rule.pumpApp(store = fixtureStore(testScope(), fail = Feed.entries.toSet()))
        assertShown("No pudimos traer las cotizaciones.")
        assertShown("REINTENTAR")
        assertFalse(harness.store.state.value.hasData)
    }

    @Test
    fun `today - offline with a cache, the last known prices stay, marked as such`() {
        val store = fixtureStore(testScope())
        runBlocking { store.refresh() }
        Thread.sleep(200) // the cache writes run on the store's scope
        // The next start, ten minutes later, cannot reach the API.
        val offline = fixtureStore(testScope(), fail = Feed.entries.toSet(), cache = store.cache, clock = { fixtureNow.plus(Duration.ofMinutes(10)) })
        runBlocking { offline.restore() }
        rule.pumpApp(store = offline)
        assertShown("Venta \$${NBSP}1.710")
        assertShown("SIN CONEXIÓN", substring = true)
    }

    @Test
    @Config(qualifiers = "w320dp-h568dp-xhdpi")
    fun `today - fits a small phone with the largest text the app allows`() {
        RuntimeEnvironment.setFontScale(2f)
        rule.pumpApp()
        for (tab in listOf("Histórico", "Calcular", "Alertas", "Hoy")) rule.openTab(tab)
    }

    @Test
    @Config(qualifiers = "w1180dp-h820dp-land-xhdpi")
    fun `today - fits a tablet in landscape`() {
        rule.pumpApp()
        for (tab in listOf("Histórico", "Calcular", "Alertas")) rule.openTab(tab)
    }

    // Language.

    @Test
    fun `language - the toggle switches the whole app and is remembered`() {
        val harness = rule.pumpApp()
        rule.tap("Switch to English")
        assertShown("Blue dollar today")
        assertShown("Sell \$1,710")
        assertEquals(AppLocale.en, harness.settings.locale.value)
        assertEquals("en", harness.settings.prefs.getString("locale"))
        rule.tap("Cambiar a español")
        assertShown("Dólar blue hoy")
    }

    // History.

    @Test
    fun `history - one year by default, the table is the newest day first`() {
        rule.pumpApp()
        rule.openTab("Histórico")
        assertShown("Dólar blue y oficial, día por día desde 2011.")
        rule.onNodeWithTag(CHART_TAG).assertExists()
        assertShown("VARIACIÓN")
        rule.onNodeWithTag(HISTORY_LIST_TAG).performScrollToNode(hasText("24/11/26"))
        rule.waitForIdle()
        val newest = rule.onNodeWithText("25/11/26").fetchSemanticsNode().boundsInRoot.top
        val before = rule.onNodeWithText("24/11/26").fetchSemanticsNode().boundsInRoot.top
        assertTrue(newest < before)
    }

    private fun daysWithData(): Int {
        val text = rule.onNodeWithText("días con datos", substring = true).fetchSemanticsNode().config[SemanticsProperties.Text].joinToString(" ")
        return Regex("""(\d+) días con datos""").find(text)!!.groupValues[1].toInt()
    }

    @Test
    fun `history - range and mode can be changed`() {
        rule.pumpApp()
        rule.openTab("Histórico")
        rule.tap("1M")
        val month = daysWithData()
        assertTrue("about 21 working days: $month", month in 15..25)
        rule.tap("Máx")
        assertTrue(daysWithData() > 500)
        rule.tap("Brecha")
        rule.onNodeWithTag(CHART_TAG).assertExists()
    }

    @Test
    fun `history - the gap tile on Today opens History on the gap`() {
        rule.pumpApp()
        rule.onAllNodesWithText("BRECHA CAMBIARIA").onFirst().performScrollTo().performClick()
        rule.waitForIdle()
        assertShown("Dólar blue y oficial, día por día desde 2011.")
        rule.onAllNodesWithContentDescription("Brecha").onFirst().assertExists().let {
            assertEquals(true, it.fetchSemanticsNode().config.getOrNull(SemanticsProperties.Selected))
        }
    }

    @Test
    fun `history - touching the chart reads the day under the finger`() {
        rule.pumpApp()
        rule.openTab("Histórico")
        rule.tap("1M")
        val chart = rule.onNodeWithTag(CHART_TAG)
        chart.performTouchInput { click(androidx.compose.ui.geometry.Offset(left + 40 * density, centerY)) }
        rule.waitForIdle()
        fun reading() = chart.fetchSemanticsNode().config[SemanticsProperties.ContentDescription].joinToString()
        assertTrue("the left edge of the last month: ${reading()}", reading().contains("octubre de 2026"))
        // The reading goes back to the last day by itself.
        rule.mainClock.advanceTimeBy(4000)
        rule.waitForIdle()
        assertTrue(reading(), reading().startsWith("25 de noviembre de 2026"))
    }

    // Calculator.

    private fun result(value: String) = rule.onAllNodesWithContentDescription(": $value.", substring = true)

    @Test
    fun `calculator - dollars to pesos at both rates, and back`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        assertGone("Escribí un monto.")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("250")
        rule.waitForIdle()
        // Blue: buy at the sell price (1.710), sell at the buy price (1.690).
        result("\$${NBSP}427.500").onFirst().assertExists()
        result("\$${NBSP}422.500").onFirst().assertExists()
        // Official: 1.630 and 1.580.
        result("\$${NBSP}407.500").onFirst().performScrollTo()
        result("\$${NBSP}395.000").onFirst().performScrollTo()

        rule.onAllNodesWithContentDescription("Invertir", substring = true).onFirst().performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("171.000")
        rule.waitForIdle()
        result("US\$${NBSP}100,00").onFirst().assertExists()
    }

    @Test
    fun `calculator - an amount that is not a number asks for one`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("")
        rule.waitForIdle()
        assertShown("Escribí un monto.")
    }

    @Test
    fun `calculator - only digits and separators can be typed`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextInput("12a,5-x")
        rule.waitForIdle()
        assertEquals("12,5", rule.onNodeWithTag(AMOUNT_FIELD_TAG).fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
    }

    @Test
    fun `calculator - any currency can be picked by searching, it converts through the dollar`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("100")
        rule.tap("Moneda:", substring = true)
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        assertShown("Elegí la moneda")
        assertShown("MONEDAS DE AMÉRICA (VÍA DÓLAR)")
        rule.onNodeWithTag(CURRENCY_SEARCH_TAG).performTextInput("real bras")
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Real brasileño (BRL)").performClick()
        rule.mainClock.advanceTimeBy(400)
        rule.waitForIdle()
        assertGone("Elegí la moneda")
        // 100 BRL × 1.710 / 5,93.
        result("\$${NBSP}28.836,42").onFirst().assertExists()
        scrollTo("Convertido a través del dólar", substring = true)
    }

    @Test
    fun `calculator - tapping a result copies it`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        rule.onNodeWithTag(AMOUNT_FIELD_TAG).performTextReplacement("250")
        rule.waitForIdle()
        result("\$${NBSP}427.500").onFirst().performClick()
        rule.waitForIdle()
        val clipboard = ApplicationProvider.getApplicationContext<Context>().getSystemService(ClipboardManager::class.java)
        assertEquals("\$ 427.500", clipboard.primaryClip!!.getItemAt(0).text.toString())
        assertShown("✓ Copiado", substring = true)
    }

    // Alerts.

    private fun alertsSwitch() = rule.onNodeWithContentDescription("Alertas del dólar blue")

    @Test
    fun `alerts - the switch subscribes and shows the state`() {
        val push = FakePush()
        val harness = rule.pumpApp(push = push)
        rule.openTab("Alertas")
        alertsSwitch().assertIsOff()
        alertsSwitch().performClick()
        rule.waitUntil(3000) { harness.alerts.state.value.enabled }
        rule.waitForIdle()
        assertEquals(listOf("enable"), push.calls)
        alertsSwitch().assertIsOn()
        alertsSwitch().performClick()
        rule.waitUntil(3000) { !harness.alerts.state.value.enabled }
        rule.waitForIdle()
        assertEquals(listOf("enable", "disable"), push.calls)
        alertsSwitch().assertIsOff()
    }

    @Test
    fun `alerts - a refused permission is explained`() {
        rule.pumpApp(push = FakePush(grant = false))
        rule.openTab("Alertas")
        alertsSwitch().performClick()
        rule.waitForIdle()
        alertsSwitch().assertIsOff()
        assertShown("Las notificaciones están bloqueadas", substring = true)
    }

    @Test
    fun `alerts - where push does not exist the switch says so and does nothing`() {
        val harness = rule.pumpApp()
        rule.openTab("Alertas")
        assertShown("solo están disponibles en la app para iOS y Android", substring = true)
        alertsSwitch().performClick()
        rule.waitForIdle()
        assertFalse(harness.alerts.state.value.enabled)
    }

    @Test
    fun `alerts - shows the last alert and the version`() {
        rule.pumpApp()
        rule.openTab("Alertas")
        scrollTo("Última alerta")
        assertShown("Subió el dólar blue")
        assertShown("1.740", substring = true)
        scrollTo("Versión 2.0.0 · © Bluelytics")
    }

    @Test
    fun `alerts - an alert that arrives while the app is open shows as a banner, then leaves`() {
        val push = FakePush(legacy = true)
        rule.pumpApp(push = push)
        push.receive(AlertMessage("Subió el dólar blue", "Venta: \$ 1.740"))
        rule.waitForIdle()
        assertShown("Subió el dólar blue")
        rule.mainClock.advanceTimeBy(9000)
        rule.waitForIdle()
        assertGone("Subió el dólar blue")
    }

    @Test
    fun `system back from another tab returns to Today`() {
        rule.pumpApp()
        rule.openTab("Calcular")
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertShown("Dólar blue hoy")
    }
}
