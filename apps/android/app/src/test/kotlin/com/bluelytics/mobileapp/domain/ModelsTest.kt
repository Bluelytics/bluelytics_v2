package com.bluelytics.mobileapp.domain

import com.bluelytics.mobileapp.support.fixture
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ModelsTest {
    @Test
    fun `hundredths - decimals, strings and junk`() {
        assertEquals(170000L, hundredthsOf(1700.00))
        assertEquals(407L, hundredthsOf(4.07))
        assertEquals(165250L, hundredthsOf(1652.5))
        assertEquals(171000L, hundredthsOf(JsonPrimitive("1710.00")))
        assertNull(hundredthsOf(0.0))
        assertNull(hundredthsOf(-5.0))
        assertNull(hundredthsOf(null as Double?))
        assertNull(hundredthsOf(Double.NaN))
        assertNull(hundredthsOf(JsonPrimitive("x")))
    }

    @Test
    fun `the average is the midpoint, rounded half up`() {
        assertEquals(170000L, Quote(169000, 171000).average)
        assertEquals(165250L, Quote(163500, 167000).average)
        assertEquals(2L, Quote(1, 2).average)
    }

    @Test
    fun `latest - the captured production body`() {
        val latest = Latest.fromJson(parseJson(fixture("latest")))
        assertEquals(Quote(169000, 171000), latest.blue)
        assertEquals(Quote(158000, 163000), latest.oficial)
        assertEquals(Quote(183700, 185900), latest.blueEuro)
        assertEquals(Quote(171700, 177200), latest.oficialEuro)
        assertEquals(Instant.parse("2026-11-25T22:20:12.572Z"), latest.updatedAt)
    }

    @Test
    fun `latest - missing or malformed parts become null instead of throwing`() {
        assertNull(Latest.fromJson(null).blue)
        assertNull(Latest.fromJson(JsonArray(emptyList())).blue)
        val partial = Latest.fromJson(parseJson("""{"blue":{"value_buy":1690,"value_sell":null},"oficial":"x","last_update":"nope"}"""))
        assertNull(partial.blue)
        assertNull(partial.oficial)
        assertNull(partial.updatedAt)
    }

    @Test
    fun `evolution - rows become days, oldest first, with both sources`() {
        val days = parseEvolution(parseJson(fixture("recent")))
        assertEquals(45, days.size)
        assertTrue(days.first().day < days.last().day)
        assertEquals("2026-11-25", days.last().day)
        assertEquals(Quote(169000, 171000), days.last().blue)
        assertEquals(Quote(158000, 163000), days.last().oficial)
        for (i in 1 until days.size) assertTrue("sorted and unique", days[i - 1].day < days[i].day)
    }

    @Test
    fun `evolution - bad rows are skipped`() {
        val days = parseEvolution(
            parseJson(
                """[{"date":"2026-11-25","source":"Blue","value_sell":1710,"value_buy":1690},""" +
                    """{"date":"25/11/2026","source":"Blue","value_sell":1,"value_buy":1},""" +
                    """{"date":"2026-11-24","source":"Blue","value_sell":0,"value_buy":1680},""" +
                    """{"date":"2026-11-24","source":"Otro","value_sell":1,"value_buy":1},""" +
                    """"junk",""" +
                    """{"date":"2026-11-24","source":"Oficial","value_sell":1615,"value_buy":1565}]""",
            ),
        )
        assertEquals(listOf("2026-11-24", "2026-11-25"), days.map { it.day })
        assertNull(days[0].blue)
        assertEquals(Quote(156500, 161500), days[0].oficial)
        assertNull(days[1].oficial)
        assertTrue(parseEvolution(null).isEmpty())
        assertTrue(parseEvolution(JsonObject(mapOf("a" to JsonPrimitive(1)))).isEmpty())
    }

    @Test
    fun `currencies - the captured list, without the ones that have no value`() {
        val currencies = parseCurrencies(parseJson(fixture("currencies")))
        assertTrue(currencies.size > 150)
        assertTrue("value 0.00", currencies.none { it.code == "BTC" })
        val real = currencies.first { it.code == "BRL" }
        assertEquals("Real brasileño", real.name)
        assertEquals(593L, real.perUsdHundredths)
    }

    @Test
    fun `alert - the captured body, and bodies without an alert`() {
        val alert = AlertInfo.fromJson(parseJson(fixture("alert")))!!
        assertEquals(1891L, alert.id)
        assertEquals(Instant.parse("2026-11-25T15:10:12.572Z"), alert.at)
        assertEquals(174000L, alert.current.sell)
        assertEquals(172500L, alert.previous!!.sell)
        assertNull(AlertInfo.fromJson(null))
        assertNull(AlertInfo.fromJson(JsonObject(emptyMap())))
    }

    @Test
    fun `extras - prices already in hundredths, entries without a sell price are dropped`() {
        val extras = parseExtras(parseJson(fixture("extras")))
        assertEquals(listOf("mep", "ccl", "cripto", "tarjeta", "mayorista"), extras.map { it.code })
        assertNull(extras[3].buy)
        assertEquals(211900L, extras[3].sell)
        assertTrue(parseExtras(parseJson("""{"rates":[{"code":"mep","sell":null},{"code":7,"sell":1},"x"]}""")).isEmpty())
        assertTrue(parseExtras(JsonArray(emptyList())).isEmpty())
    }
}
