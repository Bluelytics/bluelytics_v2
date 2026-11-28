/* The app: theme, language, the masthead, the four tabs, the alert banner and the refresh loop. */
package com.bluelytics.mobileapp.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.bluelytics.mobileapp.R
import com.bluelytics.mobileapp.data.AppStore
import com.bluelytics.mobileapp.data.Settings
import com.bluelytics.mobileapp.domain.ChartMode
import com.bluelytics.mobileapp.i18n.Strings
import com.bluelytics.mobileapp.push.AlertMessage
import com.bluelytics.mobileapp.push.AlertsController
import com.bluelytics.mobileapp.ui.screens.AlertsScreen
import com.bluelytics.mobileapp.ui.screens.CalculatorScreen
import com.bluelytics.mobileapp.ui.screens.HistoryScreen
import com.bluelytics.mobileapp.ui.screens.TodayScreen
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.mono
import com.bluelytics.mobileapp.ui.theme.sans
import com.bluelytics.mobileapp.ui.widgets.ContentWidth
import com.bluelytics.mobileapp.ui.widgets.Glyph
import com.bluelytics.mobileapp.ui.widgets.GlyphIcon
import com.bluelytics.mobileapp.ui.widgets.LocalReducedMotion
import com.bluelytics.mobileapp.ui.widgets.blBackground
import com.bluelytics.mobileapp.ui.widgets.edges
import com.bluelytics.mobileapp.ui.widgets.pressable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The three long-lived objects every screen reads. */
class AppScope(val store: AppStore, val settings: Settings, val alerts: AlertsController)

val LocalApp = staticCompositionLocalOf<AppScope> { error("no AppScope") }

/** How often the live quotes are asked for while the app is on screen. */
const val POLL_EVERY_MILLIS = 60_000L

/** Large system text is honoured up to a point the big figures can still take. */
private const val MAX_FONT_SCALE = 1.3f

private val colors = darkColorScheme(
    primary = Bl.brand,
    onPrimary = Bl.text,
    secondary = Bl.brandInk,
    surface = Bl.surface,
    onSurface = Bl.text,
    background = Bl.ink,
    onBackground = Bl.text,
    error = Bl.down,
)

@Composable
fun BluelyticsApp(scope: AppScope, reducedMotion: Boolean = false) {
    val density = LocalDensity.current
    val clamped = remember(density) { Density(density.density, density.fontScale.coerceAtMost(MAX_FONT_SCALE)) }
    MaterialTheme(colorScheme = colors) {
        CompositionLocalProvider(
            LocalApp provides scope,
            LocalDensity provides clamped,
            LocalReducedMotion provides reducedMotion,
            LocalTextSelectionColors provides TextSelectionColors(handleColor = Bl.brandInk, backgroundColor = Bl.brand.copy(alpha = 0.45f)),
        ) { AppShell() }
    }
}

enum class Tab { today, history, calculator, alerts }

@Composable
fun AppShell() {
    val app = LocalApp.current
    val locale by app.settings.locale.collectAsState()
    val strings = Strings.of(locale)
    var tab by rememberSaveable { mutableStateOf(Tab.today) }
    var historyMode by rememberSaveable { mutableStateOf(ChartMode.rates) }
    var banner by remember { mutableStateOf<AlertMessage?>(null) }
    val tabs = rememberSaveableStateHolder()
    val haptics = LocalHapticFeedback.current
    val focus = LocalFocusManager.current
    val lifecycle = LocalLifecycleOwner.current

    // On screen: fetch now, then every minute; off screen: nothing.
    LaunchedEffect(app.store, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { app.store.refresh() }
            while (true) {
                delay(POLL_EVERY_MILLIS)
                launch { app.store.refresh() }
            }
        }
    }
    // An alert arrived while the app is open: show it and fetch the price it talks about.
    LaunchedEffect(app.alerts) {
        app.alerts.messages.collect { message ->
            banner = message
            launch { app.store.refresh(force = true) }
        }
    }
    LaunchedEffect(banner) {
        if (banner == null) return@LaunchedEffect
        delay(8000)
        banner = null
    }

    fun select(next: Tab) {
        if (next == tab) return
        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
        focus.clearFocus()
        tab = next
    }

    // System back leaves the other tabs for Today before it leaves the app.
    BackHandler(enabled = tab != Tab.today) { select(Tab.today) }

    Column(Modifier.fillMaxSize().blBackground()) {
        Masthead(strings) { app.settings.toggleLocale() }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            // Only the current tab is composed; the others keep their scroll position and what was
            // typed or chosen, as saved state.
            tabs.SaveableStateProvider(tab.name) {
                when (tab) {
                    Tab.today -> TodayScreen(strings) { mode ->
                        historyMode = mode
                        tab = Tab.history
                    }
                    Tab.history -> HistoryScreen(strings, historyMode) { historyMode = it }
                    Tab.calculator -> CalculatorScreen(strings)
                    Tab.alerts -> AlertsScreen(strings)
                }
            }
            banner?.let { message -> Banner(message, strings.close) { banner = null } }
        }
        TabBar(tab, strings, ::select)
    }
}

