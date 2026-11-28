/* The small pieces of the "Editorial Bold" look shared by every screen. */
package com.bluelytics.mobileapp.ui.widgets

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ripple
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick as semanticsOnClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.domain.Move
import com.bluelytics.mobileapp.domain.formatSignedAmount
import com.bluelytics.mobileapp.domain.formatSignedPercent
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.mono
import com.bluelytics.mobileapp.ui.theme.sans
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import kotlin.math.tan

/** Whether the system asks for reduced motion (animations off): loops stop and entrances are skipped. */
val LocalReducedMotion = staticCompositionLocalOf { false }

/** The site's easing for entrances: `cubic-bezier(.2, .7, .2, 1)`. */
val EaseOut = CubicBezierEasing(0.2f, 0.7f, 0.2f, 1f)

fun directionColor(direction: Direction, flat: Color = Bl.soft): Color = when (direction) {
    Direction.up -> Bl.up
    Direction.down -> Bl.down
    Direction.flat -> flat
}

/** The page background: ink with two soft glows at the top and a faint rule every 64 dp. */
fun Modifier.blBackground(): Modifier = drawBehind {
    drawRect(Bl.ink)
    val shortest = size.minDimension
    fun glow(ax: Float, ay: Float, radius: Float, color: Color) {
        // Flutter's RadialGradient: centre by alignment, radius a fraction of the shortest side.
        val center = Offset(size.width / 2 * (1 + ax), size.height / 2 * (1 + ay))
        drawRect(Brush.radialGradient(0f to color, 0.7f to color.copy(alpha = 0f), center = center, radius = radius * shortest))
    }
    glow(-0.64f, -1.1f, 0.95f, Bl.navy.copy(alpha = 0.95f))
    glow(1f, -1f, 0.7f, Bl.brandDeep.copy(alpha = 0.16f))
    val rule = Bl.brandInk.copy(alpha = 0.035f)
    val step = 64.dp.toPx()
    var y = 0.5f
    while (y < size.height) {
        drawLine(rule, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
        y += step
    }
}

/** Centres a screen's column and keeps it readable on tablets. */
@Composable
fun ContentWidth(modifier: Modifier = Modifier, padded: Boolean = true, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Box(
            Modifier
                .widthIn(max = Bl.maxWidth)
                .fillMaxWidth()
                .padding(horizontal = if (padded) Bl.gutter else 0.dp),
        ) { content() }
    }
}

/** A 1 dp rule. */
@Composable
fun Hairline(modifier: Modifier = Modifier, strong: Boolean = false) {
    Box(modifier.fillMaxWidth().height(1.dp).background(if (strong) Bl.lineStrong else Bl.line))
}

/** A vertical 1 dp rule; give it a height or use it in a row of intrinsic height. */
@Composable
fun VerticalHairline(modifier: Modifier = Modifier) {
    Box(modifier.width(1.dp).background(Bl.line))
}

/** Lines drawn along some edges of a box, in the manner of CSS borders. */
fun Modifier.edges(
    color: Color,
    top: Dp = 0.dp,
    bottom: Dp = 0.dp,
    left: Dp = 0.dp,
    bottomColor: Color = color,
    leftColor: Color = color,
): Modifier = drawBehind {
    if (top > 0.dp) drawRect(color, size = size.copy(height = top.toPx()))
    if (bottom > 0.dp) {
        val h = bottom.toPx()
        drawRect(bottomColor, topLeft = Offset(0f, size.height - h), size = size.copy(height = h))
    }
    if (left > 0.dp) drawRect(leftColor, size = size.copy(width = left.toPx()))
}

/** A hairline panel: no soft card, no shadow. */
@Composable
fun Panel(modifier: Modifier = Modifier, padding: PaddingValues = PaddingValues(16.dp), content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(Bl.radius)
    Box(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.verticalGradient(listOf(Bl.navy.copy(alpha = 0.5f), Bl.surface.copy(alpha = 0.5f))))
            .border(1.dp, Bl.line, shape)
            .padding(padding),
    ) { content() }
}

/** A section title with the slanted blade tick in front. */
@Composable
fun SectionHead(title: String, modifier: Modifier = Modifier, note: String? = null) {
    Column(modifier) {
        Row(Modifier.semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(width = 18.dp, height = 4.5.dp)) {
                // A parallelogram leaning 32°: the blade's tick.
                val skew = tan(Math.toRadians(32.0)).toFloat() * size.height / 2
                val path = androidx.compose.ui.graphics.Path().apply {
                    moveTo(skew, 0f)
                    lineTo(size.width + skew, 0f)
                    lineTo(size.width - skew, size.height)
                    lineTo(-skew, size.height)
                    close()
                }
                drawPath(path, Brush.horizontalGradient(listOf(Bl.brandDeep, Bl.brand)))
            }
            Spacer(Modifier.width(10.dp))
            Text(title, style = BlType.h2())
        }
        if (note != null) {
            Spacer(Modifier.height(6.dp))
            Text(note, style = BlType.small())
        }
    }
}

