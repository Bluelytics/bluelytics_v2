/* Every icon in the app, drawn as strokes in a 24×24 box: the line weight matches the hairline look
 * of the rest of the interface, and no icon font ships with the app. */
package com.bluelytics.mobileapp.ui.widgets

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp

enum class Glyph { today, history, calculator, bell, swap, chevronDown, arrowRight, external, check, search, close, refresh }

@Composable
fun GlyphIcon(glyph: Glyph, size: Dp, color: Color, modifier: Modifier = Modifier, stroke: Float = 1.6f) {
    Canvas(modifier.size(size)) {
        val unit = this.size.width / 24f
        scale(unit, unit, pivot = Offset.Zero) { drawGlyph(glyph, color, stroke * density / unit) }
    }
}

private fun poly(vararg xy: Float, close: Boolean = false) = Path().apply {
    moveTo(xy[0], xy[1])
    var i = 2
    while (i < xy.size) {
        lineTo(xy[i], xy[i + 1])
        i += 2
    }
    if (close) close()
}

private fun DrawScope.drawGlyph(glyph: Glyph, color: Color, width: Float) {
    val line = Stroke(width = width, cap = StrokeCap.Square, join = StrokeJoin.Miter)
    fun stroke(path: Path) = drawPath(path, color, style = line)
    when (glyph) {
        Glyph.today -> {
            // The blade: a rising stroke with its sliver.
            stroke(poly(3f, 19f, 9f, 13f, 13f, 16f, 21f, 5f))
            stroke(poly(15.5f, 5f, 21f, 5f, 21f, 10.5f))
        }
        Glyph.history -> {
            stroke(poly(4f, 4f, 4f, 20f, 20f, 20f))
            stroke(poly(7.5f, 15.5f, 11f, 11.5f, 14f, 13.5f, 19f, 7f))
        }
        Glyph.calculator -> {
            drawRect(color, topLeft = Offset(5f, 3.5f), size = Size(14f, 17f), style = line)
            stroke(poly(8.5f, 8f, 15.5f, 8f))
            for (y in listOf(12.5f, 16.5f)) {
                for (x in listOf(8.75f, 12f, 15.25f)) drawRect(color, topLeft = Offset(x - 0.75f, y - 0.75f), size = Size(1.5f, 1.5f))
            }
        }
        Glyph.bell -> {
            val bell = Path().apply {
                moveTo(5f, 17f)
                lineTo(7f, 14.5f)
                lineTo(7f, 10.5f)
                cubicTo(7f, 7.2f, 9.2f, 5f, 12f, 5f)
                cubicTo(14.8f, 5f, 17f, 7.2f, 17f, 10.5f)
                lineTo(17f, 14.5f)
                lineTo(19f, 17f)
                close()
            }
            stroke(bell)
            stroke(poly(10.2f, 20f, 13.8f, 20f))
            stroke(poly(12f, 3f, 12f, 5f))
        }
        Glyph.swap -> {
            stroke(poly(8f, 20f, 8f, 5f))
            stroke(poly(4.5f, 8.5f, 8f, 5f, 11.5f, 8.5f))
            stroke(poly(16f, 4f, 16f, 19f))
            stroke(poly(12.5f, 15.5f, 16f, 19f, 19.5f, 15.5f))
        }
        Glyph.chevronDown -> stroke(poly(6f, 9.5f, 12f, 15.5f, 18f, 9.5f))
        Glyph.arrowRight -> {
            stroke(poly(4f, 12f, 19f, 12f))
            stroke(poly(13.5f, 6.5f, 19f, 12f, 13.5f, 17.5f))
        }
        Glyph.external -> {
            stroke(poly(7f, 17f, 17f, 7f))
            stroke(poly(9.5f, 7f, 17f, 7f, 17f, 14.5f))
        }
        Glyph.check -> stroke(poly(5f, 12.5f, 10f, 17.5f, 19f, 7f))
        Glyph.search -> {
            drawCircle(color, radius = 5.5f, center = Offset(10.5f, 10.5f), style = line)
            stroke(poly(15f, 15f, 20f, 20f))
        }
        Glyph.close -> {
            stroke(poly(6f, 6f, 18f, 18f))
            stroke(poly(18f, 6f, 6f, 18f))
        }
        Glyph.refresh -> {
            val arc = Path().apply { addArcRad(Rect(5f, 5f, 19f, 19f), -0.6f, 5.0f) }
            stroke(arc)
            stroke(poly(14.5f, 4.5f, 18.6f, 7.2f, 15.6f, 11f))
        }
    }
}
