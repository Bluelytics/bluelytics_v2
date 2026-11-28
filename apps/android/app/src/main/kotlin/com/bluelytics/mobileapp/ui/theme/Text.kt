package com.bluelytics.mobileapp.ui.theme

import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.AlignmentLine
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.layout.LayoutModifier
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.isSpecified
import kotlin.math.roundToInt
import androidx.compose.material3.Text as MaterialText

/**
 * Material's `Text` with CSS (and Flutter) line boxes. Compose spaces lines `lineHeight` apart, but
 * never makes the first line's box shorter than the font's own ascent and descent (about 1.3 em for
 * Geist): a figure set at `height: 0.9` would stand a third taller than on the site. Here a line
 * height below the font's is honoured, the difference split evenly above and below, so the glyphs
 * overhang their box exactly as they do in a browser.
 */
@Composable
fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    textAlign: TextAlign? = null,
    overflow: TextOverflow = TextOverflow.Clip,
    softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    style: TextStyle = LocalTextStyle.current,
) {
    MaterialText(
        text = text,
        modifier = modifier.lineBox(style),
        color = color,
        textAlign = textAlign,
        overflow = overflow,
        softWrap = softWrap,
        maxLines = maxLines,
        style = style,
    )
}

/** The same line box for other text, such as a text field set in `style`. */
@Composable
fun Modifier.lineBox(style: TextStyle): Modifier {
    val measurer = rememberTextMeasurer(cacheSize = 16)
    val density = LocalDensity.current
    // The same for any number of lines: only the first line keeps the font's full height.
    val excess = remember(style, density) {
        val lineHeight = style.lineHeight
        if (!lineHeight.isSpecified) {
            0
        } else {
            val natural = measurer.measure("Hg", style.copy(lineHeight = TextUnit.Unspecified), maxLines = 1, density = density).size.height
            (natural - with(density) { lineHeight.toPx() }).roundToInt().coerceAtLeast(0)
        }
    }
    return if (excess > 0) this.then(TrimLineBox(excess)) else this
}

/** Takes `excess` pixels off a text's height, half above and half below, intrinsics included. */
private class TrimLineBox(private val excess: Int) : LayoutModifier {
    override fun MeasureScope.measure(measurable: Measurable, constraints: Constraints): MeasureResult {
        val placeable = measurable.measure(constraints.copy(minHeight = 0))
        val cut = excess.coerceAtMost(placeable.height)
        val height = (placeable.height - cut).coerceIn(constraints.minHeight, constraints.maxHeight)
        val top = cut / 2
        val first = placeable[FirstBaseline]
        val last = placeable[LastBaseline]
        val lines = buildMap<AlignmentLine, Int> {
            if (first != AlignmentLine.Unspecified) put(FirstBaseline, first - top)
            if (last != AlignmentLine.Unspecified) put(LastBaseline, last - top)
        }
        return layout(placeable.width, height, lines) { placeable.place(0, -top) }
    }

    override fun IntrinsicMeasureScope.minIntrinsicHeight(measurable: IntrinsicMeasurable, width: Int): Int =
        (measurable.minIntrinsicHeight(width) - excess).coerceAtLeast(0)

    override fun IntrinsicMeasureScope.maxIntrinsicHeight(measurable: IntrinsicMeasurable, width: Int): Int =
        (measurable.maxIntrinsicHeight(width) - excess).coerceAtLeast(0)

    override fun IntrinsicMeasureScope.minIntrinsicWidth(measurable: IntrinsicMeasurable, height: Int): Int = measurable.minIntrinsicWidth(height)

    override fun IntrinsicMeasureScope.maxIntrinsicWidth(measurable: IntrinsicMeasurable, height: Int): Int = measurable.maxIntrinsicWidth(height)

    override fun equals(other: Any?) = other is TrimLineBox && other.excess == excess

    override fun hashCode() = excess
}