/** The up/down triangle that goes with every move, so colour is never the only cue. */
@Composable
fun DirectionMark(direction: Direction, size: Dp, color: Color, modifier: Modifier = Modifier) {
    if (direction == Direction.flat) return
    Canvas(modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val path = androidx.compose.ui.graphics.Path().apply {
            if (direction == Direction.up) {
                moveTo(w / 2, h * 0.1f); lineTo(w * 0.95f, h * 0.9f); lineTo(w * 0.05f, h * 0.9f)
            } else {
                moveTo(w / 2, h * 0.9f); lineTo(w * 0.05f, h * 0.1f); lineTo(w * 0.95f, h * 0.1f)
            }
            close()
        }
        drawPath(path, color)
    }
}

/** The social cards' diagonal-cut block with the day's move: `▲ +30 │ +1,83 %`. */
@Composable
fun MoveSlab(move: Move, locale: AppLocale) {
    val style = mono(16.5f, weight = 700, color = Bl.ink, tracking = -0.01f, height = 1f)
    val delta = formatSignedAmount(move.delta, locale)
    val percent = formatSignedPercent(move.ratio, locale, 2)
    val cut = with(LocalDensity.current) { 16.dp.toPx() }
    val shape = remember(cut) {
        GenericShape { size, _ ->
            moveTo(0f, 0f)
            lineTo(size.width, 0f)
            lineTo(size.width - cut, size.height)
            lineTo(0f, size.height)
            close()
        }
    }
    Row(
        Modifier
            .clearAndSetSemantics { contentDescription = "$delta, $percent" }
            .clip(shape)
            .background(directionColor(move.direction))
            .padding(start = 14.dp, top = 10.dp, end = 28.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (move.direction != Direction.flat) {
            DirectionMark(move.direction, 11.dp, Bl.ink)
            Spacer(Modifier.width(10.dp))
        }
        Text(delta, style = style, maxLines = 1)
        Spacer(Modifier.width(11.dp))
        Box(Modifier.size(width = 1.dp, height = 18.dp).background(Bl.ink.copy(alpha = 0.35f)))
        Spacer(Modifier.width(11.dp))
        Text(percent, style = style, maxLines = 1)
    }
}

/** The compact inline form of a move: `▲ +10 (+0,62 %)`. */
@Composable
fun MoveChip(move: Move, locale: AppLocale) {
    val color = directionColor(move.direction)
    val background = when (move.direction) {
        Direction.up -> Bl.upBg
        Direction.down -> Bl.downBg
        Direction.flat -> Bl.flatBg
    }
    val text = "${formatSignedAmount(move.delta, locale)} (${formatSignedPercent(move.ratio, locale, 2)})"
    Row(
        Modifier
            .clearAndSetSemantics { contentDescription = text }
            .background(background, RoundedCornerShape(2.dp))
            .padding(horizontal = 7.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (move.direction != Direction.flat) {
            DirectionMark(move.direction, 8.dp, color)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = mono(12f, weight = 600, color = color, height = 1.2f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The dot in front of the "updated" stamp: pulsing green when live, still amber when not. */
@Composable
fun LiveDot(live: Boolean) {
    val color = if (live) Bl.up else Bl.warn
    val animate = live && !LocalReducedMotion.current
    val pulse = if (animate) {
        val transition = rememberInfiniteTransition(label = "pulse")
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Restart), label = "pulse").value
    } else {
        null
    }
    Canvas(Modifier.size(7.dp)) {
        val r = 3.5.dp.toPx()
        if (pulse != null && pulse < 0.7f) {
            val spread = pulse / 0.7f
            drawCircle(color.copy(alpha = 0.6f * (1 - spread)), radius = r + 8.dp.toPx() * spread)
        }
        drawCircle(color, radius = r)
    }
}

/** Entrance: the content rises 14 dp while fading in, after `delayMillis`. Skipped with reduced motion. */
@Composable
fun Rise(delayMillis: Int = 0, content: @Composable () -> Unit) {
    val still = LocalReducedMotion.current
    val progress = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (progress.value >= 1f) return@LaunchedEffect
        delay(delayMillis.toLong())
        progress.animateTo(1f, tween(700, easing = EaseOut))
    }
    val rise = with(LocalDensity.current) { 14.dp.toPx() }
    Box(
        Modifier.graphicsLayer {
            val t = progress.value
            alpha = 0.2f + 0.8f * t
            translationY = rise * (1 - t)
        },
    ) { content() }
}

/**
 * A pressable area with the platform's ripple; at least 44 dp tall for touch. With a `label`, that is
 * all TalkBack reads (the children are replaced); without, the children are merged.
 */
fun Modifier.pressable(
    onClick: (() -> Unit)?,
    label: String? = null,
    selected: Boolean? = null,
    role: Role = Role.Button,
    minHeight: Dp = 44.dp,
): Modifier = this
    .then(
        if (label != null) {
            Modifier.clearAndSetSemantics {
                contentDescription = label
                this.role = role
                if (selected != null) this.selected = selected
                if (onClick != null) {
                    semanticsOnClick { onClick(); true }
                }
            }
        } else {
            Modifier
        },
    )
    .then(
        if (onClick != null) {
            Modifier.clickable(interactionSource = null, indication = ripple(color = Bl.brandInk), role = role, onClick = onClick)
        } else {
            Modifier
        },
    )
    .then(if (selected != null && label == null) Modifier.semantics { this.selected = selected } else Modifier)
    .heightIn(min = minHeight)

/** The segmented control of the site (`.seg`, `.ranges`): mono caps in a hairline box. */
@Composable
fun <T> Segmented(values: List<T>, selected: T, labelOf: (T) -> String, onChange: (T) -> Unit, label: String? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { if (label != null) contentDescription = label }
            .border(1.dp, Bl.lineStrong, RoundedCornerShape(2.dp))
            .clip(RoundedCornerShape(1.dp)),
    ) {
        values.forEachIndexed { i, value ->
            val active = value == selected
            Box(
                Modifier
                    .weight(1f)
                    .background(if (active) Bl.brand.copy(alpha = 0.22f) else Color.Transparent)
                    .edges(Bl.line, left = if (i == 0) 0.dp else 1.dp, bottom = 2.dp, bottomColor = if (active) Bl.brand else Color.Transparent)
                    .pressable({ onChange(value) }, label = labelOf(value), selected = active, role = Role.Tab, minHeight = 40.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    labelOf(value).uppercase(),
                    modifier = Modifier.padding(horizontal = 10.dp),
                    maxLines = 1,
                    style = mono(11.5f, weight = if (active) 600 else 500, color = if (active) Bl.text else Bl.dim, tracking = 0.1f, height = 1f),
                )
            }
        }
    }
}

/** The site footer's outlined wordmark, running off the edge: the last thing on a screen. */
@Composable
fun Wordmark() {
    val fontScale = LocalDensity.current.fontScale
    Box(
        Modifier
            .fillMaxWidth()
            .height(92.dp)
            .clearAndSetSemantics { },
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            "bluelytics",
            modifier = Modifier
                .padding(start = Bl.gutter)
                .wrapUnbounded(),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Visible,
            // Not scaled with the system text size: it is a drawing, not text to read.
            style = sans(104f / fontScale, weight = 800, tracking = -0.025f, height = 1f).copy(color = Bl.lineStrong, drawStyle = Stroke(width = 1f * LocalDensity.current.density)),
        )
    }
}

/** Lets a child be as wide as it likes; the parent clips nothing, the window does. */
private fun Modifier.wrapUnbounded(): Modifier = this.then(
    Modifier.layout { measurable, constraints ->
        val placeable = measurable.measure(constraints.copy(minWidth = 0, maxWidth = Constraints.Infinity))
        layout(constraints.maxWidth.coerceAtMost(placeable.width), placeable.height) { placeable.placeRelative(0, 0) }
    },
)

/**
 * Flutter's `FittedBox(fit: scaleDown)`: the content keeps its natural size, and when that is wider
 * than the space it is scaled down as a whole (large figures at the largest text size).
 */
@Composable
fun ScaleDown(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Layout(content, modifier, ScaleDownPolicy)
}

private object ScaleDownPolicy : MeasurePolicy {
    override fun MeasureScope.measure(measurables: List<Measurable>, constraints: Constraints): MeasureResult {
        val placeable = measurables.first().measure(Constraints(maxHeight = constraints.maxHeight))
        val maxWidth = constraints.maxWidth
        val scale = if (maxWidth != Constraints.Infinity && placeable.width > maxWidth) maxWidth.toFloat() / placeable.width else 1f
        val width = (placeable.width * scale).roundToInt().coerceIn(constraints.minWidth, maxWidth)
        val height = (placeable.height * scale).roundToInt().coerceIn(constraints.minHeight, constraints.maxHeight)
        return layout(width, height) {
            placeable.placeWithLayer(0, 0) {
                scaleX = scale
                scaleY = scale
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f)
            }
        }
    }

    // The content is laid out on one unbounded line and only ever shrinks: its natural height is
    // the most it needs at any width. (The default would measure it squeezed into `width`.)
    override fun IntrinsicMeasureScope.minIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
        measurables.first().maxIntrinsicHeight(Constraints.Infinity)

    override fun IntrinsicMeasureScope.maxIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
        measurables.first().maxIntrinsicHeight(Constraints.Infinity)

    override fun IntrinsicMeasureScope.minIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int = 0

    override fun IntrinsicMeasureScope.maxIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int =
        measurables.first().maxIntrinsicWidth(height)
}

/** A text that shrinks as a whole when it does not fit its line. */
@Composable
fun FitText(text: String, style: TextStyle, modifier: Modifier = Modifier) {
    ScaleDown(modifier) { Text(text, style = style, maxLines = 1, softWrap = false) }
}
