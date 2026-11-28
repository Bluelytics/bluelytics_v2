/* The app's data: what the API last said, restored from disk first and refreshed in the background. */
package com.bluelytics.mobileapp.data

import com.bluelytics.mobileapp.domain.AlertInfo
import com.bluelytics.mobileapp.domain.Currency
import com.bluelytics.mobileapp.domain.DayRates
import com.bluelytics.mobileapp.domain.ExtraRate
import com.bluelytics.mobileapp.domain.Latest
import com.bluelytics.mobileapp.domain.Snapshot
import com.bluelytics.mobileapp.domain.mergeSeries
import com.bluelytics.mobileapp.domain.parseCurrencies
import com.bluelytics.mobileapp.domain.parseEvolution
import com.bluelytics.mobileapp.domain.parseExtras
import com.bluelytics.mobileapp.domain.parseJson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.CoroutineContext

/** Everything the screens show, as one immutable value. */
data class StoreState(
    val latest: Latest? = null,
    /** The last ~45 days, oldest first. */
    val recent: List<DayRates> = emptyList(),
    val full: List<DayRates> = emptyList(),
    /** Every known day, oldest first. */
    val series: List<DayRates> = emptyList(),
    val currencies: List<Currency> = emptyList(),
    val alert: AlertInfo? = null,
    val extras: List<ExtraRate> = emptyList(),
    /** When the live quotes on screen were fetched. */
    val fetchedAt: Instant? = null,
    /** A refresh is running. */
    val loading: Boolean = false,
    /** The last refresh could not reach the API: what is on screen comes from the cache. */
    val offline: Boolean = false,
) {
    val hasData: Boolean get() = latest?.blue != null

    /** Whether the history since 2011 is loaded (it arrives after the live quotes). */
    val hasFullSeries: Boolean get() = full.isNotEmpty()

    val snapshot: Snapshot? get() = latest?.let { Snapshot.of(it, series) }
}

class AppStore(
    val fetcher: Fetcher,
    val cache: CacheStore,
    /** Outlives any one screen: a refresh carries on when whoever asked for it goes away. */
    private val scope: CoroutineScope,
    private val clock: () -> Instant = Instant::now,
    private val decodeContext: CoroutineContext = Dispatchers.Default,
) {
    private val _state = MutableStateFlow(StoreState())
    val state: StateFlow<StoreState> = _state.asStateFlow()

    private val fetched = ConcurrentHashMap<Feed, Instant>()
    private val lock = Any()
    private var inFlight: Deferred<Unit>? = null

    /** Loads the cached bodies. Safe to call once at start, before [refresh]. */
    suspend fun restore() {
        for (feed in Feed.entries) {
            val entry = cache.read(feed.name) ?: continue
            try {
                apply(feed, entry.body)
                fetched[feed] = entry.at
                if (feed == Feed.latest) _state.update { it.copy(fetchedAt = entry.at) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // A cache written by another version, or cut short: ignore it.
            }
        }
    }

    /**
     * Fetches the live feeds, and the slow ones when they are due. Concurrent calls share one run.
     * Without `force`, a refresh within [MIN_INTERVAL] of the last successful one does nothing.
     */
    suspend fun refresh(force: Boolean = false) {
        val run = synchronized(lock) {
            inFlight ?: run {
                val last = fetched[Feed.latest]
                if (!force && last != null && !_state.value.offline && Duration.between(last, clock()) < MIN_INTERVAL) return
                scope.async(start = CoroutineStart.LAZY) {
                    try {
                        doRefresh()
                    } finally {
                        synchronized(lock) { inFlight = null }
                    }
                }.also { inFlight = it }
            }
        }
        run.start()
        run.await()
    }

    private suspend fun doRefresh() {
        _state.update { it.copy(loading = true) }
        val now = clock()
        fun due(feed: Feed): Boolean {
            val at = fetched[feed]
            return at == null || Duration.between(at, now) >= SLOW_INTERVAL
        }

        val current = _state.value
        val feeds = buildList {
            add(Feed.latest)
            add(Feed.recent)
            add(Feed.alert)
            add(Feed.extras)
            if (current.currencies.isEmpty() || due(Feed.currencies)) add(Feed.currencies)
            if (current.full.isEmpty() || due(Feed.full)) add(Feed.full)
        }
        val results = coroutineScope { feeds.map { feed -> async { load(feed, now) } }.awaitAll() }
        // Only the live quotes decide whether the app is offline; the rest is optional or slow.
        val live = results.first()
        _state.update { it.copy(offline = !live, fetchedAt = if (live) now else it.fetchedAt, loading = false) }
    }

    private suspend fun load(feed: Feed, now: Instant): Boolean = try {
        val body = fetcher.fetch(feed)
        apply(feed, body)
        fetched[feed] = now
        scope.launch { cache.write(feed.name, CacheEntry(now, body)) }
        true
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        false
    }

    private suspend fun apply(feed: Feed, body: String) {
        when (feed) {
            Feed.latest -> {
                val parsed = Latest.fromJson(parseJson(body))
                if (parsed.blue == null) throw IllegalArgumentException("latest: no blue quote")
                _state.update { it.copy(latest = parsed) }
            }
            Feed.recent -> {
                val parsed = parseEvolution(parseJson(body))
                _state.update { it.copy(recent = parsed, series = mergeSeries(it.full, parsed)) }
            }
            Feed.full -> {
                // About 1 MB of JSON: decoded off the main thread.
                val parsed = withContext(decodeContext) { parseEvolution(parseJson(body)) }
                if (parsed.isEmpty()) throw IllegalArgumentException("evolution: empty")
                _state.update { it.copy(full = parsed, series = mergeSeries(parsed, it.recent)) }
            }
            Feed.currencies -> {
                val parsed = parseCurrencies(parseJson(body))
                if (parsed.isEmpty()) throw IllegalArgumentException("currencies: empty")
                _state.update { it.copy(currencies = parsed) }
            }
            Feed.alert -> {
                val parsed = AlertInfo.fromJson(parseJson(body))
                _state.update { it.copy(alert = parsed) }
            }
            Feed.extras -> {
                val parsed = parseExtras(parseJson(body))
                _state.update { it.copy(extras = parsed) }
            }
        }
    }

    companion object {
        /** The API caches live answers for 30 s: asking more often returns the same bytes. */
        val MIN_INTERVAL: Duration = Duration.ofSeconds(30)

        /** Feeds that change at most once a day. */
        val SLOW_INTERVAL: Duration = Duration.ofHours(6)
    }
}
