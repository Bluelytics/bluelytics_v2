/*
 * Display formatting for both languages; a port of apps/web/src/lib/format.ts so the app and the
 * site print every number the same way. Spanish follows es-AR: `.` thousands, `,` decimals,
 * `$ 1.675`, `4,9 %`, 24-hour clock. Money is always an integer number of hundredths of a peso.
 */
package com.bluelytics.mobileapp.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.abs
import kotlin.math.roundToLong

enum class AppLocale {
    es,
    en,
    ;

    companion object {
        fun fromCode(code: String?): AppLocale = if (code == "en") en else es
    }
}

const val NBSP = " "

/** Typographic minus (U+2212). */
const val MINUS = "−"

private val months = mapOf(
    AppLocale.es to listOf("enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"),
    AppLocale.en to listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
)

private val monthsShort = mapOf(
    AppLocale.es to listOf("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"),
    AppLocale.en to listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
)

private fun thousands(locale: AppLocale) = if (locale == AppLocale.es) "." else ","

private fun decimal(locale: AppLocale) = if (locale == AppLocale.es) "," else "."

private fun group(digits: String, separator: String): String {
    val out = StringBuilder()
    for (i in digits.indices) {
        if (i > 0 && (digits.length - i) % 3 == 0) out.append(separator)
        out.append(digits[i])
    }
    return out.toString()
}

/** `1675` → `1.675` (es) / `1,675` (en). Negative values use the typographic minus. */
fun formatInteger(value: Long, locale: AppLocale): String {
    val text = group(abs(value).toString(), thousands(locale))
    return if (value < 0) "$MINUS$text" else text
}

fun formatInteger(value: Int, locale: AppLocale): String = formatInteger(value.toLong(), locale)

/** Hundredths → `1.652,50` / `1,652.50`. */
fun formatHundredths(hundredths: Long, locale: AppLocale): String {
    val abs = abs(hundredths)
    val whole = group((abs / 100).toString(), thousands(locale))
    val text = "$whole${decimal(locale)}${(abs % 100).toString().padStart(2, '0')}"
    return if (hundredths < 0) "$MINUS$text" else text
}

/** Whole pesos when the amount has no cents, two decimals otherwise: `1.675` or `4,05`. */
fun formatAmount(hundredths: Long, locale: AppLocale): String =
    if (hundredths % 100 == 0L) formatInteger(hundredths / 100, locale) else formatHundredths(hundredths, locale)

private fun withCurrency(amount: String, locale: AppLocale, sign: String = "$"): String =
    if (locale == AppLocale.es) "$sign$NBSP$amount" else "$sign$amount"

/** A price: `$ 1.675` / `$1,675`, with cents only when there are any (`$ 4,05`). */
fun formatPesos(hundredths: Long, locale: AppLocale): String = withCurrency(formatAmount(hundredths, locale), locale)

/** A price always with cents: `$ 1.652,50` / `$1,652.50`. */
fun formatPesosCents(hundredths: Long, locale: AppLocale): String = withCurrency(formatHundredths(hundredths, locale), locale)

/** An amount of another currency, always with cents: `US$ 58,48` / `US$58.48`. */
fun formatForeign(hundredths: Long, sign: String, locale: AppLocale): String = withCurrency(formatHundredths(hundredths, locale), locale, sign)

/** `+20` / `−20` / `0`, with cents only when there are any. */
fun formatSignedAmount(hundredths: Long, locale: AppLocale): String {
    val text = formatAmount(abs(hundredths), locale)
    if (hundredths > 0) return "+$text"
    return if (hundredths < 0) "$MINUS$text" else text
}

private fun pow10(exponent: Int): Long {
    var result = 1L
    repeat(exponent) { result *= 10 }
    return result
}

/** Dart's `round()`: half away from zero (Kotlin's `roundToLong` rounds half up, towards +∞). */
internal fun roundHalfAway(value: Double): Long = if (value < 0) -(-value).roundToLong() else value.roundToLong()

/** A ratio as a percentage: `0.049` → `4,9 %` / `4.9%`. */
fun formatPercent(ratio: Double, locale: AppLocale, digits: Int = 1): String {
    val unit = pow10(digits)
    val scaled = roundHalfAway(abs(ratio) * 100 * unit)
    val negative = ratio < 0 && scaled != 0L
    val whole = group((scaled / unit).toString(), thousands(locale))
    val fraction = if (digits > 0) "${decimal(locale)}${(scaled % unit).toString().padStart(digits, '0')}" else ""
    val text = "${if (negative) MINUS else ""}$whole$fraction"
    return if (locale == AppLocale.es) "$text$NBSP%" else "$text%"
}

