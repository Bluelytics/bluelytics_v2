/// Interface copy in Spanish (Argentina) and English, with the wording of the website.
library;

import '../domain/format.dart';

class Strings {
  const Strings._(this.locale);

  factory Strings.of(AppLocale locale) => locale == AppLocale.es ? es : en;

  static const Strings es = Strings._(AppLocale.es);
  static const Strings en = Strings._(AppLocale.en);

  final AppLocale locale;

  String _pick(String spanish, String english) => locale == AppLocale.es ? spanish : english;

  // Navigation
  String get tabToday => _pick('Hoy', 'Today');
  String get tabHistory => _pick('Histórico', 'History');
  String get tabCalculator => _pick('Calcular', 'Convert');
  String get tabAlerts => _pick('Alertas', 'Alerts');
  String get sections => _pick('Secciones', 'Sections');
  String get otherLanguageCode => _pick('EN', 'ES');
  String get switchLanguage => _pick('Switch to English', 'Cambiar a español');

  // Rates
  String get buy => _pick('Compra', 'Buy');
  String get sell => _pick('Venta', 'Sell');
  String get average => _pick('Promedio', 'Average');
  String get blue => _pick('Dólar blue', 'Blue dollar');
  String get oficial => _pick('Dólar oficial', 'Official dollar');
  String get blueShort => 'Blue';
  String get oficialShort => _pick('Oficial', 'Official');
  String get euroBlue => _pick('Euro blue', 'Blue euro');
  String get euroOficial => _pick('Euro oficial', 'Official euro');
  String get gap => _pick('Brecha', 'Gap');
  String get gapLong => _pick('Brecha cambiaria', 'Exchange gap');
  String get gapFoot => _pick('blue sobre oficial, venta', 'blue over official, sell');
  String get updated => _pick('Actualizado', 'Updated');
  String get offline => _pick('Sin conexión', 'Offline');
  String vsPrevious(String day) => _pick('vs. cierre del $day', 'vs. $day close');
  String get noData => _pick('Sin datos por ahora.', 'No data yet.');

  // Today
  String get todayTitle => _pick('Dólar blue hoy', 'Blue dollar today');
  String get allRates => _pick('Todas las cotizaciones', 'All rates');
  String get lastMonth => _pick('Blue y oficial, últimas semanas', 'Blue and official, last weeks');
  String get otherRates => _pick('Otros tipos de dólar', 'Other dollar rates');
  String get otherRatesNote => _pick('Referencia publicada por Ámbito. Valores de venta.', 'Reference values published by Ámbito. Sell prices.');
  String extraName(String code) => switch (code) {
    'mep' => _pick('Dólar MEP', 'MEP dollar'),
    'ccl' => _pick('Contado con liqui', 'CCL dollar'),
    'cripto' => _pick('Dólar cripto', 'Crypto dollar'),
    'tarjeta' => _pick('Dólar tarjeta', 'Card dollar'),
    'mayorista' => _pick('Dólar mayorista', 'Wholesale dollar'),
    _ => code.toUpperCase(),
  };
  String get quickTitle => _pick('Dólares a pesos', 'Dollars to pesos');
  String get ifYouBuy => _pick('Si comprás', 'If you buy');
  String get ifYouSell => _pick('Si vendés', 'If you sell');
  String get quickNote => _pick(
    'Al precio del dólar blue: comprás a precio de venta y vendés a precio de compra.',
    'At the blue dollar rate: you buy at the sell price and sell at the buy price.',
  );
  String get firstLoadFailed => _pick('No pudimos traer las cotizaciones.', 'We could not load the rates.');
  String get firstLoadHint => _pick('Revisá tu conexión y probá de nuevo.', 'Check your connection and try again.');
  String get retry => _pick('Reintentar', 'Try again');
  String get loading => _pick('Cargando…', 'Loading…');

  // History
  String get historyTitle => _pick('Histórico', 'History');
  String get historyLead => _pick('Dólar blue y oficial, día por día desde 2011.', 'Blue and official dollar, day by day since 2011.');
  String get modeRates => _pick('Cotización', 'Rates');
  String get modeGap => _pick('Brecha', 'Gap');
  String get chartOf => _pick('Gráfico', 'Chart');
  String get range => _pick('Período', 'Range');
  String rangeLabel(String key) => switch (key) {
    'm1' => _pick('1M', '1M'),
    'm3' => _pick('3M', '3M'),
    'm6' => _pick('6M', '6M'),
    'y1' => _pick('1A', '1Y'),
    'y5' => _pick('5A', '5Y'),
    _ => _pick('Máx', 'Max'),
  };
  String get change => _pick('Variación', 'Change');
  String get lowest => _pick('Mínimo', 'Low');
  String get highest => _pick('Máximo', 'High');
  String get gapNow => _pick('Brecha actual', 'Gap now');
  String get dayByDay => _pick('Día por día', 'Day by day');
  String get date => _pick('Fecha', 'Date');
  String get blueSellHead => _pick('Blue venta', 'Blue sell');
  String get blueBuyHead => _pick('Blue compra', 'Blue buy');
  String get oficialSellHead => _pick('Oficial', 'Official');
  String get loadingHistory => _pick('Cargando el histórico completo…', 'Loading the full history…');
  String daysCount(int n) => _pick('$n días con datos', '$n days with data');

