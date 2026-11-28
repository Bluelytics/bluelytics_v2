/* Alerts: the push switch, the last alert sent, and what Bluelytics is. */
package com.bluelytics.mobileapp.ui.screens

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.IntOffset
import androidx.core.net.toUri
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluelytics.mobileapp.Links
import com.bluelytics.mobileapp.appVersion
import com.bluelytics.mobileapp.domain.AlertInfo
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.domain.Move
import com.bluelytics.mobileapp.domain.formatDateTime
import com.bluelytics.mobileapp.domain.formatPesos
import com.bluelytics.mobileapp.i18n.Strings
import com.bluelytics.mobileapp.push.AlertsController
import com.bluelytics.mobileapp.push.AlertsProblem
import com.bluelytics.mobileapp.push.AlertsState
import com.bluelytics.mobileapp.ui.LocalApp
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.sans
import com.bluelytics.mobileapp.ui.widgets.ContentWidth
import com.bluelytics.mobileapp.ui.widgets.DirectionMark
import com.bluelytics.mobileapp.ui.widgets.Glyph
import com.bluelytics.mobileapp.ui.widgets.GlyphIcon
import com.bluelytics.mobileapp.ui.widgets.Hairline
import com.bluelytics.mobileapp.ui.widgets.LocalReducedMotion
import com.bluelytics.mobileapp.ui.widgets.MoveChip
import com.bluelytics.mobileapp.ui.widgets.Panel
import com.bluelytics.mobileapp.ui.widgets.SectionHead
import com.bluelytics.mobileapp.ui.widgets.Wordmark
import com.bluelytics.mobileapp.ui.widgets.directionColor
import com.bluelytics.mobileapp.ui.widgets.edges
import com.bluelytics.mobileapp.ui.widgets.pressable
import kotlinx.coroutines.launch

@Composable
fun AlertsScreen(strings: Strings) {
    val app = LocalApp.current
    val store by app.store.state.collectAsStateWithLifecycle()
    val alerts by app.alerts.state.collectAsStateWithLifecycle()
    val es = strings.locale == AppLocale.es
    val alert = store.alert
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
        ContentWidth {
            Column {
                Spacer(Modifier.height(24.dp))
                Text(strings.alertsTitle, Modifier.semantics { heading() }, style = BlType.h1())
                Spacer(Modifier.height(8.dp))
                Text(strings.alertsLead, style = BlType.body())
                Spacer(Modifier.height(22.dp))
                SwitchPanel(app.alerts, alerts, strings)
                Spacer(Modifier.height(36.dp))
                SectionHead(strings.lastAlert)
                Spacer(Modifier.height(14.dp))
                Hairline(strong = true)
                if (alert == null) {
                    Text(strings.noAlertYet, Modifier.padding(vertical = 14.dp), style = BlType.body(color = Bl.dim))
                } else {
                    LastAlert(alert, strings)
                }
                Spacer(Modifier.height(36.dp))
                SectionHead(strings.aboutTitle)
                Spacer(Modifier.height(12.dp))
                Text(strings.aboutBody, style = BlType.body())
                Spacer(Modifier.height(16.dp))
                Hairline(strong = true)
                LinkRow(strings.linkSite, if (es) Links.SITE else "${Links.SITE}/en/", "bluelytics.com.ar")
                LinkRow(strings.linkMethod, if (es) Links.ABOUT else Links.ABOUT_EN)
                LinkRow(strings.linkApi, if (es) Links.API else Links.API_EN, "api.bluelytics.com.ar")
                LinkRow(strings.linkSource, Links.SOURCE, "GitHub")
                LinkRow(strings.linkLicense, Links.LICENSE)
                Spacer(Modifier.height(22.dp))
                Text(strings.follow.uppercase(), style = BlType.label())
                Spacer(Modifier.height(6.dp))
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                    SocialLink("X", Links.X)
                    SocialLink("Instagram", Links.INSTAGRAM)
                    SocialLink("LinkedIn", Links.LINKEDIN)
                }
                Spacer(Modifier.height(28.dp))
                Text(strings.disclaimer, style = BlType.small())
                Spacer(Modifier.height(10.dp))
                Text("${strings.version(appVersion)} · © Bluelytics", style = BlType.note())
            }
        }
        Spacer(Modifier.height(24.dp))
        Wordmark()
    }
}

