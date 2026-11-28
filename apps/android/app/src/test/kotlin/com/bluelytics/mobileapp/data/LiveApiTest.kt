/*
 * The app's data layer against the production API, to catch a contract change the fixtures hide:
 *
 *   LIVE=1 ./gradlew :app:testDebugUnitTest --tests '*LiveApiTest'
 *
 * Skipped otherwise, so the normal suite never needs a network.
 */
package com.bluelytics.mobileapp.data

import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.CurrencyGroup
import com.bluelytics.mobileapp.domain.calcCurrencies
import com.bluelytics.mobileapp.domain.formatPesos
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class LiveApiTest {
    @Test
    fun `a cold start fills every screen from api bluelytics com ar`() = runBlocking {
        assumeTrue("set LIVE=1 to run against production", System.getenv("LIVE") == "1")
        val store = AppStore(HttpFetcher(), MemoryCacheStore(), this)
        store.refresh()
        val s = store.state.value

        assertFalse(s.offline)
        val latest = s.latest!!
        assertTrue(latest.blue!!.sell > latest.blue.buy)
        assertNotNull(latest.oficial)
        assertNotNull(latest.blueEuro)
        assertNotNull(latest.oficialEuro)
        assertNotNull(latest.updatedAt)

        assertTrue(s.recent.size > 20)
        assertTrue(s.hasFullSeries)
        assertTrue("the history goes back to 2011", s.series.first().day < "2012-01-01")
        assertEquals(s.recent.last().day, s.series.last().day)

        val snapshot = s.snapshot!!
        assertNotNull(snapshot.previousDay)
        assertNotNull(snapshot.gap)

        val currencies = calcCurrencies(s.currencies, AppLocale.en)
        assertTrue(currencies.size > 100)
        assertTrue(currencies.count { it.group == CurrencyGroup.americas } > 15)
        val untranslated = currencies.filter { c -> c.code != "EUR" && c.name == s.currencies.firstOrNull { it.code == c.code }?.name }.map { it.code }

        println(
            "blue ${formatPesos(latest.blue.sell, AppLocale.es)} · oficial ${formatPesos(latest.oficial!!.sell, AppLocale.es)} · " +
                "${s.series.size} days from ${s.series.first().day} to ${s.series.last().day} · ${currencies.size} currencies · " +
                "alert ${s.alert?.id} · extras ${s.extras.size} · without an English name: ${untranslated.joinToString()}",
        )
    }
}
