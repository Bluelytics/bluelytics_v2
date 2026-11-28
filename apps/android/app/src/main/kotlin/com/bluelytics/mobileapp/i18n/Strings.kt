/* Interface copy in Spanish (Argentina) and English, with the wording of the website. Kept in code,
 * not in Android resources, so the language toggle in the header switches it at once. */
package com.bluelytics.mobileapp.i18n

import com.bluelytics.mobileapp.domain.AppLocale

class Strings private constructor(val locale: AppLocale) {
    private fun pick(spanish: String, english: String): String = if (locale == AppLocale.es) spanish else english

    // Navigation
    val tabToday: String get() = pick("Hoy", "Today")
    val tabHistory: String get() = pick("Histórico", "History")
    val tabCalculator: String get() = pick("Calcular", "Convert")
    val tabAlerts: String get() = pick("Alertas", "Alerts")
    val sections: String get() = pick("Secciones", "Sections")
    val otherLanguageCode: String get() = pick("EN", "ES")
    val switchLanguage: String get() = pick("Switch to English", "Cambiar a español")

    // Rates
    val buy: String get() = pick("Compra", "Buy")
    val sell: String get() = pick("Venta", "Sell")
    val average: String get() = pick("Promedio", "Average")
    val blue: String get() = pick("Dólar blue", "Blue dollar")
    val oficial: String get() = pick("Dólar oficial", "Official dollar")
    val blueShort: String get() = "Blue"
    val oficialShort: String get() = pick("Oficial", "Official")
    val euroBlue: String get() = pick("Euro blue", "Blue euro")
    val euroOficial: String get() = pick("Euro oficial", "Official euro")
    val gap: String get() = pick("Brecha", "Gap")
    val gapLong: String get() = pick("Brecha cambiaria", "Exchange gap")
    val gapFoot: String get() = pick("blue sobre oficial, venta", "blue over official, sell")
    val updated: String get() = pick("Actualizado", "Updated")
    val offline: String get() = pick("Sin conexión", "Offline")
    fun vsPrevious(day: String): String = pick("vs. cierre del $day", "vs. $day close")
    val noData: String get() = pick("Sin datos por ahora.", "No data yet.")

    // Today
    val todayTitle: String get() = pick("Dólar blue hoy", "Blue dollar today")
    val allRates: String get() = pick("Todas las cotizaciones", "All rates")
    val lastMonth: String get() = pick("Blue y oficial, últimas semanas", "Blue and official, last weeks")
    val otherRates: String get() = pick("Otros tipos de dólar", "Other dollar rates")
    val otherRatesNote: String get() = pick("Referencia publicada por Ámbito. Valores de venta.", "Reference values published by Ámbito. Sell prices.")
    fun extraName(code: String): String = when (code) {
        "mep" -> pick("Dólar MEP", "MEP dollar")
        "ccl" -> pick("Contado con liqui", "CCL dollar")
        "cripto" -> pick("Dólar cripto", "Crypto dollar")
        "tarjeta" -> pick("Dólar tarjeta", "Card dollar")
        "mayorista" -> pick("Dólar mayorista", "Wholesale dollar")
        else -> code.uppercase()
    }
    val quickTitle: String get() = pick("Dólares a pesos", "Dollars to pesos")
    val ifYouBuy: String get() = pick("Si comprás", "If you buy")
    val ifYouSell: String get() = pick("Si vendés", "If you sell")
    val quickNote: String get() = pick("Al precio del dólar blue: comprás a precio de venta y vendés a precio de compra.", "At the blue dollar rate: you buy at the sell price and sell at the buy price.")
    val firstLoadFailed: String get() = pick("No pudimos traer las cotizaciones.", "We could not load the rates.")
    val firstLoadHint: String get() = pick("Revisá tu conexión y probá de nuevo.", "Check your connection and try again.")
    val retry: String get() = pick("Reintentar", "Try again")
    val loading: String get() = pick("Cargando…", "Loading…")

    // History
    val historyTitle: String get() = pick("Histórico", "History")
    val historyLead: String get() = pick("Dólar blue y oficial, día por día desde 2011.", "Blue and official dollar, day by day since 2011.")
    val modeRates: String get() = pick("Cotización", "Rates")
    val modeGap: String get() = pick("Brecha", "Gap")
    val chartOf: String get() = pick("Gráfico", "Chart")
    val range: String get() = pick("Período", "Range")
    fun rangeLabel(key: String): String = when (key) {
        "m1" -> pick("1M", "1M")
        "m3" -> pick("3M", "3M")
        "m6" -> pick("6M", "6M")
        "y1" -> pick("1A", "1Y")
        "y5" -> pick("5A", "5Y")
        else -> pick("Máx", "Max")
    }
    val change: String get() = pick("Variación", "Change")
    val lowest: String get() = pick("Mínimo", "Low")
    val highest: String get() = pick("Máximo", "High")
    val gapNow: String get() = pick("Brecha actual", "Gap now")
    val dayByDay: String get() = pick("Día por día", "Day by day")
    val date: String get() = pick("Fecha", "Date")
    val blueSellHead: String get() = pick("Blue venta", "Blue sell")
    val blueBuyHead: String get() = pick("Blue compra", "Blue buy")
    val oficialSellHead: String get() = pick("Oficial", "Official")
    val loadingHistory: String get() = pick("Cargando el histórico completo…", "Loading the full history…")
    fun daysCount(n: Int): String = pick("$n días con datos", "$n days with data")

