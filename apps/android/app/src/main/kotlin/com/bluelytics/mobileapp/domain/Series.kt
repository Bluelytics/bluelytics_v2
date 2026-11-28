/*
 * Pure transforms of the daily series for the hero, the tiles, the charts and the history table
 * (the counterpart of apps/web/src/lib/series.ts and chart.ts).
 */
package com.bluelytics.mobileapp.domain

import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

enum class Direction { up, down, flat }

/** Change from `previous` to `current`, both in hundredths. */
data class Move(val previous: Long, val delta: Long, val ratio: Double, val direction: Direction) {
    companion object {
        fun between(current: Long?, previous: Long?): Move? {
            if (current == null || previous == null || previous <= 0) return null
            val delta = current - previous
            val direction = if (delta > 0) Direction.up else if (delta < 0) Direction.down else Direction.flat
            return Move(previous, delta, delta.toDouble() / previous, direction)
        }
    }
}

/** Blue over official sell, minus one. */
fun gapRatio(blueSell: Long?, oficialSell: Long?): Double? {
    if (blueSell == null || oficialSell == null || blueSell <= 0 || oficialSell <= 0) return null
    return blueSell.toDouble() / oficialSell - 1
}

/** What the Today screen shows: the live quotes and their move against the previous close. */
data class Snapshot(
    val latest: Latest,
    /** The day the moves are measured against (`YYYY-MM-DD`). */
    val previousDay: String?,
    val blueMove: Move?,
    val oficialMove: Move?,
    val gap: Double?,
) {
    companion object {
        /**
         * `days` is oldest first. The previous close is the last day with a blue quote before the
         * Argentine day of `latest.updatedAt`.
         */
        fun of(latest: Latest, days: List<DayRates>): Snapshot {
            val updatedAt = latest.updatedAt
            var previous: DayRates? = null
            if (updatedAt != null) {
                val today = artDay(updatedAt)
                previous = days.lastOrNull { it.day < today && it.blue != null }
            }
            return Snapshot(
                latest = latest,
                previousDay = previous?.day,
                blueMove = Move.between(latest.blue?.sell, previous?.blue?.sell),
                oficialMove = Move.between(latest.oficial?.sell, previous?.oficial?.sell),
                gap = gapRatio(latest.blue?.sell, latest.oficial?.sell),
            )
        }
    }
}

/**
 * Recent days over the full history: `full` up to the first recent day, then `recent`. `recent` is
 * refreshed on every load, `full` a few times a day.
 */
fun mergeSeries(full: List<DayRates>, recent: List<DayRates>): List<DayRates> {
    if (recent.isEmpty()) return full
    if (full.isEmpty()) return recent
    val first = recent.first().day
    return full.filter { it.day < first } + recent
}

enum class RangePreset(
    /** Calendar days in the window; `null` for the whole series. */
    val days: Int?,
) {
    m1(31),
    m3(92),
    m6(183),
    y1(366),
    y5(1827),
    max(null),
}

/** First day (inclusive) of a preset window ending on `lastDay`; `null` for the whole series. */
fun rangeStart(lastDay: String, preset: RangePreset): String? {
    val span = preset.days ?: return null
    return parseDay(lastDay).minusDays((span - 1).toLong()).toString()
}

/** The part of `days` with `day >= from`. */
fun sliceFrom(days: List<DayRates>, from: String?): List<DayRates> {
    if (from == null) return days
    val start = days.indexOfFirst { it.day >= from }
    return if (start < 0) emptyList() else days.subList(start, days.size)
}

/** The days of a preset window ending on the last day of `days`. */
fun rangeOf(days: List<DayRates>, preset: RangePreset): List<DayRates> =
    if (days.isEmpty()) days else sliceFrom(days, rangeStart(days.last().day, preset))

/** First, last, lowest and highest blue sell of a set of days. */
data class PeriodSummary(val first: DayRates, val last: DayRates, val min: DayRates, val max: DayRates, val days: Int) {
    val change: Move? get() = Move.between(last.blue?.sell, first.blue?.sell)

    companion object {
        fun of(days: List<DayRates>): PeriodSummary? {
            val withBlue = days.filter { it.blue != null }
            if (withBlue.isEmpty()) return null
            var min = withBlue.first()
            var max = withBlue.first()
            for (d in withBlue) {
                if (d.blue!!.sell < min.blue!!.sell) min = d
                if (d.blue.sell > max.blue!!.sell) max = d
            }
            return PeriodSummary(withBlue.first(), withBlue.last(), min, max, withBlue.size)
        }
    }
}

// ───────────── Chart model ─────────────

enum class ChartMode { rates, gap }

enum class LineKey { blue, oficial, gap }

/** Pesos (rates) or percent (gap) per day; `null` = no value that day. */
class PlotLine(val key: LineKey, val values: List<Double?>)

/** `pos`: 0 = left/top, 1 = right/bottom. */
data class Tick(val pos: Double, val label: String)

/** Fraction of the height kept free above and below the data. */
const val CHART_PAD = 0.06

