/*
 * History: the daily series since 2011 as a chart with range presets, a summary of the period and
 * the days themselves, newest first.
 */
package com.bluelytics.mobileapp.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.ChartMode
import com.bluelytics.mobileapp.domain.DayRates
import com.bluelytics.mobileapp.domain.LineKey
import com.bluelytics.mobileapp.domain.PeriodSummary
import com.bluelytics.mobileapp.domain.RangePreset
import com.bluelytics.mobileapp.domain.formatAmount
import com.bluelytics.mobileapp.domain.formatDay
import com.bluelytics.mobileapp.domain.formatDayNumeric
import com.bluelytics.mobileapp.domain.formatPercent
import com.bluelytics.mobileapp.domain.formatPesos
import com.bluelytics.mobileapp.domain.formatSignedPercent
import com.bluelytics.mobileapp.domain.gapRatio
import com.bluelytics.mobileapp.domain.rangeOf
import com.bluelytics.mobileapp.i18n.Strings
import com.bluelytics.mobileapp.ui.LocalApp
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.mono
import com.bluelytics.mobileapp.ui.theme.sans
import com.bluelytics.mobileapp.ui.widgets.ContentWidth
import com.bluelytics.mobileapp.ui.widgets.FitText
import com.bluelytics.mobileapp.ui.widgets.Hairline
import com.bluelytics.mobileapp.ui.widgets.Panel
import com.bluelytics.mobileapp.ui.widgets.RateChart
import com.bluelytics.mobileapp.ui.widgets.SectionHead
import com.bluelytics.mobileapp.ui.widgets.Segmented
import com.bluelytics.mobileapp.ui.widgets.VerticalHairline
import com.bluelytics.mobileapp.ui.widgets.directionColor
import com.bluelytics.mobileapp.ui.widgets.edges

const val HISTORY_LIST_TAG = "history-list"

/** `mode` is owned by the shell, so the Today tiles can open this screen on the gap. */
@Composable
fun HistoryScreen(strings: Strings, mode: ChartMode, onModeChange: (ChartMode) -> Unit) {
    val store = LocalApp.current.store
    val state by store.state.collectAsStateWithLifecycle()
    var range by rememberSaveable { mutableStateOf(RangePreset.y1) }
    val locale = strings.locale
    // The window is recomputed only when the series or the preset changes: the chart keeps its
    // reading while unrelated store updates pass by.
    val days = remember(state.series, range) { rangeOf(state.series, range) }
    val summary = remember(days) { PeriodSummary.of(days) }
    // Presets longer than the recent days need the full history, which arrives a moment later.
    val waiting = !state.hasFullSeries && state.loading

    LazyColumn(Modifier.fillMaxSize().testTag(HISTORY_LIST_TAG), state = rememberLazyListState(), contentPadding = PaddingValues(bottom = 40.dp)) {
        item(key = "head") {
            ContentWidth {
                Column {
                    Spacer(Modifier.height(24.dp))
                    Text(strings.historyTitle, Modifier.semantics { heading() }, style = BlType.h1())
                    Spacer(Modifier.height(8.dp))
                    Text(strings.historyLead, style = BlType.body())
                    Spacer(Modifier.height(20.dp))
                    Segmented(ChartMode.entries, mode, { if (it == ChartMode.rates) strings.modeRates else strings.modeGap }, onModeChange, strings.chartOf)
                    Spacer(Modifier.height(10.dp))
                    Segmented(RangePreset.entries, range, { strings.rangeLabel(it.name) }, { range = it }, strings.range)
                    Spacer(Modifier.height(18.dp))
                    Panel(padding = PaddingValues(start = 14.dp, top = 14.dp, end = 14.dp)) {
                        RateChart(
                            days = days,
                            mode = mode,
                            locale = locale,
                            lineNames = mapOf(LineKey.blue to strings.blueShort, LineKey.oficial to strings.oficialShort, LineKey.gap to strings.gap),
                            emptyText = if (waiting) strings.loadingHistory else strings.noData,
                            height = 240.dp,
                        )
                    }
                    if (waiting) {
                        Spacer(Modifier.height(10.dp))
                        Text(strings.loadingHistory, style = BlType.note())
                    }
                    if (summary != null) {
                        Spacer(Modifier.height(24.dp))
                        Summary(summary, strings)
                    }
                    Spacer(Modifier.height(36.dp))
                    SectionHead(strings.dayByDay, note = summary?.let { strings.daysCount(it.days) })
                    Spacer(Modifier.height(14.dp))
                    Hairline(strong = true)
                    DayRow(listOf(strings.date, strings.blueShort, strings.oficialSellHead, strings.gap).map { it.uppercase() }, head = true)
                }
            }
        }
        // Newest first.
        items(days.asReversed(), key = { it.day }) { day -> ContentWidth { DayRow(cellsOf(day, locale), head = false) } }
    }
}

