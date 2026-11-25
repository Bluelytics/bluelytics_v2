/// The last body of each feed, kept on disk so the app opens with numbers before the network answers
/// and still shows them offline.
library;

import 'dart:io';

/// A cached body and when it was fetched.
class CacheEntry {
  const CacheEntry(this.at, this.body);

  final DateTime at;
  final String body;
}

abstract interface class CacheStore {
  Future<CacheEntry?> read(String key);

  Future<void> write(String key, CacheEntry entry);
}

class MemoryCacheStore implements CacheStore {
  final Map<String, CacheEntry> entries = {};

  @override
  Future<CacheEntry?> read(String key) async => entries[key];

  @override
  Future<void> write(String key, CacheEntry entry) async => entries[key] = entry;
}

/// One file per key: the fetch time on the first line, then the body. Every error is swallowed: a
/// cache that cannot be read or written only costs a network request.
class FileCacheStore implements CacheStore {
  FileCacheStore(this._directory);

  /// Resolved on first use (path_provider needs the engine).
  final Future<Directory> Function() _directory;

  Future<File> _file(String key) async => File('${(await _directory()).path}/bluelytics-$key.txt');

  @override
  Future<CacheEntry?> read(String key) async {
    try {
      final file = await _file(key);
      if (!await file.exists()) return null;
      final text = await file.readAsString();
      final split = text.indexOf('\n');
      if (split < 0) return null;
      final at = DateTime.tryParse(text.substring(0, split));
      return at == null ? null : CacheEntry(at.toUtc(), text.substring(split + 1));
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(String key, CacheEntry entry) async {
    try {
      final file = await _file(key);
      await file.parent.create(recursive: true);
      // Written whole to a sibling and renamed, so a kill mid-write never leaves half a file.
      final temp = File('${file.path}.tmp');
      await temp.writeAsString('${entry.at.toUtc().toIso8601String()}\n${entry.body}', flush: true);
      await temp.rename(file.path);
    } on Object {
      // Nothing to do: the next refresh tries again.
    }
  }
}
