/*
 * The API's shapes, parsed defensively: a missing or malformed field makes that value `null` rather
 * than throwing. Money is an integer number of hundredths of a peso.
 */
package com.bluelytics.mobileapp.domain

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import kotlin.math.roundToLong

/** Parses a body; throws on text that is not JSON. */
fun parseJson(body: String): JsonElement = Json.parseToJsonElement(body)

private fun JsonElement?.string(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement?.number(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

/** A JSON integer (no fraction), as Dart's `is int`. */
private fun JsonElement?.integer(): Long? {
    val primitive = (this as? JsonPrimitive)?.takeIf { !it.isString } ?: return null
    if (primitive.content.any { it == '.' || it == 'e' || it == 'E' }) return null
    return primitive.longOrNull
}

private fun instantOf(text: String?): Instant? {
    if (text == null) return null
    return try {
        OffsetDateTime.parse(text).toInstant()
    } catch (_: DateTimeParseException) {
        try {
            Instant.parse(text)
        } catch (_: DateTimeParseException) {
            null
        }
    }
}

/** `1700.00` → `170000`; anything that is not a positive finite number → `null`. */
fun hundredthsOf(value: JsonElement?): Long? {
    val number = value.number() ?: value.string()?.trim()?.toDoubleOrNull()
    return hundredthsOf(number)
}

fun hundredthsOf(number: Double?): Long? {
    if (number == null || !number.isFinite() || number <= 0) return null
    return (number * 100).roundToLong()
}

/** A buy/sell pair in hundredths of a peso. */
data class Quote(val buy: Long, val sell: Long) {
    /** The midpoint, rounded half up to a hundredth (as the API's `value_avg`). */
    val average: Long get() = (buy + sell + 1) / 2

    companion object {
        /** `{"value_buy": 1690.00, "value_sell": 1710.00}`; `null` unless both prices are positive. */
        fun fromJson(json: JsonElement?): Quote? {
            if (json !is JsonObject) return null
            val buy = hundredthsOf(json["value_buy"])
            val sell = hundredthsOf(json["value_sell"])
            return if (buy == null || sell == null) null else Quote(buy, sell)
        }
    }
}

/** `GET /v2/latest`. */
data class Latest(
    val blue: Quote? = null,
    val oficial: Quote? = null,
    val blueEuro: Quote? = null,
    val oficialEuro: Quote? = null,
    val updatedAt: Instant? = null,
) {
    companion object {
        fun fromJson(json: JsonElement?): Latest {
            if (json !is JsonObject) return Latest()
            return Latest(
                blue = Quote.fromJson(json["blue"]),
                oficial = Quote.fromJson(json["oficial"]),
                blueEuro = Quote.fromJson(json["blue_euro"]),
                oficialEuro = Quote.fromJson(json["oficial_euro"]),
                updatedAt = instantOf(json["last_update"].string()),
            )
        }
    }
}

/** One calendar day's closing rates; either may be missing. `day` is `YYYY-MM-DD`. */
data class DayRates(val day: String, val blue: Quote? = null, val oficial: Quote? = null)

private val dayPattern = Regex("""^\d{4}-\d{2}-\d{2}$""")

/** `GET /v2/evolution.json` (rows of one source per day, newest first) → days, oldest first. */
fun parseEvolution(json: JsonElement?): List<DayRates> {
    if (json !is JsonArray) return emptyList()
    val blue = HashMap<String, Quote>()
    val oficial = HashMap<String, Quote>()
    for (row in json) {
        if (row !is JsonObject) continue
        val day = row["date"].string()
        val quote = Quote.fromJson(row)
        if (day == null || !dayPattern.matches(day) || quote == null) continue
        when (row["source"].string()) {
            "Blue" -> blue[day] = quote
            "Oficial" -> oficial[day] = quote
        }
    }
    return (blue.keys + oficial.keys).sorted().map { DayRates(it, blue[it], oficial[it]) }
}

/** One entry of `GET /data/json/currency.json`: units of the currency per US dollar. */
data class Currency(val code: String, val name: String, val perUsdHundredths: Long)

fun parseCurrencies(json: JsonElement?): List<Currency> {
    if (json !is JsonArray) return emptyList()
    return json.mapNotNull { row ->
        if (row !is JsonObject) return@mapNotNull null
        val code = row["code"].string()
        val name = row["name"].string()
        val value = hundredthsOf(row["value"])
        if (code == null || name == null || value == null) null else Currency(code, name, value)
    }
}

/** `GET /v2/alerts`: the last significant move of the blue sell price. */
data class AlertInfo(val id: Long, val at: Instant, val current: Quote, val previous: Quote?) {
    companion object {
        fun fromJson(json: JsonElement?): AlertInfo? {
            if (json !is JsonObject) return null
            val id = json["alert_id"].integer()
            val at = instantOf(json["alert_at"].string())
            val current = Quote.fromJson(json["current"])
            if (id == null || at == null || current == null) return null
            return AlertInfo(id, at, current, Quote.fromJson(json["previous"]))
        }
    }
}

/** One entry of the site's `/data/extras.json`: a reference rate published by a third party. */
data class ExtraRate(val code: String, val sell: Long, val buy: Long?)

/** `{"rates":[{"code":"mep","buy":165250,"sell":165250}, …]}`, prices already in hundredths. */
fun parseExtras(json: JsonElement?): List<ExtraRate> {
    val rows = (json as? JsonObject)?.get("rates") as? JsonArray ?: return emptyList()
    return rows.mapNotNull { row ->
        if (row !is JsonObject) return@mapNotNull null
        val code = row["code"].string()
        val sell = row["sell"].integer()
        val buy = row["buy"].integer()
        if (code == null || sell == null || sell <= 0) null else ExtraRate(code, sell, buy?.takeIf { it > 0 })
    }
}