private fun cellsOf(d: DayRates, locale: AppLocale): List<String> {
    val gap = gapRatio(d.blue?.sell, d.oficial?.sell)
    return listOf(
        formatDayNumeric(d.day, locale, withYear = true),
        d.blue?.let { formatAmount(it.sell, locale) } ?: "–",
        d.oficial?.let { formatAmount(it.sell, locale) } ?: "–",
        gap?.let { formatPercent(it, locale) } ?: "–",
    )
}

/** Change, low, high and the current gap of the period, as a 2×2 ledger. */
@Composable
private fun Summary(summary: PeriodSummary, strings: Strings) {
    val locale = strings.locale
    val change = summary.change
    val gap = gapRatio(summary.last.blue?.sell, summary.last.oficial?.sell)

    @Composable
    fun Cell(label: String, value: String, foot: String?, modifier: Modifier, color: Color = Bl.text, left: Boolean = true) {
        Column(modifier.padding(start = if (left) 0.dp else 16.dp, top = 12.dp, end = if (left) 12.dp else 0.dp, bottom = 14.dp).semantics(mergeDescendants = true) {}) {
            Text(label.uppercase(), style = BlType.label())
            Spacer(Modifier.height(4.dp))
            FitText(value, sans(24f, weight = 700, color = color, tracking = -0.04f, height = 1.15f, tabular = true))
            if (foot != null) {
                Spacer(Modifier.height(4.dp))
                Text(foot, style = BlType.note())
            }
        }
    }

    Column(Modifier.fillMaxWidth().edges(Bl.lineStrong, top = 1.dp)) {
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).edges(Bl.line, bottom = 1.dp)) {
            Cell(
                strings.change,
                change?.let { formatSignedPercent(it.ratio, locale) } ?: "–",
                change?.let { "${formatPesos(summary.first.blue!!.sell, locale)} → ${formatPesos(summary.last.blue!!.sell, locale)}" },
                Modifier.weight(1f),
                color = change?.let { directionColor(it.direction, flat = Bl.text) } ?: Bl.text,
            )
            VerticalHairline(Modifier.fillMaxHeight())
            Cell(strings.gapNow, gap?.let { formatPercent(it, locale) } ?: "–", strings.gapFoot, Modifier.weight(1f), left = false)
        }
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).edges(Bl.line, bottom = 1.dp)) {
            Cell(strings.lowest, formatPesos(summary.min.blue!!.sell, locale), formatDay(summary.min.day, locale, short = true), Modifier.weight(1f))
            VerticalHairline(Modifier.fillMaxHeight())
            Cell(strings.highest, formatPesos(summary.max.blue!!.sell, locale), formatDay(summary.max.day, locale, short = true), Modifier.weight(1f), left = false)
        }
    }
}

/** One day of the table: date, blue sell, official sell and the gap. */
@Composable
private fun DayRow(cells: List<String>, head: Boolean) {
    val style = if (head) BlType.label() else mono(13f, weight = 500, color = Bl.text, height = 1.3f)
    Row(
        Modifier
            .fillMaxWidth()
            .edges(if (head) Bl.lineStrong else Bl.line, bottom = 1.dp)
            .padding(vertical = 10.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(cells[0], Modifier.weight(5f), style = if (head) style else mono(13f, weight = 500, color = Bl.soft, height = 1.3f))
        Text(cells[1], Modifier.weight(4f), textAlign = TextAlign.End, style = style)
        Text(cells[2], Modifier.weight(4f), textAlign = TextAlign.End, style = style)
        Text(cells[3], Modifier.weight(4f), textAlign = TextAlign.End, style = if (head) style else mono(13f, weight = 500, color = Bl.muted, height = 1.3f))
    }
}
