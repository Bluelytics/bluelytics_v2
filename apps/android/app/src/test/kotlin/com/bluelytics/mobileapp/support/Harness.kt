package com.bluelytics.mobileapp.support

import android.app.Application
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.bluelytics.mobileapp.data.AppStore
import com.bluelytics.mobileapp.data.MemoryPrefs
import com.bluelytics.mobileapp.data.Settings
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.push.AlertsController
import com.bluelytics.mobileapp.push.NoPush
import com.bluelytics.mobileapp.push.PushBackend
import com.bluelytics.mobileapp.ui.AppScope
import com.bluelytics.mobileapp.ui.BluelyticsApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking

/**
 * Stands in for BluelyticsApplication under Robolectric (robolectric.properties): no Firebase, no
 * network, no notification channel.
 */
class TestApplication : Application()

/** A scope for stores in interface tests: real threads, like the app's. */
fun testScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

class Harness(val store: AppStore, val settings: Settings, val alerts: AlertsController)

/**
 * Sets the whole app over fixture data, with motion reduced so every frame is the settled one. The
 * screen size and density come from the test's Robolectric qualifiers.
 */
fun ComposeContentTestRule.pumpApp(
    locale: AppLocale = AppLocale.es,
    store: AppStore = fixtureStore(testScope()),
    push: PushBackend = NoPush,
    load: Boolean = true,
): Harness {
    val prefs = MemoryPrefs()
    val settings = Settings(prefs, locale)
    val alerts = AlertsController(push, prefs)
    runBlocking {
        if (load) store.refresh()
        alerts.init()
    }
    // A phone is in touch mode: a tap does not leave a focus highlight on what was tapped.
    InstrumentationRegistry.getInstrumentation().setInTouchMode(true)
    setContent { BluelyticsApp(AppScope(store, settings, alerts), reducedMotion = true) }
    waitForIdle()
    return Harness(store, settings, alerts)
}

/** A clickable node read as `label` (its text, or its TalkBack label). */
fun labelled(label: String, substring: Boolean = false): SemanticsMatcher =
    (hasText(label, substring = substring) or hasContentDescription(label, substring = substring)) and hasClickAction()

fun ComposeContentTestRule.tap(label: String, substring: Boolean = false) {
    onAllNodes(labelled(label, substring), useUnmergedTree = false).onFirst().performClick()
    waitForIdle()
}

/** Opens one of the four tabs by its label. */
fun ComposeContentTestRule.openTab(label: String) {
    onAllNodes(hasContentDescription(label) and hasClickAction() and SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.Role, androidx.compose.ui.semantics.Role.Tab))
        .onFirst()
        .performClick()
    waitForIdle()
}
