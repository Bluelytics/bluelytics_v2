import Foundation
import XCTest
@testable import BluelyticsCore

/// The moment the fixtures were captured (their `last_update`), so "today" is stable.
let fixtureNow = utc(2026, 11, 25, 22, 21)

func fixture(_ name: String) -> String {
    let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!
    return try! String(contentsOf: url, encoding: .utf8)
}

func json(_ text: String) -> JSON { try! JSON.parse(text) }

func feed(for url: URL) -> Feed { Feed.allCases.first { $0.url == url.absoluteString }! }

/// Answers every feed from Fixtures. `fail` makes the listed feeds return 503; `overrides` replaces
/// a body; `log` records every URL asked for.
final class FixtureClient: HTTPClient, @unchecked Sendable {
    let fail: Set<Feed>
    let overrides: [Feed: String]
    private let lock = NSLock()
    private var requests: [URL] = []

    init(fail: Set<Feed> = [], overrides: [Feed: String] = [:]) {
        self.fail = fail
        self.overrides = overrides
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    var log: [URL] { locked { requests } }

    func get(_ url: URL, headers: [String: String], timeout: TimeInterval) async throws -> (status: Int, body: Data) {
        locked { requests.append(url) }
        let feed = feed(for: url)
        if fail.contains(feed) { return (503, Data("unavailable".utf8)) }
        return (200, Data((overrides[feed] ?? fixture(feed.rawValue)).utf8))
    }
}

@MainActor
func fixtureStore(
    fail: Set<Feed> = [],
    overrides: [Feed: String] = [:],
    cache: CacheStore = MemoryCacheStore(),
    clock: @escaping () -> Date = { fixtureNow }
) -> AppStore {
    AppStore(api: BluelyticsAPI(client: FixtureClient(fail: fail, overrides: overrides)), cache: cache, clock: clock)
}

/// A push backend that records what the app asked of it.
@MainActor
final class FakePush: PushBackend {
    var grant: Bool
    var fail: Bool
    var calls: [String] = []
    var onMessage: ((AlertMessage) -> Void)?

    init(grant: Bool = true, fail: Bool = false) {
        self.grant = grant
        self.fail = fail
    }

    struct NetworkError: Error {}

    var supported: Bool { true }

    func enable() async throws -> Bool {
        calls.append("enable")
        if fail { throw NetworkError() }
        return grant
    }

    func disable() async throws {
        calls.append("disable")
        if fail { throw NetworkError() }
    }

    func resume() async throws { calls.append("resume") }

}

func utc(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, _ second: Int = 0, _ millis: Int = 0) -> Date {
    let days = daysFromCivil(year, month, day)
    return Date(timeIntervalSince1970: Double(days * 86400 + hour * 3600 + minute * 60 + second) + Double(millis) / 1000)
}

func XCTAssertClose(_ value: Double?, _ expected: Double, _ accuracy: Double, file: StaticString = #filePath, line: UInt = #line) {
    guard let value else { return XCTFail("nil, expected \(expected)", file: file, line: line) }
    XCTAssertEqual(value, expected, accuracy: accuracy, file: file, line: line)
}
