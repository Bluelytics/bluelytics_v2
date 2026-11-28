/* HTTP access to the public API. Bodies come back as text: the store caches them as received and
 * parses them with domain/Models.kt. */
package com.bluelytics.mobileapp.data

import com.bluelytics.mobileapp.API_BASE
import com.bluelytics.mobileapp.SITE_BASE
import com.bluelytics.mobileapp.appVersion
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** What the app reads, and from where. */
enum class Feed(val url: String) {
    /** Live quotes: blue, official and both euros. */
    latest("$API_BASE/v2/latest"),

    /** The last ~45 days with data (the endpoint counts rows: two per day). */
    recent("$API_BASE/v2/evolution.json?days=90"),

    /** Every day since 2011 (about 30 kB compressed). */
    full("$API_BASE/v2/evolution.json"),

    /** Units of every currency per US dollar. */
    currencies("$API_BASE/data/json/currency.json"),

    /** The last alert. */
    alert("$API_BASE/v2/alerts"),

    /** Reference rates published by third parties (MEP, CCL, …). Optional: served by the website. */
    extras("$SITE_BASE/data/extras.json"),
}

class ApiException(message: String) : IOException(message)

/** Fetches a feed's body; throws on a network error, a timeout or a non-200 status. */
fun interface Fetcher {
    suspend fun fetch(feed: Feed): String
}

class HttpFetcher(private val timeoutMillis: Int = 12_000) : Fetcher {
    override suspend fun fetch(feed: Feed): String = withContext(Dispatchers.IO) {
        val connection = try {
            URL(feed.url).openConnection() as HttpURLConnection
        } catch (error: IOException) {
            throw ApiException("${feed.name}: $error")
        }
        try {
            connection.connectTimeout = timeoutMillis
            connection.readTimeout = timeoutMillis
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Bluelytics-App/$appVersion (Android)")
            val status = connection.responseCode
            if (status != 200) throw ApiException("${feed.name}: HTTP $status")
            // Gzip is negotiated and undone by the platform's HTTP stack.
            connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (error: ApiException) {
            throw error
        } catch (error: IOException) {
            throw ApiException("${feed.name}: $error")
        } finally {
            connection.disconnect()
        }
    }
}
