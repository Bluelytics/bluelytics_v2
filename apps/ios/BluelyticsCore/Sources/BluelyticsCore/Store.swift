// The app's data: what the API last said, restored from disk first and refreshed in the background.
import Foundation

private struct FormatError: Error {
    let message: String
}

@MainActor
public final class AppStore {
    public let api: BluelyticsAPI
    public let cache: CacheStore
    private let clock: () -> Date

    /// Called after every change; the app turns it into a SwiftUI update.
    public var onChange: (() -> Void)?

    /// The API caches live answers for 30 s: asking more often returns the same bytes.
    public static let minInterval: TimeInterval = 30

    /// Feeds that change at most once a day.
    public static let slowInterval: TimeInterval = 6 * 3600

    public private(set) var latest: Latest?
    public private(set) var recent: [DayRates] = []
    private var full: [DayRates] = []
    /// Every known day, oldest first.
    public private(set) var series: [DayRates] = []
    public private(set) var currencies: [Currency] = []
    public private(set) var alert: AlertInfo?
    public private(set) var extras: [ExtraRate] = []

    /// When the live quotes on screen were fetched.
    public private(set) var fetchedAt: Date?

    /// A refresh is running.
    public private(set) var loading = false

    /// The last refresh could not reach the API: what is on screen comes from the cache.
    public private(set) var offline = false

    private var fetched: [Feed: Date] = [:]
    private var inFlight: Task<Void, Never>?

    public init(api: BluelyticsAPI, cache: CacheStore, clock: @escaping () -> Date = Date.init) {
        self.api = api
        self.cache = cache
        self.clock = clock
    }

    public var hasData: Bool { latest?.blue != nil }

    /// Whether the history since 2011 is loaded (it arrives after the live quotes).
    public var hasFullSeries: Bool { !full.isEmpty }

    public var snapshot: Snapshot? {
        guard let latest else { return nil }
        return Snapshot.of(latest, series)
    }

    /// Loads the cached bodies. Safe to call once at start, before `refresh`.
    public func restore() async {
        for feed in Feed.allCases {
            guard let entry = await cache.read(feed.rawValue) else { continue }
            do {
                try await apply(feed, entry.body)
                fetched[feed] = entry.at
                if feed == .latest { fetchedAt = entry.at }
            } catch {
                // A cache written by another version, or cut short: ignore it.
            }
        }
        notify()
    }

    /// Fetches the live feeds, and the slow ones when they are due. Concurrent calls share one run.
    /// Without `force`, a refresh within `minInterval` of the last successful one does nothing.
    public func refresh(force: Bool = false) async {
        if let running = inFlight {
            await running.value
            return
        }
        if !force, let last = fetched[.latest], !offline, clock().timeIntervalSince(last) < AppStore.minInterval { return }
        let task = Task { await self.run() }
        inFlight = task
        await task.value
        inFlight = nil
    }

    private func run() async {
        loading = true
        notify()
        let now = clock()
        func due(_ feed: Feed) -> Bool {
            guard let at = fetched[feed] else { return true }
            return now.timeIntervalSince(at) >= AppStore.slowInterval
        }
        var feeds: [Feed] = [.latest, .recent, .alert, .extras]
        if currencies.isEmpty || due(.currencies) { feeds.append(.currencies) }
        if full.isEmpty || due(.full) { feeds.append(.full) }

        var results: [Feed: Bool] = [:]
        await withTaskGroup(of: (Feed, Bool).self) { group in
            for feed in feeds {
                group.addTask { (feed, await self.load(feed, now)) }
            }
            for await (feed, ok) in group { results[feed] = ok }
        }
        // Only the live quotes decide whether the app is offline; the rest is optional or slow.
        let live = results[.latest] ?? false
        offline = !live
        if live { fetchedAt = now }
        loading = false
        notify()
    }

    private func load(_ feed: Feed, _ now: Date) async -> Bool {
        do {
            let body = try await api.fetch(feed)
            try await apply(feed, body)
            fetched[feed] = now
            await cache.write(feed.rawValue, CacheEntry(now, body))
            return true
        } catch {
            return false
        }
    }

    private func apply(_ feed: Feed, _ body: String) async throws {
        switch feed {
        case .latest:
            let parsed = Latest.from(try JSON.parse(body))
            guard parsed.blue != nil else { throw FormatError(message: "latest: no blue quote") }
            latest = parsed
        case .recent:
            recent = parseEvolution(try JSON.parse(body))
            series = mergeSeries(full, recent)
        case .full:
            // About 1 MB of JSON: decoded off the main thread.
            let parsed = try await Task.detached(priority: .userInitiated) { parseEvolution(try JSON.parse(body)) }.value
            guard !parsed.isEmpty else { throw FormatError(message: "evolution: empty") }
            full = parsed
            series = mergeSeries(full, recent)
        case .currencies:
            let parsed = parseCurrencies(try JSON.parse(body))
            guard !parsed.isEmpty else { throw FormatError(message: "currencies: empty") }
            currencies = parsed
        case .alert:
            alert = AlertInfo.from(try JSON.parse(body))
        case .extras:
            extras = parseExtras(try JSON.parse(body))
        }
    }

    private func notify() {
        onChange?()
    }
}
