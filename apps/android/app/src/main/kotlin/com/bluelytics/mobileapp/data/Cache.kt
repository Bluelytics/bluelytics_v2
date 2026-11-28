/* The last body of each feed, kept on disk so the app opens with numbers before the network
 * answers and still shows them offline. */
package com.bluelytics.mobileapp.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.Instant
import java.time.format.DateTimeParseException

/** A cached body and when it was fetched. */
data class CacheEntry(val at: Instant, val body: String)

interface CacheStore {
    suspend fun read(key: String): CacheEntry?

    suspend fun write(key: String, entry: CacheEntry)
}

class MemoryCacheStore : CacheStore {
    val entries: MutableMap<String, CacheEntry> = java.util.concurrent.ConcurrentHashMap()

    override suspend fun read(key: String): CacheEntry? = entries[key]

    override suspend fun write(key: String, entry: CacheEntry) {
        entries[key] = entry
    }
}

/**
 * One file per key: the fetch time on the first line, then the body. Every error is swallowed: a
 * cache that cannot be read or written only costs a network request.
 */
class FileCacheStore(private val directory: () -> File) : CacheStore {
    private fun file(key: String) = File(directory(), "bluelytics-$key.txt")

    override suspend fun read(key: String): CacheEntry? = withContext(Dispatchers.IO) {
        try {
            val file = file(key)
            if (!file.exists()) return@withContext null
            val text = file.readText()
            val split = text.indexOf('\n')
            if (split < 0) return@withContext null
            val at = try {
                Instant.parse(text.substring(0, split))
            } catch (_: DateTimeParseException) {
                return@withContext null
            }
            CacheEntry(at, text.substring(split + 1))
        } catch (_: Exception) {
            null
        }
    }

    override suspend fun write(key: String, entry: CacheEntry) = withContext(Dispatchers.IO) {
        try {
            val file = file(key)
            file.parentFile?.mkdirs()
            // Written whole to a sibling and renamed, so a kill mid-write never leaves half a file.
            val temp = File(file.path + ".tmp")
            temp.outputStream().use { stream ->
                stream.write("${entry.at}\n${entry.body}".toByteArray(Charsets.UTF_8))
                stream.fd.sync()
            }
            if (!temp.renameTo(file)) temp.delete()
        } catch (_: Exception) {
            // Nothing to do: the next refresh tries again.
        }
        Unit
    }
}