@Composable
private fun SwitchPanel(controller: AlertsController, state: AlertsState, strings: Strings) {
    val scope = rememberCoroutineScope()
    val on = state.enabled
    val enabled = controller.supported && !state.busy
    val problem = when (state.problem) {
        AlertsProblem.denied -> strings.alertsDenied
        AlertsProblem.failed -> strings.alertsFailed
        null -> null
    }
    val toggle = { scope.launch { controller.setEnabled(!on) }; Unit }
    Panel {
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .pressable(if (enabled) toggle else null, minHeight = 48.dp)
                    .clearAndSetSemantics {
                        contentDescription = strings.alertsToggle
                        role = Role.Switch
                        toggleableState = ToggleableState(on)
                        stateDescription = if (on) strings.alertsOn else strings.alertsOff
                        if (enabled) onClick { toggle(); true } else disabled()
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(strings.alertsToggle, style = sans(17f, weight = 700, tracking = -0.02f, height = 1.2f))
                    Spacer(Modifier.height(4.dp))
                    Text((if (on) strings.alertsOn else strings.alertsOff).uppercase(), style = BlType.label(color = if (on) Bl.up else Bl.dim))
                }
                Spacer(Modifier.width(12.dp))
                Box(Modifier.alpha(if (controller.supported) (if (state.busy) 0.5f else 1f) else 0.35f)) { Switch(on) }
            }
            Spacer(Modifier.height(12.dp))
            Hairline()
            Spacer(Modifier.height(12.dp))
            Text(if (controller.supported) strings.alertsHelp else strings.alertsUnsupported, style = BlType.small(color = Bl.muted))
            if (problem != null) {
                Spacer(Modifier.height(10.dp))
                Text(problem, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, style = BlType.small(color = Bl.down))
            }
        }
    }
}

/** A square-cut switch, in the angular language of the rest of the interface. */
@Composable
private fun Switch(on: Boolean) {
    val time = tween<androidx.compose.ui.unit.Dp>(if (LocalReducedMotion.current) 0 else 160)
    val knob by animateDpAsState(if (on) 26.dp else 0.dp, time, label = "knob")
    val fill by animateColorAsState(if (on) Bl.brand else Bl.ink.copy(alpha = 0.6f), tween(if (LocalReducedMotion.current) 0 else 160), label = "fill")
    Box(
        Modifier
            .size(width = 54.dp, height = 30.dp)
            .background(fill, RoundedCornerShape(2.dp))
            .border(1.dp, if (on) Bl.brand else Bl.lineStrong, RoundedCornerShape(2.dp))
            .padding(3.dp),
    ) {
        Box(Modifier.offset { IntOffset(knob.roundToPx(), 0) }.size(22.dp).background(if (on) Bl.text else Bl.dim, RoundedCornerShape(1.dp)))
    }
}

@Composable
private fun LastAlert(alert: AlertInfo, strings: Strings) {
    val locale = strings.locale
    val move = Move.between(alert.current.sell, alert.previous?.sell)
    val direction = move?.direction ?: Direction.flat
    val title = when (direction) {
        Direction.up -> strings.alertRose
        Direction.down -> strings.alertFell
        Direction.flat -> strings.alertMoved
    }
    Column(
        Modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {}
            .edges(Bl.line, bottom = 1.dp)
            .padding(vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (direction != Direction.flat) {
                DirectionMark(direction, 10.dp, directionColor(direction))
                Spacer(Modifier.width(8.dp))
            }
            Text(title, style = sans(17f, weight = 700, tracking = -0.02f, height = 1.2f))
        }
        Spacer(Modifier.height(10.dp))
        Text(strings.sell.uppercase(), style = BlType.label())
        Spacer(Modifier.height(4.dp))
        Text(formatPesos(alert.current.sell, locale), style = sans(34f, weight = 800, tracking = -0.05f, height = 1.1f, tabular = true))
        if (move != null) {
            Spacer(Modifier.height(10.dp))
            MoveChip(move, locale)
        }
        Spacer(Modifier.height(10.dp))
        Text(formatDateTime(alert.at, locale), style = BlType.note())
    }
}

/** Opens a link in the browser (or the app that handles it). */
@Composable
private fun rememberOpener(): (String) -> Unit {
    val context = LocalContext.current
    return { url ->
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // No browser to hand the link to: nothing useful to do.
        }
    }
}

@Composable
private fun LinkRow(label: String, url: String, detail: String? = null) {
    val open = rememberOpener()
    Row(
        Modifier
            .fillMaxWidth()
            .pressable({ open(url) }, role = Role.Button, minHeight = 50.dp)
            .edges(Bl.line, bottom = 1.dp)
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = sans(15.5f, weight = 500, height = 1.25f))
        if (detail != null) {
            Text(detail, style = BlType.note())
            Spacer(Modifier.width(10.dp))
        }
        GlyphIcon(Glyph.external, 16.dp, Bl.brandInk, stroke = 1.4f)
    }
}

@Composable
private fun SocialLink(label: String, url: String) {
    val open = rememberOpener()
    Box(Modifier.pressable({ open(url) }), contentAlignment = Alignment.Center) {
        Text(label, style = sans(15.5f, weight = 600, color = Bl.brandInk, height = 1.25f))
    }
}
