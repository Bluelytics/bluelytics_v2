/* Geist for text and figures, Geist Mono for labels and tabular numbers. Both are variable fonts: the
 * weight is set on the `wght` axis, so every weight below is a real cut, not synthetic bold. */
package com.bluelytics.mobileapp.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.bluelytics.mobileapp.R

/** Every weight the interface uses. */
private val sansWeights = listOf(400, 500, 600, 700, 750, 800)
private val monoWeights = listOf(500, 600, 700)

private fun variable(resource: Int, weights: List<Int>) = FontFamily(
    weights.map { weight ->
        Font(resource, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))
    },
)

val Geist: FontFamily = variable(R.font.geist, sansWeights)
val GeistMono: FontFamily = variable(R.font.geist_mono, monoWeights)

/** The nearest weight there is a cut for. */
private fun snap(weight: Int, available: List<Int>) = available.minBy { kotlin.math.abs(it - weight) }

/** CSS-like line boxes: the extra leading is split evenly above and below, as on the site. */
private val evenLeading = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None, LineHeightStyle.Mode.Fixed)

private fun style(family: FontFamily, weights: List<Int>, size: Float, weight: Int, color: Color, tracking: Float, height: Float?, tabular: Boolean) =
    TextStyle(
        fontFamily = family,
        fontSize = size.sp,
        fontWeight = FontWeight(snap(weight, weights)),
        color = color,
        letterSpacing = tracking.em,
        lineHeight = if (height != null) (size * height).sp else TextStyle.Default.lineHeight,
        lineHeightStyle = evenLeading,
        fontFeatureSettings = if (tabular) "tnum" else null,
    )

/** Geist. `tracking` is in em (CSS `letter-spacing: -0.04em`), `height` a line-height multiple. */
fun sans(size: Float, weight: Int = 400, color: Color = Bl.text, tracking: Float = 0f, height: Float? = null, tabular: Boolean = false) =
    style(Geist, sansWeights, size, weight, color, tracking, height, tabular)

/** Geist Mono (digits are tabular by design). */
fun mono(size: Float, weight: Int = 500, color: Color = Bl.text, tracking: Float = 0f, height: Float? = null) =
    style(GeistMono, monoWeights, size, weight, color, tracking, height, false)

object BlType {
    /** The small uppercase mono label over every figure. Write the text in upper case. */
    fun label(color: Color = Bl.dim) = mono(11f, weight = 500, color = color, tracking = 0.14f, height = 1.3f)

    fun body(color: Color = Bl.soft) = sans(15f, color = color, height = 1.5f)

    fun small(color: Color = Bl.dim) = sans(13f, color = color, height = 1.45f)

    /** Screen titles. */
    fun h1() = sans(34f, weight = 800, tracking = -0.05f, height = 1.05f)

    /** Section titles (with the blade tick, see `SectionHead`). */
    fun h2() = sans(21f, weight = 800, tracking = -0.035f, height = 1.15f)

    /** Mono caption under figures. */
    fun note(color: Color = Bl.dim) = mono(11.5f, weight = 500, color = color, tracking = 0.04f, height = 1.3f)
}
