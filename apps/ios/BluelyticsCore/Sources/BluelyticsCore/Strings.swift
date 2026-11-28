// Interface copy in Spanish (Argentina) and English, with the wording of the website. An in-code
// table rather than a strings catalog, so the ES/EN button switches language at once.
import Foundation

public struct Strings: Sendable {
    public let locale: AppLocale

    public static let es = Strings(locale: .es)
    public static let en = Strings(locale: .en)

    public static func of(_ locale: AppLocale) -> Strings { locale == .es ? es : en }

    private func pick(_ spanish: String, _ english: String) -> String { locale == .es ? spanish : english }

    // Navigation
    public var tabToday: String { pick("Hoy", "Today") }
    public var tabHistory: String { pick("Histórico", "History") }
    public var tabCalculator: String { pick("Calcular", "Convert") }
    public var tabAlerts: String { pick("Alertas", "Alerts") }
    public var sections: String { pick("Secciones", "Sections") }
    public var otherLanguageCode: String { pick("EN", "ES") }
    public var switchLanguage: String { pick("Switch to English", "Cambiar a español") }

    // Rates
    public var buy: String { pick("Compra", "Buy") }
    public var sell: String { pick("Venta", "Sell") }
    public var average: String { pick("Promedio", "Average") }
    public var blue: String { pick("Dólar blue", "Blue dollar") }
    public var oficial: String { pick("Dólar oficial", "Official dollar") }
    public var blueShort: String { "Blue" }
    public var oficialShort: String { pick("Oficial", "Official") }
    public var euroBlue: String { pick("Euro blue", "Blue euro") }
    public var euroOficial: String { pick("Euro oficial", "Official euro") }
    public var gap: String { pick("Brecha", "Gap") }
    public var gapLong: String { pick("Brecha cambiaria", "Exchange gap") }
    public var gapFoot: String { pick("blue sobre oficial, venta", "blue over official, sell") }
    public var updated: String { pick("Actualizado", "Updated") }
    public var offline: String { pick("Sin conexión", "Offline") }
    public func vsPrevious(_ day: String) -> String { pick("vs. cierre del \(day)", "vs. \(day) close") }
    public var noData: String { pick("Sin datos por ahora.", "No data yet.") }

    // Today
    public var todayTitle: String { pick("Dólar blue hoy", "Blue dollar today") }
    public var allRates: String { pick("Todas las cotizaciones", "All rates") }
    public var lastMonth: String { pick("Blue y oficial, últimas semanas", "Blue and official, last weeks") }
    public var otherRates: String { pick("Otros tipos de dólar", "Other dollar rates") }
    public var otherRatesNote: String { pick("Referencia publicada por Ámbito. Valores de venta.", "Reference values published by Ámbito. Sell prices.") }
    public func extraName(_ code: String) -> String {
        switch code {
        case "mep": return pick("Dólar MEP", "MEP dollar")
        case "ccl": return pick("Contado con liqui", "CCL dollar")
        case "cripto": return pick("Dólar cripto", "Crypto dollar")
        case "tarjeta": return pick("Dólar tarjeta", "Card dollar")
        case "mayorista": return pick("Dólar mayorista", "Wholesale dollar")
        default: return code.uppercased()
        }
    }
    public var quickTitle: String { pick("Dólares a pesos", "Dollars to pesos") }
    public var ifYouBuy: String { pick("Si comprás", "If you buy") }
    public var ifYouSell: String { pick("Si vendés", "If you sell") }
    public var quickNote: String {
        pick(
            "Al precio del dólar blue: comprás a precio de venta y vendés a precio de compra.",
            "At the blue dollar rate: you buy at the sell price and sell at the buy price."
        )
    }
    public var firstLoadFailed: String { pick("No pudimos traer las cotizaciones.", "We could not load the rates.") }
    public var firstLoadHint: String { pick("Revisá tu conexión y probá de nuevo.", "Check your connection and try again.") }
    public var retry: String { pick("Reintentar", "Try again") }
    public var loading: String { pick("Cargando…", "Loading…") }

    // History
    public var historyTitle: String { pick("Histórico", "History") }
    public var historyLead: String { pick("Dólar blue y oficial, día por día desde 2011.", "Blue and official dollar, day by day since 2011.") }
    public var modeRates: String { pick("Cotización", "Rates") }
    public var modeGap: String { pick("Brecha", "Gap") }
    public var chartOf: String { pick("Gráfico", "Chart") }
    public var range: String { pick("Período", "Range") }
    public func rangeLabel(_ preset: RangePreset) -> String {
        switch preset {
        case .m1: return "1M"
        case .m3: return "3M"
        case .m6: return "6M"
        case .y1: return pick("1A", "1Y")
        case .y5: return pick("5A", "5Y")
        case .max: return pick("Máx", "Max")
        }
    }
    public var change: String { pick("Variación", "Change") }
    public var lowest: String { pick("Mínimo", "Low") }
    public var highest: String { pick("Máximo", "High") }
    public var gapNow: String { pick("Brecha actual", "Gap now") }
    public var dayByDay: String { pick("Día por día", "Day by day") }
    public var date: String { pick("Fecha", "Date") }
    public var blueSellHead: String { pick("Blue venta", "Blue sell") }
    public var blueBuyHead: String { pick("Blue compra", "Blue buy") }
    public var oficialSellHead: String { pick("Oficial", "Official") }
    public var loadingHistory: String { pick("Cargando el histórico completo…", "Loading the full history…") }
    public func daysCount(_ n: Int) -> String { pick("\(n) días con datos", "\(n) days with data") }

