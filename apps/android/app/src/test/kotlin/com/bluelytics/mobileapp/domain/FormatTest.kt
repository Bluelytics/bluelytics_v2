package com.bluelytics.mobileapp.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime

class FormatTest {
    private val es = AppLocale.es
    private val en = AppLocale.en

    @Test
    fun `integers are grouped in threes with the locale separator`() {
        assertEquals("0", formatInteger(0, es))
        assertEquals("999", formatInteger(999, es))
        assertEquals("1.675", formatInteger(1675, es))
        assertEquals("1,675", formatInteger(1675, en))
        assertEquals("1.234.567", formatInteger(1234567, es))
        assertEquals("${MINUS}20", formatInteger(-20, es))
    }

    @Test
    fun `hundredths always show two decimals`() {
        assertEquals("1.652,50", formatHundredths(165250, es))
        assertEquals("1,652.50", formatHundredths(165250, en))
        assertEquals("0,05", formatHundredths(5, es))
        assertEquals("${MINUS}4,05", formatHundredths(-405, es))
    }

    @Test
    fun `prices show cents only when there are any`() {
        assertEquals("\$${NBSP}1.710", formatPesos(171000, es))
        assertEquals("\$1,710", formatPesos(171000, en))
        assertEquals("\$${NBSP}4,05", formatPesos(405, es))
        assertEquals("\$${NBSP}1.700,00", formatPesosCents(170000, es))
        assertEquals("US\$${NBSP}58,48", formatForeign(5848, "US$", es))
        assertEquals("€58.48", formatForeign(5848, "€", en))
    }

    @Test
    fun `signed amounts carry a plus or the typographic minus`() {
        assertEquals("+30", formatSignedAmount(3000, es))
        assertEquals("${MINUS}20", formatSignedAmount(-2000, es))
        assertEquals("0", formatSignedAmount(0, es))
        assertEquals("+1.50", formatSignedAmount(150, en))
    }

    @Test
    fun `percentages follow the locale and never print a negative zero`() {
        assertEquals("4,9$NBSP%", formatPercent(0.049, es))
        assertEquals("4.9%", formatPercent(0.049, en))
        assertEquals("0,0$NBSP%", formatPercent(-0.0004, es))
        assertEquals("+1,83$NBSP%", formatSignedPercent(0.0183, es, 2))
        assertEquals("${MINUS}1,21$NBSP%", formatSignedPercent(-0.0121, es, 2))
        assertEquals("0,00$NBSP%", formatSignedPercent(0.0, es, 2))
        assertEquals("1,250%", formatPercent(12.5, en, 0))
    }

    @Test
    fun `days in both languages`() {
        assertEquals("20 de noviembre de 2026", formatDay("2026-11-20", es))
        assertEquals("November 20, 2026", formatDay("2026-11-20", en))
        assertEquals("5 sept 2026", formatDay("2026-09-05", es, short = true))
        assertEquals("Sep 5, 2026", formatDay("2026-09-05", en, short = true))
        assertEquals("20/11", formatDayNumeric("2026-11-20", es))
        assertEquals("11/20", formatDayNumeric("2026-11-20", en))
        assertEquals("20/11/26", formatDayNumeric("2026-11-20", es, withYear = true))
        assertEquals("mar 2024", formatMonthShort(2024, 3, es))
    }

    @Test
    fun `instants are shown in Argentine time whatever the device time zone`() {
        val lateEvening = OffsetDateTime.parse("2026-11-25T19:20:12.572-03:00").toInstant()
        assertEquals("2026-11-25", artDay(lateEvening))
        assertEquals("19:20", formatTime(lateEvening))
        assertEquals("25 nov 2026, 19:20", formatDateTime(lateEvening, es))
        assertEquals("Nov 25, 2026, 19:20", formatDateTime(lateEvening, en))
        // 01:30 UTC is still the previous evening in Buenos Aires.
        val afterMidnightUtc = Instant.parse("2026-11-26T01:30:00Z")
        assertEquals("2026-11-25", artDay(afterMidnightUtc))
        assertEquals("22:30", formatTime(afterMidnightUtc))
    }

    @Test
    fun `elapsed time is coarse`() {
        val now = Instant.parse("2026-11-25T12:00:00Z")
        assertEquals("hace 5 min", formatAgo(now.minus(Duration.ofMinutes(5)), now, es))
        assertEquals("3 h ago", formatAgo(now.minus(Duration.ofHours(3)), now, en))
        assertEquals("hace 3 días", formatAgo(now.minus(Duration.ofDays(3)), now, es))
        assertEquals("hace 0 min", formatAgo(now.plus(Duration.ofMinutes(5)), now, es))
    }

    @Test
    fun `typed amounts are read in the locale notation`() {
        assertEquals(1234.5, parseAmount("1.234,5", es)!!, 0.0)
        assertEquals(1234.5, parseAmount("1,234.5", en)!!, 0.0)
        assertEquals(100.0, parseAmount(" 100 ", es)!!, 0.0)
        assertEquals(0.5, parseAmount("0,5", es)!!, 0.0)
        assertNull(parseAmount("", es))
        assertNull(parseAmount("12,3,4", es))
        assertNull(parseAmount("abc", en))
    }
}
