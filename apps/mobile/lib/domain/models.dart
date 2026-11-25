/// The API's shapes, parsed defensively: a missing or malformed field makes that value `null`
/// rather than throwing. Money is an integer number of hundredths of a peso.
library;

/// `1700.00` → `170000`; anything that is not a positive finite number → `null`.
int? hundredthsOf(Object? value) {
  final number = switch (value) {
    final num n => n.toDouble(),
    final String s => double.tryParse(s),
    _ => null,
  };
  if (number == null || !number.isFinite || number <= 0) return null;
  return (number * 100).round();
}

/// A buy/sell pair in hundredths of a peso.
class Quote {
  const Quote(this.buy, this.sell);

  final int buy;
  final int sell;

  /// The midpoint, rounded half up to a hundredth (as the API's `value_avg`).
  int get average => (buy + sell + 1) ~/ 2;

  /// `{"value_buy": 1690.00, "value_sell": 1710.00}`; `null` unless both prices are positive.
  static Quote? fromJson(Object? json) {
    if (json is! Map) return null;
    final buy = hundredthsOf(json['value_buy']);
    final sell = hundredthsOf(json['value_sell']);
    return buy == null || sell == null ? null : Quote(buy, sell);
  }

  @override
  bool operator ==(Object other) => other is Quote && other.buy == buy && other.sell == sell;

  @override
  int get hashCode => Object.hash(buy, sell);

  @override
  String toString() => 'Quote($buy, $sell)';
}

/// `GET /v2/latest`.
class Latest {
  const Latest({this.blue, this.oficial, this.blueEuro, this.oficialEuro, this.updatedAt});

  final Quote? blue;
  final Quote? oficial;
  final Quote? blueEuro;
  final Quote? oficialEuro;
  final DateTime? updatedAt;

  static Latest fromJson(Object? json) {
    if (json is! Map) return const Latest();
    final stamp = json['last_update'];
    return Latest(
      blue: Quote.fromJson(json['blue']),
      oficial: Quote.fromJson(json['oficial']),
      blueEuro: Quote.fromJson(json['blue_euro']),
      oficialEuro: Quote.fromJson(json['oficial_euro']),
      updatedAt: stamp is String ? DateTime.tryParse(stamp)?.toUtc() : null,
    );
  }
}

/// One calendar day's closing rates; either may be missing.
class DayRates {
  const DayRates(this.day, {this.blue, this.oficial});

  /// `YYYY-MM-DD`.
  final String day;
  final Quote? blue;
  final Quote? oficial;
}

final RegExp _dayPattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// `GET /v2/evolution.json` (rows of one source per day, newest first) → days, oldest first.
List<DayRates> parseEvolution(Object? json) {
  if (json is! List) return const [];
  final blue = <String, Quote>{};
  final oficial = <String, Quote>{};
  for (final row in json) {
    if (row is! Map) continue;
    final day = row['date'];
    final quote = Quote.fromJson(row);
    if (day is! String || !_dayPattern.hasMatch(day) || quote == null) continue;
    switch (row['source']) {
      case 'Blue':
        blue[day] = quote;
      case 'Oficial':
        oficial[day] = quote;
    }
  }
  final days = {...blue.keys, ...oficial.keys}.toList()..sort();
  return [for (final day in days) DayRates(day, blue: blue[day], oficial: oficial[day])];
}

/// One entry of `GET /data/json/currency.json`: units of the currency per US dollar.
class Currency {
  const Currency({required this.code, required this.name, required this.perUsdHundredths});

  final String code;

  /// Spanish name, as stored.
  final String name;
  final int perUsdHundredths;
}

List<Currency> parseCurrencies(Object? json) {
  if (json is! List) return const [];
  final out = <Currency>[];
  for (final row in json) {
    if (row is! Map) continue;
    final code = row['code'];
    final name = row['name'];
    final value = hundredthsOf(row['value']);
    if (code is! String || name is! String || value == null) continue;
    out.add(Currency(code: code, name: name, perUsdHundredths: value));
  }
  return out;
}

/// `GET /v2/alerts`: the last significant move of the blue sell price.
class AlertInfo {
  const AlertInfo({required this.id, required this.at, required this.current, this.previous});

  final int id;
  final DateTime at;
  final Quote current;
  final Quote? previous;

  static AlertInfo? fromJson(Object? json) {
    if (json is! Map) return null;
    final id = json['alert_id'];
    final stamp = json['alert_at'];
    final current = Quote.fromJson(json['current']);
    final at = stamp is String ? DateTime.tryParse(stamp)?.toUtc() : null;
    if (id is! int || at == null || current == null) return null;
    return AlertInfo(id: id, at: at, current: current, previous: Quote.fromJson(json['previous']));
  }
}

/// One entry of the site's `/data/extras.json`: a reference rate published by a third party.
class ExtraRate {
  const ExtraRate({required this.code, required this.sell, this.buy});

  /// `mep`, `ccl`, `cripto`, `tarjeta`, `mayorista`, …
  final String code;
  final int sell;
  final int? buy;
}

/// `{"rates":[{"code":"mep","buy":165250,"sell":165250}, …]}`, prices already in hundredths.
List<ExtraRate> parseExtras(Object? json) {
  final rows = json is Map ? json['rates'] : null;
  if (rows is! List) return const [];
  final out = <ExtraRate>[];
  for (final row in rows) {
    if (row is! Map) continue;
    final code = row['code'];
    final sell = row['sell'];
    final buy = row['buy'];
    if (code is! String || sell is! int || sell <= 0) continue;
    out.add(ExtraRate(code: code, sell: sell, buy: buy is int && buy > 0 ? buy : null));
  }
  return out;
}
