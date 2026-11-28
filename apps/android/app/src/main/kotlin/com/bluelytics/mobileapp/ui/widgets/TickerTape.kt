/*
 * A market tape with every published rate, scrolling like a trading-floor board (the site's
 * `Ticker.astro`). It is an endless horizontal list moved frame by frame: it can be dragged, it
 * waits while a finger is on it, and with reduced motion it only moves when dragged.
 */
package com.bluelytics.mobileapp.ui.widgets

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.mono

class TapeItem(val label: String, val value: String, val direction: Direction? = null, val change: String? = null) {
    val spoken: String get() = if (change == null) "$label $value" else "$label $value, $change"
}

/** Pixels (dp) per second. */
private const val SPEED = 34f

@Composable
fun TickerTape(items: List<TapeItem>, label: String) {
    if (items.isEmpty()) return
    val state = rememberLazyListState()
    var fingers by remember { mutableStateOf(false) }
    val still = LocalReducedMotion.current
    val speed = with(LocalDensity.current) { SPEED.dp.toPx() }
    if (!still) {
        LaunchedEffect(state) {
            var last = 0L
            while (true) {
                withFrameNanos { now ->
                    val dt = if (last == 0L) 0f else (now - last) / 1e9f
                    last = now
                    // A fling after a drag keeps its momentum; the tape resumes when it comes to rest.
                    if (!fingers && !state.isScrollInProgress && dt > 0 && dt < 0.5f) state.dispatchRawDelta(speed * dt)
                }
            }
        }
    }
    LazyRow(
        state = state,
        modifier = Modifier
            .fillMaxWidth()
            .height(38.dp)
            .background(Bl.navy.copy(alpha = 0.45f))
            .edges(Bl.line, bottom = 1.dp)
            .clearAndSetSemantics { contentDescription = "$label: ${items.joinToString("; ") { it.spoken }}" }
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    fingers = true
                    waitForUpOrCancellation(PointerEventPass.Initial)
                    fingers = false
                }
            },
        contentPadding = PaddingValues(start = Bl.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(count = Int.MAX_VALUE) { index -> TapeCell(items[index % items.size]) }
    }
}

@Composable
private fun TapeCell(item: TapeItem) {
    val direction = item.direction ?: Direction.flat
    val changeColor = directionColor(direction, flat = Bl.dim)
    Row(Modifier.padding(end = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(item.label.uppercase(), style = mono(11f, weight = 500, color = Bl.dim, tracking = 0.1f, height = 1f), maxLines = 1)
        Spacer(Modifier.width(10.dp))
        Text(item.value, style = mono(12.5f, weight = 600, color = Bl.text, height = 1f), maxLines = 1)
        if (item.change != null) {
            Spacer(Modifier.width(10.dp))
            if (direction != Direction.flat) {
                DirectionMark(direction, 7.dp, changeColor)
                Spacer(Modifier.width(5.dp))
            }
            Text(item.change, style = mono(11.5f, weight = 500, color = changeColor, height = 1f), maxLines = 1)
        }
        Spacer(Modifier.width(18.dp))
        Text("/", style = mono(12.5f, weight = 500, color = Bl.lineStrong, height = 1f))
    }
}