    // Calculator
    val calcTitle: String get() = pick("Calculadora", "Converter")
    val calcLead: String get() = pick("Cuántos pesos son, al blue y al oficial.", "What it comes to in pesos, at the blue and official rates.")
    val amount: String get() = pick("Monto", "Amount")
    val currency: String get() = pick("Moneda", "Currency")
    val swap: String get() = pick("Invertir", "Swap")
    val toPesos: String get() = pick("a pesos", "to pesos")
    val fromPesos: String get() = pick("desde pesos", "from pesos")
    val pesos: String get() = pick("Pesos argentinos", "Argentine pesos")
    val chooseCurrency: String get() = pick("Elegí la moneda", "Choose a currency")
    val searchCurrency: String get() = pick("Buscar moneda o código", "Search currency or code")
    val groupMain: String get() = pick("Principales", "Main")
    val groupAmericas: String get() = pick("Monedas de América (vía dólar)", "Currencies of the Americas (via the dollar)")
    val groupOther: String get() = pick("Otras monedas (vía dólar)", "Other currencies (via the dollar)")
    val noMatches: String get() = pick("Ninguna moneda coincide.", "No currency matches.")
    val youPay: String get() = pick("Si comprás (a precio de venta)", "If you buy (at the sell price)")
    val youGet: String get() = pick("Si vendés (a precio de compra)", "If you sell (at the buy price)")
    val enterAmount: String get() = pick("Escribí un monto.", "Enter an amount.")
    val viaDollar: String get() = pick("Convertido a través del dólar con tipos de cambio internacionales de referencia.", "Converted through the dollar with international reference exchange rates.")
    val copied: String get() = pick("Copiado", "Copied")
    val close: String get() = pick("Cerrar", "Close")
    fun rateLine(unit: String, price: String): String = pick("1 $unit = $price", "1 $unit = $price")

    // Alerts
    val alertsTitle: String get() = pick("Alertas", "Alerts")
    val alertsLead: String get() = pick("Te avisamos cuando el dólar blue se mueve.", "We tell you when the blue dollar moves.")
    val alertsToggle: String get() = pick("Alertas del dólar blue", "Blue dollar alerts")
    val alertsHelp: String get() = pick("Con las alertas activadas vas a recibir una notificación cada vez que haya un cambio significativo en el precio de venta del dólar blue.", "With alerts on you get a notification every time the blue dollar sell price moves significantly.")
    val alertsOn: String get() = pick("Activadas", "On")
    val alertsOff: String get() = pick("Desactivadas", "Off")
    val alertsDenied: String get() = pick("Las notificaciones están bloqueadas para Bluelytics. Habilitalas en los ajustes del sistema y volvé a intentar.", "Notifications are blocked for Bluelytics. Allow them in the system settings and try again.")
    val alertsFailed: String get() = pick("No pudimos cambiar las alertas. Revisá tu conexión y probá de nuevo.", "We could not change the alerts. Check your connection and try again.")
    val alertsUnsupported: String get() = pick("Las alertas solo están disponibles en la app para iOS y Android.", "Alerts are only available in the iOS and Android app.")
    val lastAlert: String get() = pick("Última alerta", "Last alert")
    val noAlertYet: String get() = pick("Todavía no hay alertas.", "No alerts yet.")
    val alertRose: String get() = pick("Subió el dólar blue", "The blue dollar rose")
    val alertFell: String get() = pick("Bajó el dólar blue", "The blue dollar fell")
    val alertMoved: String get() = pick("Se movió el dólar blue", "The blue dollar moved")

    // About
    val aboutTitle: String get() = pick("Acerca de Bluelytics", "About Bluelytics")
    val aboutBody: String get() = pick("Cada 5 minutos, en días hábiles de 7 a 20 h, consultamos varios sitios públicos y publicamos la mediana de los valores actualizados del dólar blue. El dólar oficial es el billete del Banco Nación.", "Every 5 minutes on weekdays from 7:00 to 20:00 (Buenos Aires time) we read several public websites and publish the median of the fresh blue dollar values. The official dollar is Banco Nación’s counter rate.")
    val disclaimer: String get() = pick("Los valores son de referencia. Bluelytics no compra ni vende divisas.", "Values are for reference only. Bluelytics does not buy or sell currency.")
    val linkSite: String get() = pick("Sitio web", "Website")
    val linkMethod: String get() = pick("Cómo calculamos", "How we calculate")
    val linkApi: String get() = pick("API pública", "Public API")
    val linkSource: String get() = pick("Código fuente", "Source code")
    val linkLicense: String get() = pick("Datos bajo licencia CC BY 4.0", "Data licensed CC BY 4.0")
    val follow: String get() = pick("Seguinos", "Follow")
    fun version(v: String): String = pick("Versión $v", "Version $v")
    val language: String get() = pick("Idioma", "Language")

    companion object {
        val es = Strings(AppLocale.es)
        val en = Strings(AppLocale.en)

        fun of(locale: AppLocale): Strings = if (locale == AppLocale.es) es else en
    }
}
