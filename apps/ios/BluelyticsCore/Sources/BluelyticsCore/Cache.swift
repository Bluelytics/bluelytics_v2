// The last body of each feed, kept on disk so the app opens with numbers before the network answers
// and still shows them offline.
import Foundation

/// A cached body and when it was fetched.
public struct CacheEntry: Equatable, Sendable {
    public let at: Date
    public let body: String

    public init(_ at: Date, _ body: String) {
        self.at = at
        self.body = body
    }
}

public protocol CacheStore: AnyObject, Sendable {
    func read(_ key: String) async -> CacheEntry?
    func write(_ key: String, _ entry: CacheEntry) async
}

public final class MemoryCacheStore: CacheStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: CacheEntry] = [:]

    public init() {}

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    public var entries: [String: CacheEntry] {
        get { locked { storage } }
        set { locked { storage = newValue } }
    }

    public func read(_ key: String) async -> CacheEntry? { entries[key] }

    public func write(_ key: String, _ entry: CacheEntry) async { locked { storage[key] = entry } }
}

/// One file per key: the fetch time on the first line, then the body. Every error is swallowed: a
/// cache that cannot be read or written only costs a network request.
public final class FileCacheStore: CacheStore, @unchecked Sendable {
    /// Resolved on each use, so a directory that cannot be made only disables the cache.
    private let directory: () throws -> URL

    public init(directory: @escaping () throws -> URL) { self.directory = directory }

    /// `Library/Caches` of the app: the system may empty it when space runs low, which is fine.
    public static func caches() -> FileCacheStore {
        FileCacheStore { try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true) }
    }

    private func file(_ key: String) throws -> URL {
        try directory().appendingPathComponent("bluelytics-\(key).txt")
    }

    public func read(_ key: String) async -> CacheEntry? {
        guard let url = try? file(key), let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8),
              let split = text.firstIndex(of: "\n"), let at = parseInstant(String(text[..<split]))
        else { return nil }
        return CacheEntry(at, String(text[text.index(after: split)...]))
    }

    public func write(_ key: String, _ entry: CacheEntry) async {
        do {
            let url = try file(key)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Written whole to a sibling and moved over, so a kill mid-write never leaves half a file.
            let temp = url.appendingPathExtension("tmp")
            try Data((formatInstant(entry.at) + "\n" + entry.body).utf8).write(to: temp)
            if FileManager.default.fileExists(atPath: url.path) {
                _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
            } else {
                try FileManager.default.moveItem(at: temp, to: url)
            }
        } catch {
            // Nothing to do: the next refresh tries again.
        }
    }
}
