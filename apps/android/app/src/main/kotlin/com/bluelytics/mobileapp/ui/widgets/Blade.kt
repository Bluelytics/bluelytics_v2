/*
 * The brand blade of the social cards (packages/social/design/final/card.mjs) and of the site's hero
 * (apps/web/src/lib/blade.ts): a tapered ribbon along a cubic Bézier plus a thin sliver in the
 * direction colour. Built in a fixed 1200×640 box and scaled to cover the hero, anchored right.
 */
package com.bluelytics.mobileapp.ui.widgets

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.ui.theme.Bl
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

private const val W = 1200f
private const val H = 640f
private const val EXTEND = 600f

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

/** Centre line: up is a growth curve, down an inverted one, flat a long shallow sweep. */
private fun curve(direction: Direction): List<Offset> {
    if (direction == Direction.down) {
        val p0 = Offset(0.42f * W, -80f)
        val p3 = Offset(W + 80, 0.78f * H)
        return listOf(p0, Offset(lerp(p0.x, p3.x, 0.12f), lerp(p0.y, p3.y, 0.7f)), Offset(lerp(p0.x, p3.x, 0.55f), p3.y), p3)
    }
    val p0 = Offset(-80f, (if (direction == Direction.up) 0.92f else 0.7f) * H)
    val p3 = if (direction == Direction.up) Offset(0.98f * W, -80f) else Offset(W + 80, 0.12f * H)
    return listOf(p0, Offset(lerp(p0.x, p3.x, 0.4f), p0.y), Offset(lerp(p0.x, p3.x, 0.75f), lerp(p0.y, p3.y, 0.3f)), p3)
}

/** Point and unit normal of the curve at `t`. */
private fun bez(p: List<Offset>, t: Float): FloatArray {
    val u = 1 - t
    val b0 = u * u * u
    val b1 = 3 * u * u * t
    val b2 = 3 * u * t * t
    val b3 = t * t * t
    val d0 = 3 * u * u
    val d1 = 6 * u * t
    val d2 = 3 * t * t
    val dx = d0 * (p[1].x - p[0].x) + d1 * (p[2].x - p[1].x) + d2 * (p[3].x - p[2].x)
    val dy = d0 * (p[1].y - p[0].y) + d1 * (p[2].y - p[1].y) + d2 * (p[3].y - p[2].y)
    val len = max(sqrt(dx * dx + dy * dy), 1e-9f)
    return floatArrayOf(
        b0 * p[0].x + b1 * p[1].x + b2 * p[2].x + b3 * p[3].x,
        b0 * p[0].y + b1 * p[1].y + b2 * p[2].y + b3 * p[3].y,
        dy / len,
        -dx / len,
    )
}

private fun closed(top: List<Offset>, bottom: List<Offset>) = Path().apply {
    moveTo(top.first().x, top.first().y)
    for (point in top.drop(1)) lineTo(point.x, point.y)
    for (point in bottom.asReversed()) lineTo(point.x, point.y)
    close()
}

/** The band and the sliver, in the 1200×640 box. */
class BladeShape(val band: Path, val sliver: Path)

fun bladeShape(direction: Direction, width: Float = 260f, n: Int = 64): BladeShape {
    val p = curve(direction)
    val sliverWidth = width * 0.06f
    val top = ArrayList<Offset>()
    val bottom = ArrayList<Offset>()
    val sTop = ArrayList<Offset>()
    val sBottom = ArrayList<Offset>()
    var last = floatArrayOf(0f, 0f, 0f, 1f)
    for (i in 0..n) {
        val t = i.toFloat() / n
        last = bez(p, t)
        val (x, y, nx, ny) = last.toList()
        val half = (width / 2) * t.pow(0.9f)
        val gap = width * 0.06f * t.pow(0.6f)
        val sliver = sliverWidth * t.pow(1.1f)
        top.add(Offset(x + nx * half, y + ny * half))
        bottom.add(Offset(x - nx * half, y - ny * half))
        sTop.add(Offset(x + nx * (half + gap + sliver), y + ny * (half + gap + sliver)))
        sBottom.add(Offset(x + nx * (half + gap), y + ny * (half + gap)))
    }
    // Run both shapes on past the box along the end tangent, so they never end inside the hero.
    val tx = -last[3] * EXTEND
    val ty = last[2] * EXTEND
    for (side in listOf(top, bottom, sTop, sBottom)) side.add(Offset(side.last().x + tx, side.last().y + ty))
    return BladeShape(closed(top, bottom), closed(sTop, sBottom))
}

/** Draws the blade over the whole draw area; `progress` 0 → 1 is the entrance sweep. */
fun DrawScope.drawBlade(shape: BladeShape, direction: Direction, progress: Float) {
    if (size.width <= 0 || size.height <= 0 || progress <= 0) return
    // SVG `preserveAspectRatio="xMaxYMid slice"`: cover, anchored to the right edge.
    val scale = max(size.width / W, size.height / H)
    val dx = size.width - W * scale - (1 - progress) * 0.06f * size.width
    val dy = (size.height - H * scale) / 2
    val alpha = 0.8f * progress
    val bounds = shape.band.getBounds()
    val band = Brush.linearGradient(
        0f to Bl.brandDeep.copy(alpha = 0f),
        0.35f to Color(0xFF005E9D).copy(alpha = 0.85f * alpha),
        1f to Bl.brand.copy(alpha = alpha),
        start = bounds.bottomLeft,
        end = bounds.topRight,
    )
    val sliverColor = when (direction) {
        Direction.up -> Bl.up
        Direction.down -> Bl.down
        Direction.flat -> Bl.brandInk
    }
    clipRect {
        translate(dx, dy) {
            scale(scale, scale, pivot = Offset.Zero) {
                drawPath(shape.band, band)
                drawPath(shape.sliver, sliverColor.copy(alpha = alpha))
            }
        }
    }
}