class ChartModel(
    val days: List<String>,
    val lines: List<PlotLine>,
    val mode: ChartMode,
    val yMin: Double,
    val yMax: Double,
    val yTicks: List<Tick>,
    val xTicks: List<Tick>,
) {
    val isEmpty: Boolean get() = days.isEmpty() || lines.all { line -> line.values.all { it == null } }

    /** Horizontal position (0–1) of day `index`. */
    fun xPos(index: Int): Double = if (days.size <= 1) 0.5 else index.toDouble() / (days.size - 1)

    /** Vertical position (0–1 from the top) of a value. */
    fun yPos(value: Double): Double = 1 - CHART_PAD - ((value - yMin) / (yMax - yMin)) * (1 - 2 * CHART_PAD)
}

/** Blue and official sell in pesos, or the gap in percent `(blue / oficial − 1) × 100`. */
fun linesFor(mode: ChartMode, days: List<DayRates>): List<PlotLine> {
    if (mode == ChartMode.rates) {
        return listOf(
            PlotLine(LineKey.oficial, days.map { d -> d.oficial?.let { it.sell / 100.0 } }),
            PlotLine(LineKey.blue, days.map { d -> d.blue?.let { it.sell / 100.0 } }),
        )
    }
    return listOf(PlotLine(LineKey.gap, days.map { d -> gapRatio(d.blue?.sell, d.oficial?.sell)?.let { it * 100 } }))
}

private fun log10Floor(x: Double): Int {
    // Powers of ten by repeated scaling: exact for the axis steps this is used for.
    var exponent = 0
    var value = x
    while (value >= 10) {
        value /= 10
        exponent++
    }
    while (value < 1) {
        value *= 10
        exponent--
    }
    return exponent
}

private fun pow10d(exponent: Int): Double {
    var result = 1.0
    repeat(abs(exponent)) { result *= 10 }
    return if (exponent < 0) 1 / result else result
}

private fun niceStep(raw: Double): Double {
    if (!(raw > 0) || !raw.isFinite()) return 1.0
    val power = pow10d(log10Floor(raw))
    val fraction = raw / power
    val nice = when {
        fraction <= 1 -> 1.0
        fraction <= 2 -> 2.0
        fraction <= 2.5 -> 2.5
        fraction <= 5 -> 5.0
        else -> 10.0
    }
    return nice * power
}

data class Scale(val min: Double, val max: Double, val step: Double)

/** Round axis bounds and a step that gives about `count` intervals. */
fun niceScale(minValue: Double, maxValue: Double, count: Int = 4): Scale {
    if (!minValue.isFinite() || !maxValue.isFinite()) return Scale(0.0, 1.0, 1.0)
    var min = minValue
    var max = maxValue
    if (min == max) {
        val spread = if (abs(min) * 0.05 == 0.0) 1.0 else abs(min) * 0.05
        min -= spread
        max += spread
    }
    val step = niceStep((max - min) / count)
    return Scale(floor(min / step) * step, ceil(max / step) * step, step)
}

private fun yLabel(value: Double, mode: ChartMode, step: Double, locale: AppLocale): String {
    if (mode == ChartMode.rates) {
        // Old values are a few pesos: keep a decimal when the step is below one peso.
        return if (step < 1) formatHundredths(roundHalfAway(value * 100), locale) else formatInteger(roundHalfAway(value), locale)
    }
    return formatPercent(value / 100, locale, if (step < 1) 1 else 0)
}

private fun xTicks(days: List<String>, locale: AppLocale, count: Int): List<Tick> {
    if (days.isEmpty()) return emptyList()
    val spanDays = ChronoUnit.DAYS.between(parseDay(days.first()), parseDay(days.last()))
    fun label(day: String): String = when {
        spanDays <= 100 -> formatDayNumeric(day, locale)
        spanDays <= 3 * 366 -> formatMonthShort(day.substring(0, 4).toInt(), day.substring(5, 7).toInt(), locale)
        else -> day.substring(0, 4)
    }

    val ticks = ArrayList<Tick>()
    val n = if (count < days.size) count else days.size
    for (i in 0 until n) {
        val index = if (n == 1) days.size - 1 else (i * (days.size - 1).toDouble() / (n - 1)).let { roundHalfAway(it).toInt() }
        val text = label(days[index])
        if (ticks.isNotEmpty() && ticks.last().label == text) continue
        ticks.add(Tick(if (days.size == 1) 0.5 else index.toDouble() / (days.size - 1), text))
    }
    return ticks
}

fun buildChart(days: List<DayRates>, mode: ChartMode, locale: AppLocale, xTickCount: Int = 4): ChartModel {
    val lines = linesFor(mode, days)
    val names = days.map { it.day }
    var low = Double.POSITIVE_INFINITY
    var high = Double.NEGATIVE_INFINITY
    for (line in lines) {
        for (value in line.values) {
            if (value == null) continue
            if (value < low) low = value
            if (value > high) high = value
        }
    }
    val scale = niceScale(low, high)
    val yTicks = ArrayList<Tick>()
    var v = scale.min
    while (v <= scale.max + scale.step / 2) {
        yTicks.add(Tick(1 - CHART_PAD - ((v - scale.min) / (scale.max - scale.min)) * (1 - 2 * CHART_PAD), yLabel(v, mode, scale.step, locale)))
        v += scale.step
    }
    return ChartModel(names, lines, mode, scale.min, scale.max, yTicks, xTicks(names, locale, xTickCount))
}
