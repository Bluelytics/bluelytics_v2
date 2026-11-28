package com.bluelytics.mobileapp.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime

private fun day(name: String, blueSell: Long?, oficialSell: Long? = null) = DayRates(
    name,
    blue = blueSell?.let { Quote(it - 2000, it) },
    oficial = oficialSell?.let { Quote(it - 5000, it) },
)

class SeriesTest {
    @Test
    fun `a move has a sign, a ratio and a direction`() {
        val up = Move.between(171000, 170000)!!
        assertEquals(1000L, up.delta)
        assertEquals(0.00588, up.ratio, 0.00001)
        assertEquals(Direction.up, up.direction)
        assertEquals(Direction.down, Move.between(170000, 171000)!!.direction)
        assertEquals(Direction.flat, Move.between(170000, 170000)!!.direction)
        assertNull(Move.between(170000, null))
        assertNull(Move.between(null, 170000))
        assertNull(Move.between(170000, 0))
    }

    @Test
    fun `the gap is blue over official sell, minus one`() {
        assertEquals(0.0491, gapRatio(171000, 163000)!!, 0.0001)
        assertNull(gapRatio(null, 163000))
        assertNull(gapRatio(171000, 0))
    }

    private val days = listOf(day("2026-11-20", 168000, 160000), day("2026-11-23", 169000, 161000), day("2026-11-24", 170000, 161500), day("2026-11-25", 171000, 163000))

    private fun at(stamp: String) = Latest(blue = Quote(169000, 171000), oficial = Quote(158000, 163000), updatedAt = OffsetDateTime.parse(stamp).toInstant())

    @Test
    fun `snapshot - moves are measured against the last day before today, not today's own row`() {
        val snapshot = Snapshot.of(at("2026-11-25T19:20:00-03:00"), days)
        assertEquals("2026-11-24", snapshot.previousDay)
        assertEquals(1000L, snapshot.blueMove!!.delta)
        assertEquals(1500L, snapshot.oficialMove!!.delta)
        assertEquals(0.0491, snapshot.gap!!, 0.0001)
    }

    @Test
    fun `snapshot - today is the Argentine day, 01 00 UTC still belongs to the evening before`() {
        assertEquals("2026-11-24", Snapshot.of(at("2026-11-26T01:00:00Z"), days).previousDay)
    }

    @Test
    fun `snapshot - before the first run of a new day the series may not have today yet`() {
        val snapshot = Snapshot.of(at("2026-11-26T08:00:00-03:00"), days)
        assertEquals("2026-11-25", snapshot.previousDay)
        assertEquals(Direction.flat, snapshot.blueMove!!.direction)
    }

    @Test
    fun `snapshot - days without a blue quote are skipped, without history there is no move`() {
        val gappy = listOf(day("2026-11-23", 169000, 161000), day("2026-11-24", null, 161500))
        assertEquals("2026-11-23", Snapshot.of(at("2026-11-25T12:00:00-03:00"), gappy).previousDay)
        val empty = Snapshot.of(at("2026-11-25T12:00:00-03:00"), emptyList())
        assertNull(empty.previousDay)
        assertNull(empty.blueMove)
        assertNotNull(empty.gap)
    }

    @Test
    fun `recent days replace the tail of the full history`() {
        val full = listOf(day("2026-11-20", 1), day("2026-11-23", 2), day("2026-11-24", 3))
        val recent = listOf(day("2026-11-23", 20), day("2026-11-24", 30), day("2026-11-25", 40))
        val merged = mergeSeries(full, recent)
        assertEquals(listOf("2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"), merged.map { it.day })
        assertEquals(20L, merged[1].blue!!.sell)
        assertSame(recent, mergeSeries(emptyList(), recent))
        assertSame(full, mergeSeries(full, emptyList()))
    }

    @Test
    fun `range presets are calendar windows ending on the last day`() {
        assertEquals("2026-10-26", rangeStart("2026-11-25", RangePreset.m1))
        assertEquals("2025-11-25", rangeStart("2026-11-25", RangePreset.y1))
        assertNull(rangeStart("2026-11-25", RangePreset.max))
        val days = listOf(day("2026-09-01", 1), day("2026-10-26", 2), day("2026-11-25", 3))
        assertEquals(listOf("2026-10-26", "2026-11-25"), rangeOf(days, RangePreset.m1).map { it.day })
        assertSame(days, rangeOf(days, RangePreset.max))
        assertTrue(rangeOf(emptyList(), RangePreset.m1).isEmpty())
        assertTrue(sliceFrom(days, "2027-01-01").isEmpty())
    }

