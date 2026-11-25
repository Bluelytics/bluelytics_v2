import 'dart:io';

import 'package:bluelytics/data/api.dart';
import 'package:bluelytics/data/cache.dart';
import 'package:bluelytics/data/store.dart';
import 'package:bluelytics/domain/series.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/harness.dart';

void main() {
  test('a refresh loads every feed and stamps the fetch time', () async {
    final store = fixtureStore();
    expect(store.hasData, isFalse);
    await store.refresh();
    expect(store.offline, isFalse);
    expect(store.loading, isFalse);
    expect(store.fetchedAt, fixtureNow);
    expect(store.latest!.blue!.sell, 171000);
    expect(store.recent.length, 45);
    expect(store.hasFullSeries, isTrue);
    expect(store.series.length, greaterThan(500));
    expect(store.series.last.day, '2026-11-25');
    expect(store.currencies, isNotEmpty);
    expect(store.alert!.id, 1891);
    expect(store.extras.length, 5);
    final snapshot = store.snapshot!;
    expect(snapshot.previousDay, '2026-11-24');
    expect(snapshot.blueMove!.direction, Direction.up);
  });

  test('listeners hear the start and the end of a refresh', () async {
    final store = fixtureStore();
    final loadingStates = <bool>[];
    store.addListener(() => loadingStates.add(store.loading));
    await store.refresh();
    expect(loadingStates.first, isTrue);
    expect(loadingStates.last, isFalse);
  });

  test('only the live quotes decide "offline": optional feeds may fail quietly', () async {
    final store = fixtureStore(fail: {Feed.extras, Feed.alert, Feed.full});
    await store.refresh();
    expect(store.offline, isFalse);
    expect(store.hasData, isTrue);
    expect(store.extras, isEmpty);
    expect(store.alert, isNull);
    expect(store.hasFullSeries, isFalse);
    expect(store.series.length, 45, reason: 'the recent days alone');
  });

  test('without network and without cache there is nothing to show', () async {
    final store = fixtureStore(fail: Feed.values.toSet());
    await store.refresh();
    expect(store.offline, isTrue);
    expect(store.hasData, isFalse);
    expect(store.snapshot, isNull);
    expect(store.fetchedAt, isNull);
  });

  test('a body that is not the expected JSON counts as a failure, not a crash', () async {
    final store = fixtureStore(overrides: {Feed.latest: '<html>error</html>', Feed.currencies: '[]'});
    await store.refresh();
    expect(store.offline, isTrue);
    expect(store.currencies, isEmpty);
    expect(store.recent, isNotEmpty);
  });

  test('what was fetched comes back from the cache, and stays on screen when the network fails', () async {
    final cache = MemoryCacheStore();
    final first = fixtureStore(cache: cache);
    await first.refresh();
    await Future<void>.delayed(Duration.zero);
    expect(cache.entries.keys, containsAll(Feed.values.map((feed) => feed.name)));

    final later = fixtureNow.add(const Duration(hours: 2));
    final second = fixtureStore(cache: cache, fail: Feed.values.toSet(), clock: () => later);
    await second.restore();
    expect(second.hasData, isTrue);
    expect(second.fetchedAt, fixtureNow);
    expect(second.series.length, first.series.length);
    await second.refresh();
    expect(second.offline, isTrue);
    expect(second.latest!.blue!.sell, 171000, reason: 'the cached quote is kept');
    expect(second.fetchedAt, fixtureNow, reason: 'and still dated when it was fetched');
  });

  test('a damaged cache entry is ignored', () async {
    final cache = MemoryCacheStore();
    cache.entries[Feed.latest.name] = CacheEntry(fixtureNow, '{"blue":');
    cache.entries[Feed.recent.name] = CacheEntry(fixtureNow, fixture('recent'));
    final store = fixtureStore(cache: cache);
    await store.restore();
    expect(store.hasData, isFalse);
    expect(store.recent, isNotEmpty);
  });

  group('how often the network is used', () {
    late List<Uri> log;
    late DateTime now;
    late AppStore store;

    setUp(() {
      log = [];
      now = fixtureNow;
      store = AppStore(
        api: BluelyticsApi(client: fixtureClient(log: log)),
        cache: MemoryCacheStore(),
        clock: () => now,
      );
    });

    int count(Feed feed) => log.where((uri) => uri.toString() == feed.url).length;

    test('a second refresh inside the API cache window does nothing, unless forced', () async {
      await store.refresh();
      now = now.add(const Duration(seconds: 10));
      await store.refresh();
      expect(count(Feed.latest), 1);
      await store.refresh(force: true);
      expect(count(Feed.latest), 2);
      now = now.add(const Duration(seconds: 31));
      await store.refresh();
      expect(count(Feed.latest), 3);
    });

    test('the history and the currencies are fetched a few times a day, not on every refresh', () async {
      await store.refresh();
      now = now.add(const Duration(minutes: 5));
      await store.refresh();
      expect(count(Feed.recent), 2);
      expect(count(Feed.full), 1);
      expect(count(Feed.currencies), 1);
      now = now.add(const Duration(hours: 6));
      await store.refresh();
      expect(count(Feed.full), 2);
      expect(count(Feed.currencies), 2);
    });

    test('simultaneous refreshes share one run', () async {
      await Future.wait([store.refresh(), store.refresh(force: true), store.refresh()]);
      expect(count(Feed.latest), 1);
    });
  });

  group('file cache', () {
    late Directory directory;

    setUp(() => directory = Directory.systemTemp.createTempSync('bluelytics-cache-test'));
    tearDown(() => directory.deleteSync(recursive: true));

    test('round trip, with the body kept byte for byte', () async {
      final cache = FileCacheStore(() async => directory);
      expect(await cache.read('latest'), isNull);
      const body = '{"a":"línea 1\\n"}\nsecond line\n';
      await cache.write('latest', CacheEntry(fixtureNow, body));
      final entry = (await cache.read('latest'))!;
      expect(entry.at, fixtureNow);
      expect(entry.body, body);
      expect(directory.listSync().map((f) => f.path.split('/').last), ['bluelytics-latest.txt'], reason: 'no temporary file left behind');
    });

    test('a file that is not a cache entry reads as nothing', () async {
      final cache = FileCacheStore(() async => directory);
      File('${directory.path}/bluelytics-latest.txt').writeAsStringSync('not a date\n{}');
      expect(await cache.read('latest'), isNull);
      File('${directory.path}/bluelytics-recent.txt').writeAsStringSync('no newline');
      expect(await cache.read('recent'), isNull);
    });

    test('a directory that cannot be used never throws', () async {
      final cache = FileCacheStore(() async => throw const FileSystemException('no storage'));
      expect(await cache.read('latest'), isNull);
      await cache.write('latest', CacheEntry(fixtureNow, '{}'));
    });
  });
}
