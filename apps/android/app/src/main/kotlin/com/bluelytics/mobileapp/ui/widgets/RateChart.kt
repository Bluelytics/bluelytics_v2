/*
 * Line chart of the daily series: blue and official sell, or the gap between them. Touch, drag
 * sideways or press and hold to read any day; the line above the plot is both legend and readout.
 */
package com.bluelytics.mobileapp.ui.widgets

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.ChartMode
import com.bluelytics.mobileapp.domain.DayRates
import com.bluelytics.mobileapp.domain.LineKey
import com.bluelytics.mobileapp.domain.buildChart
import com.bluelytics.mobileapp.domain.formatDay
import com.bluelytics.mobileapp.domain.formatPercent
import com.bluelytics.mobileapp.domain.formatPesos
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.mono
import kotlinx.coroutines.delay
import kotlin.math.ceil
import kotlin.math.roundToInt
import kotlin.math.roundToLong

fun lineColor(key: LineKey): Color = when (key) {
    LineKey.blue -> Bl.lineBlue
    LineKey.oficial -> Bl.lineOficial
    LineKey.gap -> Bl.lineGap
}

/** At most this many vertices per drawn line; the readout still reads every day. */
private const val MAX_VERTICES = 480

/** The days a chart shows, for tests: oldest first. */
const val CHART_TAG = "rate-chart"

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RateChart(
    days: List<DayRates>,
    mode: ChartMode,
    locale: AppLocale,
    lineNames: Map<LineKey, String>,
    emptyText: String,
    height: Dp = 220.dp,
    xTickCount: Int = 4,
) {
    val model = remember(days, mode, locale, xTickCount) { buildChart(days, mode, locale, xTickCount) }
    var scrub by remember(model) { mutableStateOf<Int?>(null) }
    var released by remember(model) { mutableIntStateOf(0) }
    val haptics = LocalHapticFeedback.current

    if (model.isEmpty) {
        Box(Modifier.fillMaxWidth().height(height), contentAlignment = Alignment.Center) { Text(emptyText, style = BlType.small()) }
        return
    }

    // The reading stays a moment after the finger lifts, then the chart goes back to the last day.
    LaunchedEffect(released) {
        if (released == 0) return@LaunchedEffect
        delay(3000)
        scrub = null
    }

    fun scrubTo(x: Float, width: Float) {
        val count = model.days.size
        if (count == 0 || width <= 0) return
        val index = if (count == 1) 0 else ((x / width) * (count - 1)).roundToInt().coerceIn(0, count - 1)
        released = 0
        if (index == scrub) return
        haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
        scrub = index
    }

    fun letGo() {
        released++
    }

    val shown: Int? = scrub ?: (model.days.indices.reversed().firstOrNull { i -> model.lines.any { it.values[i] != null } })
    val day = shown?.let { model.days[it] }
    fun valueText(value: Double) = if (model.mode == ChartMode.gap) formatPercent(value / 100, locale) else formatPesos((value * 100).roundToLong(), locale)
    val entries = model.lines.map { Triple(it.key, lineNames[it.key] ?: it.key.name, shown?.let { i -> it.values[i] }) }
    val spoken = buildList {
        if (day != null) add(formatDay(day, locale))
        for ((_, name, value) in entries) if (value != null) add("$name ${valueText(value)}")
    }.joinToString(", ")

    Column(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken; testTag = CHART_TAG }) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (day != null) {
                Text(formatDay(day, locale, short = true), style = mono(12.5f, weight = 500, color = if (scrub == null) Bl.dim else Bl.text, height = 1.4f))
            }
            for ((key, name, value) in entries) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(width = 10.dp, height = 3.dp).background(lineColor(key)))
                    Spacer(Modifier.width(6.dp))
                    Text(name, style = mono(12.5f, weight = 500, color = lineColor(key), height = 1.4f))
                    Spacer(Modifier.width(6.dp))
                    Text(if (value == null) "–" else valueText(value), style = mono(12.5f, weight = 600, color = Bl.text, height = 1.4f))
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        val measurer = rememberTextMeasurer()
        val tickStyle = mono(10.5f, weight = 500, color = Bl.dim, height = 1f)
        val currentScrub by rememberUpdatedState(scrub)
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val widthPx = constraints.maxWidth.toFloat()
            Canvas(
                Modifier
                    .fillMaxWidth()
                    .height(height)
                    .pointerInput(model, widthPx) {
                        detectTapGestures(onPress = { offset ->
                            scrubTo(offset.x, widthPx)
                            tryAwaitRelease()
                            letGo()
                        })
                    }
                    .pointerInput(model, widthPx) {
                        detectHorizontalDragGestures(
                            onDragStart = { scrubTo(it.x, widthPx) },
                            onDragEnd = { letGo() },
                            onDragCancel = { letGo() },
                        ) { change, _ -> scrubTo(change.position.x, widthPx) }
                    }
                    .pointerInput(model, widthPx) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { scrubTo(it.x, widthPx) },
                            onDragEnd = { letGo() },
                            onDragCancel = { letGo() },
                        ) { change, _ -> scrubTo(change.position.x, widthPx) }
                    },
            ) {
                val w = size.width
                val h = size.height
                val px = 1.dp.toPx()
                for (tick in model.yTicks) {
                    val y = (tick.pos * h).roundToInt() + 0.5f
                    drawLine(Bl.line, Offset(0f, y), Offset(w, y), strokeWidth = px)
                }
                val count = model.days.size
                val stride = ceil(count.toDouble() / MAX_VERTICES).toInt().coerceIn(1, count)
                for (line in model.lines) {
                    val color = lineColor(line.key)
                    val path = Path()
                    var first: Offset? = null
                    var last: Offset? = null
                    var pen = false
                    for (i in 0 until count) {
                        // Every `stride`-th day, and always the last one so the line ends on today.
                        if (i % stride != 0 && i != count - 1) continue
                        val value = line.values[i]
                        if (value == null) {
                            pen = false
                            continue
                        }
                        val point = Offset((model.xPos(i) * w).toFloat(), (model.yPos(value) * h).toFloat())
                        if (pen) path.lineTo(point.x, point.y) else path.moveTo(point.x, point.y)
                        pen = true
                        if (first == null) first = point
                        last = point
                    }
                    if (first == null || last == null) continue
                    // The leading line (blue, or the gap) sits on a soft wash down to the axis.
                    if (line.key != LineKey.oficial && first != last) {
                        val area = Path().apply {
                            addPath(path)
                            lineTo(last.x, h)
                            lineTo(first.x, h)
                            close()
                        }
                        drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = 0.2f), color.copy(alpha = 0f)), startY = 0f, endY = h))
                    }
                    drawPath(path, color, style = Stroke(width = 2 * px, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    if (currentScrub == null) drawCircle(color, radius = 3 * px, center = last)
                }
                // Axis labels go over the lines, on a patch of the background so both stay readable.
                for (tick in model.yTicks) {
                    val y = (tick.pos * h).roundToInt() + 0.5f
                    val label = measurer.measure(tick.label, tickStyle)
                    val at = Offset(0f, y - label.size.height - 4 * px)
                    drawRect(Bl.ink.copy(alpha = 0.72f), topLeft = Offset(at.x - 2 * px, at.y - 2 * px), size = Size(label.size.width + 8 * px, label.size.height + 4 * px))
                    drawText(label, topLeft = at)
                }
                val index = currentScrub
                if (index != null && index < count) {
                    val x = (model.xPos(index) * w).toFloat()
                    drawLine(Bl.lineStrong, Offset(x, 0f), Offset(x, h), strokeWidth = px)
                    for (line in model.lines) {
                        val value = line.values[index] ?: continue
                        val point = Offset(x, (model.yPos(value) * h).toFloat())
                        drawCircle(Bl.ink, radius = 5.5f * px, center = point)
                        drawCircle(lineColor(line.key), radius = 3.5f * px, center = point)
                    }
                }
            }
        }
        // The x axis: each label centred on its day, kept inside the plot.
        Layout(
            content = { for (tick in model.xTicks) Text(tick.label, style = tickStyle, maxLines = 1) },
            modifier = Modifier.fillMaxWidth().height(26.dp),
        ) { measurables, constraints ->
            val placeables = measurables.map { it.measure(constraints.copy(minWidth = 0, minHeight = 0)) }
            val width = constraints.maxWidth
            val height26 = constraints.maxHeight
            layout(width, height26) {
                placeables.forEachIndexed { i, placeable ->
                    // Flutter's Alignment(pos * 2 - 1, 0): the label slides from flush left to flush right.
                    val pos = model.xTicks[i].pos
                    val x = ((width - placeable.width) * pos).roundToInt()
                    placeable.place(x, (height26 - placeable.height) / 2)
                }
            }
        }
    }
}