    @Test
    fun `period summary - first, last, low, high`() {
        val days = listOf(day("2026-11-20", 168000), day("2026-11-23", 166000), day("2026-11-24", null, 161000), day("2026-11-25", 171000))
        val summary = PeriodSummary.of(days)!!
        assertEquals(3, summary.days)
        assertEquals("2026-11-23", summary.min.day)
        assertEquals("2026-11-25", summary.max.day)
        assertEquals(3000L, summary.change!!.delta)
        assertNull(PeriodSummary.of(listOf(day("2026-11-24", null, 161000))))
    }

    @Test
    fun `chart - axis bounds are round and contain the data`() {
        assertEquals(Scale(1550.0, 1750.0, 50.0), niceScale(1550.0, 1712.0))
        assertEquals(Scale(-10.0, 30.0, 10.0), niceScale(-8.0, 27.0))
        val flat = niceScale(1700.0, 1700.0)
        assertTrue(flat.min < 1700)
        assertTrue(flat.max > 1700)
        assertEquals(Scale(0.0, 1.0, 1.0), niceScale(Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY))
    }

    @Test
    fun `chart - rates, two lines in pesos with labels in the locale`() {
        val days = listOf(day("2026-10-26", 156000, 155000), day("2026-11-10", 155000, 157000), day("2026-11-25", 171000, 163000))
        val model = buildChart(days, ChartMode.rates, AppLocale.es, xTickCount = 3)
        assertEquals(listOf(LineKey.oficial, LineKey.blue), model.lines.map { it.key })
        assertEquals(listOf(1560.0, 1550.0, 1710.0), model.lines[1].values)
        assertEquals(1550.0, model.yMin, 0.0)
        assertEquals(1750.0, model.yMax, 0.0)
        assertEquals(listOf("1.550", "1.600", "1.650", "1.700", "1.750"), model.yTicks.map { it.label })
        assertEquals(listOf("26/10", "10/11", "25/11"), model.xTicks.map { it.label })
        assertEquals(0.0, model.xPos(0), 0.0)
        assertEquals(1.0, model.xPos(2), 0.0)
        assertEquals(CHART_PAD, model.yPos(1750.0), 1e-9)
        assertEquals(1 - CHART_PAD, model.yPos(1550.0), 1e-9)
    }

    @Test
    fun `chart - gap, one line in percent, null where a side is missing`() {
        val days = listOf(day("2026-11-23", 169000, 161000), day("2026-11-24", 170000), day("2026-11-25", 171000, 163000))
        val model = buildChart(days, ChartMode.gap, AppLocale.en)
        val line = model.lines.single()
        assertEquals(LineKey.gap, line.key)
        assertNull(line.values[1])
        assertEquals(4.91, line.values[2]!!, 0.01)
        assertTrue(model.yTicks.first().label.endsWith("%"))
    }

    @Test
    fun `chart - long spans label the axis by month, then by year, old prices keep their cents`() {
        val months = buildChart(listOf(day("2026-01-05", 120000), day("2026-06-05", 130000), day("2026-11-25", 171000)), ChartMode.rates, AppLocale.es, xTickCount = 3)
        assertEquals(listOf("ene 2026", "jun 2026", "nov 2026"), months.xTicks.map { it.label })
        val years = buildChart(listOf(day("2011-01-03", 2407), day("2018-06-05", 2600), day("2026-11-25", 171000)), ChartMode.rates, AppLocale.es, xTickCount = 3)
        assertEquals(listOf("2011", "2018", "2026"), years.xTicks.map { it.label })
        val cents = buildChart(listOf(day("2011-01-03", 2407), day("2011-01-04", 2409)), ChartMode.rates, AppLocale.es)
        assertTrue(cents.yTicks.first().label.contains(","))
    }

    @Test
    fun `chart - an empty series makes an empty model, not an exception`() {
        val model = buildChart(emptyList(), ChartMode.rates, AppLocale.es)
        assertTrue(model.isEmpty)
        assertTrue(model.xTicks.isEmpty())
    }
}
