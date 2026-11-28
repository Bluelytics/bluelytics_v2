package com.bluelytics.mobileapp.domain

import com.bluelytics.mobileapp.support.fixture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CalcTest {
    private val rows = parseCurrencies(parseJson(fixture("currencies")))

    @Test
    fun `the picker lists the dollar and the euro, then the Americas, then the rest`() {
        val list = calcCurrencies(rows, AppLocale.es)
        assertEquals("USD", list[0].code)
        assertEquals("EUR", list[1].code)
        assertEquals("no duplicates of the published ones, no pesos", 2, list.count { it.code == "USD" || it.code == "EUR" || it.code == "ARS" })
        val groups = list.map { it.group }
        assertEquals(2, groups.indexOf(CurrencyGroup.americas))
        assertTrue(groups.lastIndexOf(CurrencyGroup.americas) < groups.indexOf(CurrencyGroup.other))
        val american = list.filter { it.group == CurrencyGroup.americas }.map { it.code }.toSet()
        assertTrue(american.containsAll(listOf("BRL", "CLP", "UYU", "PYG", "BOB", "PEN", "COP", "MXN", "CAD")))
        assertEquals(CurrencyGroup.other, list.first { it.code == "GBP" }.group)
    }

    @Test
    fun `names are Spanish as stored, or English from the table`() {
        assertEquals("Real brasileño", calcCurrencies(rows, AppLocale.es).first { it.code == "BRL" }.name)
        val english = calcCurrencies(rows, AppLocale.en)
        assertEquals("Brazilian real", english.first { it.code == "BRL" }.name)
        assertEquals("US dollar", english.first().name)
        val names = english.filter { it.group == CurrencyGroup.other }.map { it.name }
        assertEquals("sorted by the name on screen", listOf("Afghan afghani", "Albanian lek", "Algerian dinar"), names.take(3))
    }

    @Test
    fun `search ignores case and accents and matches codes`() {
        val list = calcCurrencies(rows, AppLocale.es)
        fun find(query: String) = list.filter { matchesCurrency(it, query) }.map { it.code }
        assertEquals(listOf("CAD"), find("dolar canad"))
        assertEquals(listOf("BRL"), find("brl"))
        assertEquals(listOf("PYG"), find("GUARANÍ"))
        assertEquals(list.size, find("  ").size)
        assertTrue(find("zzzz").isEmpty())
    }

    @Test
    fun `rates - published for the dollar and the euro, through the dollar for the rest`() {
        val list = calcCurrencies(rows, AppLocale.es)
        val usd = list[0]
        val eur = list[1]
        val brl = list.first { it.code == "BRL" }
        assertEquals(171000.0, rateFor(usd, usd = 171000, eur = 185900)!!, 0.0)
        assertEquals(185900.0, rateFor(eur, usd = 171000, eur = 185900)!!, 0.0)
        // 1 USD = 5.93 BRL, so one real is 1710 / 5.93 pesos.
        assertEquals(28836.4, rateFor(brl, usd = 171000, eur = 185900)!!, 0.1)
        assertNull(rateFor(brl, usd = null, eur = 185900))
        assertNull(rateFor(eur, usd = 171000, eur = null))
        assertEquals("US$", usd.sign)
        assertEquals("€", eur.sign)
        assertEquals("BRL", brl.sign)
    }

    @Test
    fun `conversions round to a hundredth`() {
        assertEquals(17100000L, toPesosHundredths(100.0, 171000.0))
        assertEquals(85500L, toPesosHundredths(0.5, 171000.0))
        assertEquals(5848L, toForeignHundredths(100000.0, 171000.0))
        assertEquals(0L, toForeignHundredths(100000.0, 0.0))
    }
}