    // Calculator
    public var calcTitle: String { pick("Calculadora", "Converter") }
    public var calcLead: String { pick("Cuántos pesos son, al blue y al oficial.", "What it comes to in pesos, at the blue and official rates.") }
    public var amount: String { pick("Monto", "Amount") }
    public var currency: String { pick("Moneda", "Currency") }
    public var swap: String { pick("Invertir", "Swap") }
    public var toPesos: String { pick("a pesos", "to pesos") }
    public var fromPesos: String { pick("desde pesos", "from pesos") }
    public var pesos: String { pick("Pesos argentinos", "Argentine pesos") }
    public var chooseCurrency: String { pick("Elegí la moneda", "Choose a currency") }
    public var searchCurrency: String { pick("Buscar moneda o código", "Search currency or code") }
    public var groupMain: String { pick("Principales", "Main") }
    public var groupAmericas: String { pick("Monedas de América (vía dólar)", "Currencies of the Americas (via the dollar)") }
    public var groupOther: String { pick("Otras monedas (vía dólar)", "Other currencies (via the dollar)") }
    public var noMatches: String { pick("Ninguna moneda coincide.", "No currency matches.") }
    public var youPay: String { pick("Si comprás (a precio de venta)", "If you buy (at the sell price)") }
    public var youGet: String { pick("Si vendés (a precio de compra)", "If you sell (at the buy price)") }
    public var enterAmount: String { pick("Escribí un monto.", "Enter an amount.") }
    public var viaDollar: String {
        pick(
            "Convertido a través del dólar con tipos de cambio internacionales de referencia.",
            "Converted through the dollar with international reference exchange rates."
        )
    }
    public var copied: String { pick("Copiado", "Copied") }
    public var close: String { pick("Cerrar", "Close") }
    public func rateLine(_ unit: String, _ price: String) -> String { "1 \(unit) = \(price)" }

    // Alerts
    public var alertsTitle: String { pick("Alertas", "Alerts") }
    public var alertsLead: String { pick("Te avisamos cuando el dólar blue se mueve.", "We tell you when the blue dollar moves.") }
    public var alertsToggle: String { pick("Alertas del dólar blue", "Blue dollar alerts") }
    public var alertsHelp: String {
        pick(
            "Con las alertas activadas vas a recibir una notificación cada vez que haya un cambio significativo en el precio de venta del dólar blue.",
            "With alerts on you get a notification every time the blue dollar sell price moves significantly."
        )
    }
    public var alertsOn: String { pick("Activadas", "On") }
    public var alertsOff: String { pick("Desactivadas", "Off") }
    public var alertsDenied: String {
        pick(
            "Las notificaciones están bloqueadas para Bluelytics. Habilitalas en los ajustes del sistema y volvé a intentar.",
            "Notifications are blocked for Bluelytics. Allow them in the system settings and try again."
        )
    }
    public var alertsFailed: String {
        pick("No pudimos cambiar las alertas. Revisá tu conexión y probá de nuevo.", "We could not change the alerts. Check your connection and try again.")
    }
    public var alertsUnsupported: String {
        pick("Las alertas solo están disponibles en la app para iOS y Android.", "Alerts are only available in the iOS and Android app.")
    }
    public var lastAlert: String { pick("Última alerta", "Last alert") }
    public var noAlertYet: String { pick("Todavía no hay alertas.", "No alerts yet.") }
    public var alertRose: String { pick("Subió el dólar blue", "The blue dollar rose") }
    public var alertFell: String { pick("Bajó el dólar blue", "The blue dollar fell") }
    public var alertMoved: String { pick("Se movió el dólar blue", "The blue dollar moved") }

    // About
    public var aboutTitle: String { pick("Acerca de Bluelytics", "About Bluelytics") }
    public var aboutBody: String {
        pick(
            "Cada 5 minutos, en días hábiles de 7 a 20 h, consultamos varios sitios públicos y publicamos la mediana de los valores actualizados del dólar blue. El dólar oficial es el billete del Banco Nación.",
            "Every 5 minutes on weekdays from 7:00 to 20:00 (Buenos Aires time) we read several public websites and publish the median of the fresh blue dollar values. The official dollar is Banco Nación’s counter rate."
        )
    }
    public var disclaimer: String {
        pick(
            "Los valores son de referencia. Bluelytics no compra ni vende divisas.",
            "Values are for reference only. Bluelytics does not buy or sell currency."
        )
    }
    public var linkSite: String { pick("Sitio web", "Website") }
    public var linkMethod: String { pick("Cómo calculamos", "How we calculate") }
    public var linkApi: String { pick("API pública", "Public API") }
    public var linkSource: String { pick("Código fuente", "Source code") }
    public var linkLicense: String { pick("Datos bajo licencia CC BY 4.0", "Data licensed CC BY 4.0") }
    public var follow: String { pick("Seguinos", "Follow") }
    public func version(_ v: String) -> String { pick("Versión \(v)", "Version \(v)") }
    public var language: String { pick("Idioma", "Language") }
}
