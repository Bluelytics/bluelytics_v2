/*
 * Calculator arithmetic (the counterpart of apps/web/src/lib/calc.ts). The dollar and the euro use
 * the published rates; every other currency of `currency.json` is converted through the dollar,
 * like the original app: pesos per unit = dollar rate / units per USD.
 */
package com.bluelytics.mobileapp.domain

import kotlin.math.roundToLong

/** ISO codes of the currencies of the Americas (ARS and USD aside): listed first in the picker. */
val americas: Set<String> = setOf(
    "BRL", "CLP", "UYU", "PYG", "BOB", "PEN", "COP", "VES", "VEF", "ECS", "MXN", "CAD", "CRC", "SVC", "GTQ", "HNL",
    "NIO", "PAB", "DOP", "CUP", "CUC", "HTG", "JMD", "TTD", "BSD", "BBD", "BZD", "BMD", "KYD", "XCD", "AWG",
    "ANG", "SRD", "GYD", "FKP",
)

enum class CurrencyGroup { main, americas, other }

/** A currency the calculator can convert, with its group in the picker. */
data class CalcCurrency(
    val code: String,
    val name: String,
    val group: CurrencyGroup,
    /** Units per US dollar in hundredths; `null` for USD and EUR, which have published rates. */
    val perUsdHundredths: Long? = null,
) {
    /** Sign before an amount: `US$`, `€`, or the ISO code. */
    val sign: String
        get() = when (code) {
            "USD" -> "US$"
            "EUR" -> "€"
            else -> code
        }
}

/** USD and EUR first, then the Americas, then the rest; each group sorted by name. */
fun calcCurrencies(rows: List<Currency>, locale: AppLocale): List<CalcCurrency> {
    val es = locale == AppLocale.es
    val rest = rows
        .filter { it.code !in setOf("USD", "EUR", "ARS") && it.perUsdHundredths > 0 }
        .map {
            CalcCurrency(
                code = it.code,
                name = if (es) it.name else currencyNamesEn[it.code] ?: it.name,
                group = if (it.code in americas) CurrencyGroup.americas else CurrencyGroup.other,
                perUsdHundredths = it.perUsdHundredths,
            )
        }
        .sortedBy { fold(it.name) }
    return listOf(
        CalcCurrency("USD", if (es) "Dólar estadounidense" else "US dollar", CurrencyGroup.main),
        CalcCurrency("EUR", "Euro", CurrencyGroup.main),
    ) + rest.filter { it.group == CurrencyGroup.americas } + rest.filter { it.group == CurrencyGroup.other }
}

private val accents = mapOf('á' to 'a', 'é' to 'e', 'í' to 'i', 'ó' to 'o', 'ú' to 'u', 'ü' to 'u', 'ñ' to 'n')

/** Lower case without the Spanish accents; compared by code unit, as the Dart original. */
private fun fold(text: String): String = text.lowercase().map { accents[it] ?: it }.joinToString("")

/** Case- and accent-insensitive match of a search text against a currency's name or code. */
fun matchesCurrency(currency: CalcCurrency, query: String): Boolean {
    val needle = fold(query.trim())
    return needle.isEmpty() || fold(currency.name).contains(needle) || currency.code.lowercase().contains(needle)
}

/**
 * Hundredths of a peso per unit of `currency`, at the dollar (and euro) quotes given. Unrounded:
 * small currencies need the decimals. `null` when the rate is not available.
 */
fun rateFor(currency: CalcCurrency, usd: Long?, eur: Long?): Double? {
    if (currency.code == "USD") return usd?.toDouble()
    if (currency.code == "EUR") return eur?.toDouble()
    val perUsd = currency.perUsdHundredths
    if (usd == null || perUsd == null || perUsd <= 0) return null
    return usd * 100.0 / perUsd
}

/** Pesos in hundredths for `amount` units at `rateHundredths`. */
fun toPesosHundredths(amount: Double, rateHundredths: Double): Long = (amount * rateHundredths).roundToLong()

/** Units of the currency in hundredths for `pesos` at `rateHundredths`. */
fun toForeignHundredths(pesos: Double, rateHundredths: Double): Long =
    if (rateHundredths > 0) (pesos * 10000 / rateHundredths).roundToLong() else 0
