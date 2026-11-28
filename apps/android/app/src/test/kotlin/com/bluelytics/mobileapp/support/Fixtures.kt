package com.bluelytics.mobileapp.support

import com.bluelytics.mobileapp.data.ApiException
import com.bluelytics.mobileapp.data.AppStore
import com.bluelytics.mobileapp.data.CacheStore
import com.bluelytics.mobileapp.data.Feed
import com.bluelytics.mobileapp.data.Fetcher
import com.bluelytics.mobileapp.data.MemoryCacheStore
import com.bluelytics.mobileapp.push.AlertMessage
import com.bluelytics.mobileapp.push.PushBackend
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import java.time.Instant
import java.util.Collections

/** The moment the fixtures were captured (just after their `last_update`), so "today" is stable. */
val fixtureNow: Instant = Instant.parse("2026-11-25T22:21:00Z")

private object FixtureAnchor

/** A body captured from production, in src/test/resources/fixtures. */
fun fixture(name: String): String =
    requireNotNull(FixtureAnchor::class.java.classLoader!!.getResource("fixtures/$name.json")) { "no fixture $name" }.readText()

/** Answers every feed from the fixtures. `fail` makes the listed feeds fail like a 503; `overrides` replaces a body. */
class FixtureFetcher(
    private val fail: Set<Feed> = emptySet(),
    private val overrides: Map<Feed, String> = emptyMap(),
) : Fetcher {
    val log: MutableList<Feed> = Collections.synchronizedList(ArrayList())

    override suspend fun fetch(feed: Feed): String {
        log.add(feed)
        if (feed in fail) throw ApiException("${feed.name}: HTTP 503")
        return overrides[feed] ?: fixture(feed.name)
    }
}

fun fixtureStore(
    scope: CoroutineScope,
    fail: Set<Feed> = emptySet(),
    overrides: Map<Feed, String> = emptyMap(),
    cache: CacheStore = MemoryCacheStore(),
    clock: () -> Instant = { fixtureNow },
): AppStore = AppStore(FixtureFetcher(fail, overrides), cache, scope, clock)

/** A push backend that records what the app asked of it. */
class FakePush(var grant: Boolean = true, var fail: Boolean = false) : PushBackend {
    val calls = mutableListOf<String>()
    private val incoming = MutableSharedFlow<AlertMessage>(extraBufferCapacity = 4)

    /** An alert arriving while the app is open. */
    fun receive(message: AlertMessage) {
        incoming.tryEmit(message)
    }

    override val supported = true

    override suspend fun enable(): Boolean {
        calls.add("enable")
        if (fail) throw IllegalStateException("network")
        return grant
    }

    override suspend fun disable() {
        calls.add("disable")
        if (fail) throw IllegalStateException("network")
    }

    override suspend fun resume() {
        calls.add("resume")
    }

    override val messages: Flow<AlertMessage> = incoming
}