/** `+0,9 %` / `−0,9 %` / `0,0 %`. */
fun formatSignedPercent(ratio: Double, locale: AppLocale, digits: Int = 1): String {
    val text = formatPercent(ratio, locale, digits)
    val zero = roundHalfAway(abs(ratio) * 100 * pow10(digits)) == 0L
    return if (text.startsWith(MINUS) || zero) text else "+$text"
}

fun monthName(month: Int, locale: AppLocale): String = months.getValue(locale)[month - 1]

fun monthShort(month: Int, locale: AppLocale): String = monthsShort.getValue(locale)[month - 1]

/**
 * `day` is `YYYY-MM-DD`. Long: `20 de noviembre de 2026` / `November 20, 2026`;
 * short: `20 nov 2026` / `Nov 20, 2026`.
 */
fun formatDay(day: String, locale: AppLocale, short: Boolean = false): String {
    val year = day.substring(0, 4)
    val month = day.substring(5, 7).toInt()
    val date = day.substring(8, 10).toInt()
    val name = if (short) monthShort(month, locale) else monthName(month, locale)
    if (locale == AppLocale.es) return if (short) "$date $name $year" else "$date de $name de $year"
    return "$name $date, $year"
}

/** `20/11` (es) / `11/20` (en), optionally with the year: compact axis and table labels. */
fun formatDayNumeric(day: String, locale: AppLocale, withYear: Boolean = false): String {
    val dd = day.substring(8, 10)
    val mm = day.substring(5, 7)
    val year = if (withYear) "/${day.substring(2, 4)}" else ""
    return if (locale == AppLocale.es) "$dd/$mm$year" else "$mm/$dd$year"
}

/** `mar 2024` / `Mar 2024`: axis labels. */
fun formatMonthShort(year: Int, month: Int, locale: AppLocale): String = "${monthShort(month, locale)} $year"

/** Argentina keeps UTC−3 all year (no daylight saving since 2009). */
private val ART: ZoneOffset = ZoneOffset.ofHours(-3)

private fun two(value: Int) = value.toString().padStart(2, '0')

/** The Argentine calendar day of an instant, `YYYY-MM-DD`. */
fun artDay(instant: Instant): String {
    val t = instant.atOffset(ART)
    return "${t.year.toString().padStart(4, '0')}-${two(t.monthValue)}-${two(t.dayOfMonth)}"
}

/** Argentine wall-clock time of an instant: `19:45`. */
fun formatTime(instant: Instant): String {
    val t = instant.atOffset(ART)
    return "${two(t.hour)}:${two(t.minute)}"
}

/** Argentine date and time of an instant: `20 nov 2026, 19:45` / `Nov 20, 2026, 19:45`. */
fun formatDateTime(instant: Instant, locale: AppLocale): String = "${formatDay(artDay(instant), locale, short = true)}, ${formatTime(instant)}"

/** Coarse elapsed time: `hace 5 min` / `5 min ago`, then hours, then days. */
fun formatAgo(from: Instant, now: Instant, locale: AppLocale): String {
    val minutes = Duration.between(from, now).toMinutes().coerceAtLeast(0)
    val amount = when {
        minutes < 60 -> "$minutes min"
        minutes < 48 * 60 -> "${minutes / 60} h"
        locale == AppLocale.es -> "${minutes / 1440} días"
        else -> "${minutes / 1440} days"
    }
    return if (locale == AppLocale.es) "hace $amount" else "$amount ago"
}

private val amountPattern = Regex("""^\d+(\.\d+)?$""")
private val amountJunk = Regex("""[\s$ ]""")

/** Parses an amount typed in either notation (`1.234,5` or `1,234.5`); `null` when it is not a number. */
fun parseAmount(text: String, locale: AppLocale): Double? {
    var clean = text.trim().replace(amountJunk, "")
    if (clean.isEmpty()) return null
    clean = if (locale == AppLocale.es) clean.replace(".", "").replaceFirst(",", ".") else clean.replace(",", "")
    if (!amountPattern.matches(clean)) return null
    return clean.toDoubleOrNull()
}

/** A `YYYY-MM-DD` day as a date (UTC calendar arithmetic only). */
internal fun parseDay(day: String): LocalDate = LocalDate.parse(day)