  // Calculator
  String get calcTitle => _pick('Calculadora', 'Converter');
  String get calcLead => _pick('Cuántos pesos son, al blue y al oficial.', 'What it comes to in pesos, at the blue and official rates.');
  String get amount => _pick('Monto', 'Amount');
  String get currency => _pick('Moneda', 'Currency');
  String get swap => _pick('Invertir', 'Swap');
  String get toPesos => _pick('a pesos', 'to pesos');
  String get fromPesos => _pick('desde pesos', 'from pesos');
  String get pesos => _pick('Pesos argentinos', 'Argentine pesos');
  String get chooseCurrency => _pick('Elegí la moneda', 'Choose a currency');
  String get searchCurrency => _pick('Buscar moneda o código', 'Search currency or code');
  String get groupMain => _pick('Principales', 'Main');
  String get groupAmericas => _pick('Monedas de América (vía dólar)', 'Currencies of the Americas (via the dollar)');
  String get groupOther => _pick('Otras monedas (vía dólar)', 'Other currencies (via the dollar)');
  String get noMatches => _pick('Ninguna moneda coincide.', 'No currency matches.');
  String get youPay => _pick('Si comprás (a precio de venta)', 'If you buy (at the sell price)');
  String get youGet => _pick('Si vendés (a precio de compra)', 'If you sell (at the buy price)');
  String get enterAmount => _pick('Escribí un monto.', 'Enter an amount.');
  String get viaDollar => _pick(
    'Convertido a través del dólar con tipos de cambio internacionales de referencia.',
    'Converted through the dollar with international reference exchange rates.',
  );
  String get copied => _pick('Copiado', 'Copied');
  String get close => _pick('Cerrar', 'Close');
  String rateLine(String unit, String price) => _pick('1 $unit = $price', '1 $unit = $price');

  // Alerts
  String get alertsTitle => _pick('Alertas', 'Alerts');
  String get alertsLead => _pick('Te avisamos cuando el dólar blue se mueve.', 'We tell you when the blue dollar moves.');
  String get alertsToggle => _pick('Alertas del dólar blue', 'Blue dollar alerts');
  String get alertsHelp => _pick(
    'Con las alertas activadas vas a recibir una notificación cada vez que haya un cambio significativo en el precio de venta del dólar blue.',
    'With alerts on you get a notification every time the blue dollar sell price moves significantly.',
  );
  String get alertsOn => _pick('Activadas', 'On');
  String get alertsOff => _pick('Desactivadas', 'Off');
  String get alertsDenied => _pick(
    'Las notificaciones están bloqueadas para Bluelytics. Habilitalas en los ajustes del sistema y volvé a intentar.',
    'Notifications are blocked for Bluelytics. Allow them in the system settings and try again.',
  );
  String get alertsFailed =>
      _pick('No pudimos cambiar las alertas. Revisá tu conexión y probá de nuevo.', 'We could not change the alerts. Check your connection and try again.');
  String get alertsUnsupported =>
      _pick('Las alertas solo están disponibles en la app para iOS y Android.', 'Alerts are only available in the iOS and Android app.');
  String get lastAlert => _pick('Última alerta', 'Last alert');
  String get noAlertYet => _pick('Todavía no hay alertas.', 'No alerts yet.');
  String get alertRose => _pick('Subió el dólar blue', 'The blue dollar rose');
  String get alertFell => _pick('Bajó el dólar blue', 'The blue dollar fell');
  String get alertMoved => _pick('Se movió el dólar blue', 'The blue dollar moved');

  // About
  String get aboutTitle => _pick('Acerca de Bluelytics', 'About Bluelytics');
  String get aboutBody => _pick(
    'Cada 5 minutos, en días hábiles de 7 a 20 h, consultamos varios sitios públicos y publicamos la mediana de los valores actualizados del dólar blue. El dólar oficial es el billete del Banco Nación.',
    'Every 5 minutes on weekdays from 7:00 to 20:00 (Buenos Aires time) we read several public websites and publish the median of the fresh blue dollar values. The official dollar is Banco Nación’s counter rate.',
  );
  String get disclaimer => _pick(
    'Los valores son de referencia. Bluelytics no compra ni vende divisas.',
    'Values are for reference only. Bluelytics does not buy or sell currency.',
  );
  String get linkSite => _pick('Sitio web', 'Website');
  String get linkMethod => _pick('Cómo calculamos', 'How we calculate');
  String get linkApi => _pick('API pública', 'Public API');
  String get linkSource => _pick('Código fuente', 'Source code');
  String get linkLicense => _pick('Datos bajo licencia CC BY 4.0', 'Data licensed CC BY 4.0');
  String get follow => _pick('Seguinos', 'Follow');
  String version(String v) => _pick('Versión $v', 'Version $v');
  String get language => _pick('Idioma', 'Language');
}
