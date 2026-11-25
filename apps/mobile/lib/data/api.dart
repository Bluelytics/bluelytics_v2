/// HTTP access to the public API. Bodies come back as text: the store caches them as received and
/// parses them with lib/domain/models.dart.
library;

import 'dart:async';

import 'package:http/http.dart' as http;

import '../config.dart';

/// What the app reads, and from where.
enum Feed {
  /// Live quotes: blue, official and both euros.
  latest('$apiBase/v2/latest'),

  /// The last ~45 days with data (the endpoint counts rows: two per day).
  recent('$apiBase/v2/evolution.json?days=90'),

  /// Every day since 2011 (about 30 kB compressed).
  full('$apiBase/v2/evolution.json'),

  /// Units of every currency per US dollar.
  currencies('$apiBase/data/json/currency.json'),

  /// The last alert.
  alert('$apiBase/v2/alerts'),

  /// Reference rates published by third parties (MEP, CCL, …). Optional: served by the website.
  extras('$siteBase/data/extras.json')
  ;

  const Feed(this.url);

  final String url;
}

class ApiException implements Exception {
  const ApiException(this.message);

  final String message;

  @override
  String toString() => 'ApiException: $message';
}

class BluelyticsApi {
  BluelyticsApi({http.Client? client, this.timeout = const Duration(seconds: 12)}) : _client = client ?? http.Client();

  final http.Client _client;
  final Duration timeout;

  /// The response body of a feed; throws [ApiException] on a network error, a timeout or a non-200 status.
  Future<String> fetch(Feed feed) async {
    final http.Response response;
    try {
      response = await _client
          .get(Uri.parse(feed.url), headers: const {'accept': 'application/json', 'user-agent': 'Bluelytics-App/$appVersion'})
          .timeout(timeout);
    } on TimeoutException {
      throw ApiException('${feed.name}: timeout');
    } on Exception catch (error) {
      throw ApiException('${feed.name}: $error');
    }
    if (response.statusCode != 200) throw ApiException('${feed.name}: HTTP ${response.statusCode}');
    return response.body;
  }

  void close() => _client.close();
}
