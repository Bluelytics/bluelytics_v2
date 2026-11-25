/// The app's data: what the API last said, restored from disk first and refreshed in the background.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../domain/models.dart';
import '../domain/series.dart';
import 'api.dart';
import 'cache.dart';

List<DayRates> _decodeEvolution(String body) => parseEvolution(jsonDecode(body));

class AppStore extends ChangeNotifier {
  AppStore({required this.api, required this.cache, DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final BluelyticsApi api;
  final CacheStore cache;
  final DateTime Function() _clock;

  /// The API caches live answers for 30 s: asking more often returns the same bytes.
  static const Duration minInterval = Duration(seconds: 30);

  /// Feeds that change at most once a day.
  static const Duration slowInterval = Duration(hours: 6);

  Latest? latest;
  List<DayRates> _recent = const [];
  List<DayRates> _full = const [];
  List<DayRates> _series = const [];
  List<Currency> currencies = const [];
  AlertInfo? alert;
  List<ExtraRate> extras = const [];

  /// When the live quotes on screen were fetched.
  DateTime? fetchedAt;

  /// A refresh is running.
  bool loading = false;

  /// The last refresh could not reach the API: what is on screen comes from the cache.
  bool offline = false;

  final Map<Feed, DateTime> _fetched = {};
  Future<void>? _inFlight;
  bool _disposed = false;

  bool get hasData => latest?.blue != null;

  /// Every known day, oldest first.
  List<DayRates> get series => _series;

  /// The last ~45 days, oldest first.
  List<DayRates> get recent => _recent;

  /// Whether the history since 2011 is loaded (it arrives after the live quotes).
  bool get hasFullSeries => _full.isNotEmpty;

  Snapshot? get snapshot {
    final current = latest;
    return current == null ? null : Snapshot.of(current, _series);
  }

  /// Loads the cached bodies. Safe to call once at start, before [refresh].
  Future<void> restore() async {
    final entries = await Future.wait([for (final feed in Feed.values) cache.read(feed.name)]);
    for (var i = 0; i < Feed.values.length; i++) {
      final entry = entries[i];
      if (entry == null) continue;
      try {
        await _apply(Feed.values[i], entry.body);
        _fetched[Feed.values[i]] = entry.at;
        if (Feed.values[i] == Feed.latest) fetchedAt = entry.at;
      } on Object {
        // A cache written by another version, or cut short: ignore it.
      }
    }
    _notify();
  }

  /// Fetches the live feeds, and the slow ones when they are due. Concurrent calls share one run.
  /// Without `force`, a refresh within [minInterval] of the last successful one does nothing.
  Future<void> refresh({bool force = false}) {
    final running = _inFlight;
    if (running != null) return running;
    final last = _fetched[Feed.latest];
    if (!force && last != null && !offline && _clock().difference(last) < minInterval) return Future.value();
    return _inFlight = _refresh().whenComplete(() => _inFlight = null);
  }

  Future<void> _refresh() async {
    loading = true;
    _notify();
    final now = _clock();
    bool due(Feed feed) {
      final at = _fetched[feed];
      return at == null || now.difference(at) >= slowInterval;
    }

    final feeds = [
      Feed.latest,
      Feed.recent,
      Feed.alert,
      Feed.extras,
      if (currencies.isEmpty || due(Feed.currencies)) Feed.currencies,
      if (_full.isEmpty || due(Feed.full)) Feed.full,
    ];
    final results = await Future.wait([for (final feed in feeds) _load(feed, now)]);
    // Only the live quotes decide whether the app is offline; the rest is optional or slow.
    offline = !results.first;
    if (results.first) fetchedAt = now;
    loading = false;
    _notify();
  }

  Future<bool> _load(Feed feed, DateTime now) async {
    try {
      final body = await api.fetch(feed);
      await _apply(feed, body);
      _fetched[feed] = now;
      unawaited(cache.write(feed.name, CacheEntry(now, body)));
      return true;
    } on Object {
      return false;
    }
  }

  Future<void> _apply(Feed feed, String body) async {
    switch (feed) {
      case Feed.latest:
        final parsed = Latest.fromJson(jsonDecode(body));
        if (parsed.blue == null) throw const FormatException('latest: no blue quote');
        latest = parsed;
      case Feed.recent:
        _recent = parseEvolution(jsonDecode(body));
        _series = mergeSeries(_full, _recent);
      case Feed.full:
        // About 1 MB of JSON: decoded off the UI isolate.
        final parsed = await compute(_decodeEvolution, body);
        if (parsed.isEmpty) throw const FormatException('evolution: empty');
        _full = parsed;
        _series = mergeSeries(_full, _recent);
      case Feed.currencies:
        final parsed = parseCurrencies(jsonDecode(body));
        if (parsed.isEmpty) throw const FormatException('currencies: empty');
        currencies = parsed;
      case Feed.alert:
        alert = AlertInfo.fromJson(jsonDecode(body));
      case Feed.extras:
        extras = parseExtras(jsonDecode(body));
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
