package com.bluelytics.mobileapp.data

import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.support.FixtureFetcher
import com.bluelytics.mobileapp.support.fixture
import com.bluelytics.mobileapp.support.fixtureNow
import com.bluelytics.mobileapp.support.fixtureStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.time.Duration
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class StoreTest {
    @Test
    fun `a refresh loads every feed and stamps the fetch time`() = runTest {
        val store = fixtureStore(this)
        assertFalse(store.state.value.hasData)
        store.refresh()
        val s = store.state.value
        assertFalse(s.offline)
        assertFalse(s.loading)
        assertEquals(fixtureNow, s.fetchedAt)
        assertEquals(171000L, s.latest!!.blue!!.sell)
        assertEquals(45, s.recent.size)
        assertTrue(s.hasFullSeries)
        assertTrue(s.series.size > 500)
        assertEquals("2026-11-25", s.series.last().day)
        assertTrue(s.currencies.isNotEmpty())
        assertEquals(1891L, s.alert!!.id)
        assertEquals(5, s.extras.size)
        val snapshot = s.snapshot!!
        assertEquals("2026-11-24", snapshot.previousDay)
        assertEquals(Direction.up, snapshot.blueMove!!.direction)
    }

    @Test
    fun `listeners hear the start and the end of a refresh`() = runTest {
        val store = fixtureStore(this)
        val loadingStates = mutableListOf<Boolean>()
        val listener = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { store.state.collect { loadingStates.add(it.loading) } }
        store.refresh()
        advanceUntilIdle()
        listener.cancel()
        assertTrue(loadingStates.contains(true))
        assertFalse(loadingStates.last())
    }

    @Test
    fun `only the live quotes decide offline - optional feeds may fail quietly`() = runTest {
        val store = fixtureStore(this, fail = setOf(Feed.extras, Feed.alert, Feed.full))
        store.refresh()
        val s = store.state.value
        assertFalse(s.offline)
        assertTrue(s.hasData)
        assertTrue(s.extras.isEmpty())
        assertNull(s.alert)
        assertFalse(s.hasFullSeries)
        assertEquals("the recent days alone", 45, s.series.size)
    }

    @Test
    fun `without network and without cache there is nothing to show`() = runTest {
        val store = fixtureStore(this, fail = Feed.entries.toSet())
        store.refresh()
        val s = store.state.value
        assertTrue(s.offline)
        assertFalse(s.hasData)
        assertNull(s.snapshot)
        assertNull(s.fetchedAt)
    }

    @Test
    fun `a body that is not the expected JSON counts as a failure, not a crash`() = runTest {
        val store = fixtureStore(this, overrides = mapOf(Feed.latest to "<html>error</html>", Feed.currencies to "[]"))
        store.refresh()
        val s = store.state.value
        assertTrue(s.offline)
        assertTrue(s.currencies.isEmpty())
        assertTrue(s.recent.isNotEmpty())
    }

    @Test
    fun `what was fetched comes back from the cache, and stays on screen when the network fails`() = runTest {
        val cache = MemoryCacheStore()
        val first = fixtureStore(this, cache = cache)
        first.refresh()
        advanceUntilIdle()
        assertTrue(cache.entries.keys.containsAll(Feed.entries.map { it.name }))

        val later = fixtureNow.plus(Duration.ofHours(2))
        val second = fixtureStore(this, cache = cache, fail = Feed.entries.toSet(), clock = { later })
        second.restore()
        assertTrue(second.state.value.hasData)
        assertEquals(fixtureNow, second.state.value.fetchedAt)
        assertEquals(first.state.value.series.size, second.state.value.series.size)
        second.refresh()
        val s = second.state.value
        assertTrue(s.offline)
        assertEquals("the cached quote is kept", 171000L, s.latest!!.blue!!.sell)
        assertEquals("and still dated when it was fetched", fixtureNow, s.fetchedAt)
    }

    @Test
    fun `a damaged cache entry is ignored`() = runTest {
        val cache = MemoryCacheStore()
        cache.entries[Feed.latest.name] = CacheEntry(fixtureNow, "{\"blue\":")
        cache.entries[Feed.recent.name] = CacheEntry(fixtureNow, fixture("recent"))
        val store = fixtureStore(this, cache = cache)
        store.restore()
        assertFalse(store.state.value.hasData)
        assertTrue(store.state.value.recent.isNotEmpty())
    }

    // How often the network is used.

    private class Counting(var now: Instant = fixtureNow) {
        val fetcher = FixtureFetcher()

        fun count(feed: Feed) = fetcher.log.count { it == feed }
    }

    @Test
    fun `a second refresh inside the API cache window does nothing, unless forced`() = runTest {
        val c = Counting()
        val store = AppStore(c.fetcher, MemoryCacheStore(), this, { c.now })
        store.refresh()
        c.now = c.now.plusSeconds(10)
        store.refresh()
        assertEquals(1, c.count(Feed.latest))
        store.refresh(force = true)
        assertEquals(2, c.count(Feed.latest))
        c.now = c.now.plusSeconds(31)
        store.refresh()
        assertEquals(3, c.count(Feed.latest))
    }

    @Test
    fun `the history and the currencies are fetched a few times a day, not on every refresh`() = runTest {
        val c = Counting()
        val store = AppStore(c.fetcher, MemoryCacheStore(), this, { c.now })
        store.refresh()
        c.now = c.now.plus(Duration.ofMinutes(5))
        store.refresh()
        assertEquals(2, c.count(Feed.recent))
        assertEquals(1, c.count(Feed.full))
        assertEquals(1, c.count(Feed.currencies))
        c.now = c.now.plus(Duration.ofHours(6))
        store.refresh()
        assertEquals(2, c.count(Feed.full))
        assertEquals(2, c.count(Feed.currencies))
    }

    @Test
    fun `simultaneous refreshes share one run`() = runTest {
        val c = Counting()
        val store = AppStore(c.fetcher, MemoryCacheStore(), this, { c.now })
        listOf(async { store.refresh() }, async { store.refresh(force = true) }, async { store.refresh() }).awaitAll()
        assertEquals(1, c.count(Feed.latest))
    }

    // File cache.

    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun `file cache - round trip, with the body kept byte for byte`() = runTest {
        val directory = folder.newFolder("cache")
        val cache = FileCacheStore { directory }
        assertNull(cache.read("latest"))
        val body = "{\"a\":\"línea 1\\n\"}\nsecond line\n"
        cache.write("latest", CacheEntry(fixtureNow, body))
        val entry = cache.read("latest")!!
        assertEquals(fixtureNow, entry.at)
        assertEquals(body, entry.body)
        assertEquals("no temporary file left behind", listOf("bluelytics-latest.txt"), directory.list()!!.toList())
    }

    @Test
    fun `file cache - a file that is not a cache entry reads as nothing`() = runTest {
        val directory = folder.newFolder("cache")
        val cache = FileCacheStore { directory }
        File(directory, "bluelytics-latest.txt").writeText("not a date\n{}")
        assertNull(cache.read("latest"))
        File(directory, "bluelytics-recent.txt").writeText("no newline")
        assertNull(cache.read("recent"))
    }

    @Test
    fun `file cache - a directory that cannot be used never throws`() = runTest {
        val cache = FileCacheStore { throw IOException("no storage") }
        assertNull(cache.read("latest"))
        cache.write("latest", CacheEntry(fixtureNow, "{}"))
    }
}