@Composable
private fun Masthead(strings: Strings, onToggleLanguage: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(Bl.ink.copy(alpha = 0.82f))
            .edges(Bl.line, bottom = 1.dp)
            .windowInsetsPadding(WindowInsets.statusBars),
    ) {
        ContentWidth {
            Row(Modifier.fillMaxWidth().height(52.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.clearAndSetSemantics {
                        contentDescription = "Bluelytics"
                        heading()
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Image(painterResource(R.drawable.mark), contentDescription = null, modifier = Modifier.size(28.dp))
                    Spacer(Modifier.width(9.dp))
                    Text("bluelytics", style = sans(18.5f, weight = 800, tracking = -0.045f, height = 1f))
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.pressable(onToggleLanguage, label = strings.switchLanguage), contentAlignment = Alignment.Center) {
                    Text(
                        strings.otherLanguageCode,
                        modifier = Modifier
                            .border(1.dp, Bl.lineStrong, RoundedCornerShape(2.dp))
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                        style = mono(12f, weight = 500, color = Bl.soft, tracking = 0.12f, height = 1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun TabBar(selected: Tab, strings: Strings, onSelect: (Tab) -> Unit) {
    val entries = listOf(
        Triple(Tab.today, Glyph.today, strings.tabToday),
        Triple(Tab.history, Glyph.history, strings.tabHistory),
        Triple(Tab.calculator, Glyph.calculator, strings.tabCalculator),
        Triple(Tab.alerts, Glyph.bell, strings.tabAlerts),
    )
    Box(
        Modifier
            .fillMaxWidth()
            .background(Bl.ink.copy(alpha = 0.94f))
            .edges(Bl.line, top = 1.dp)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .semantics { contentDescription = strings.sections },
    ) {
        ContentWidth(padded = false) {
            Row(Modifier.fillMaxWidth()) {
                for ((tab, glyph, label) in entries) {
                    val active = tab == selected
                    Box(
                        Modifier
                            .weight(1f)
                            .pressable({ onSelect(tab) }, label = label, selected = active, role = Role.Tab, minHeight = 58.dp),
                        contentAlignment = Alignment.TopCenter,
                    ) { TabCell(glyph, label, active) }
                }
            }
        }
    }
}

@Composable
private fun TabCell(glyph: Glyph, label: String, active: Boolean) {
    val still = LocalReducedMotion.current
    // The site's underline for the current page, here on the top edge.
    val underline by animateDpAsState(if (active) 34.dp else 0.dp, tween(if (still) 0 else 180), label = "tab")
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(width = underline, height = 2.dp).background(Bl.brand))
        Spacer(Modifier.height(9.dp))
        GlyphIcon(glyph, 21.dp, if (active) Bl.brandInk else Bl.dim, stroke = if (active) 1.8f else 1.5f)
        Spacer(Modifier.height(6.dp))
        Text(label.uppercase(), maxLines = 1, style = mono(10f, weight = if (active) 600 else 500, color = if (active) Bl.text else Bl.dim, tracking = 0.1f, height = 1f))
        Spacer(Modifier.height(9.dp))
    }
}

/** An alert that arrived while the app is open. */
@Composable
private fun Banner(message: AlertMessage, closeLabel: String, onClose: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(Bl.surface2)
            .edges(Bl.brand, bottom = 2.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        ContentWidth {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GlyphIcon(Glyph.bell, 18.dp, Bl.brandInk)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f).padding(vertical = 12.dp)) {
                    if (message.title.isNotEmpty()) Text(message.title, style = sans(15f, weight = 700, height = 1.25f))
                    if (message.body.isNotEmpty()) Text(message.body, style = mono(12.5f, weight = 500, color = Bl.soft, height = 1.35f))
                }
                Box(Modifier.pressable(onClose, label = closeLabel).padding(12.dp), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.close, 18.dp, Bl.soft)
                }
            }
        }
    }
}
