import Foundation
import XCTest
@testable import BluelyticsCore

@MainActor
final class StoreTests: XCTestCase {
    func testARefreshLoadsEveryFeedAndStampsTheFetchTime() async {
        let store = fixtureStore()
        XCTAssertFalse(store.hasData)
        await store.refresh()
        XCTAssertFalse(store.offline)
        XCTAssertFalse(store.loading)
        XCTAssertEqual(store.fetchedAt, fixtureNow)
        XCTAssertEqual(store.latest!.blue!.sell, 171_000)
        XCTAssertEqual(store.recent.count, 45)
        XCTAssertTrue(store.hasFullSeries)
        XCTAssertGreaterThan(store.series.count, 500)
        XCTAssertEqual(store.series.last!.day, "2026-11-25")
        XCTAssertFalse(store.currencies.isEmpty)
        XCTAssertEqual(store.alert!.id, 1891)
        XCTAssertEqual(store.extras.count, 5)
        let snapshot = store.snapshot!
        XCTAssertEqual(snapshot.previousDay, "2026-11-24")
        XCTAssertEqual(snapshot.blueMove!.direction, .up)
    }

    func testListenersHearTheStartAndTheEndOfARefresh() async {
        let store = fixtureStore()
        var loadingStates: [Bool] = []
        store.onChange = { loadingStates.append(store.loading) }
        await store.refresh()
        XCTAssertEqual(loadingStates.first, true)
        XCTAssertEqual(loadingStates.last, false)
    }

    func testOnlyTheLiveQuotesDecideOfflineOptionalFeedsMayFailQuietly() async {
        let store = fixtureStore(fail: [.extras, .alert, .full])
        await store.refresh()
        XCTAssertFalse(store.offline)
        XCTAssertTrue(store.hasData)
        XCTAssertTrue(store.extras.isEmpty)
        XCTAssertNil(store.alert)
        XCTAssertFalse(store.hasFullSeries)
        XCTAssertEqual(store.series.count, 45, "the recent days alone")
    }

    /// Production today: a first launch (nothing cached) and `/data/extras.json` answering 404.
    /// Everything Today shows is there; only the extras section has nothing, and the next launch
    /// restores the same from the cache.
    func testAFirstLaunchWithTheExtrasFeedMissingHasEverythingTodayNeeds() async {
        let cache = MemoryCacheStore()
        let store = fixtureStore(fail: [.extras], cache: cache)
        await store.restore()
        XCTAssertNil(store.snapshot, "nothing cached yet")
        await store.refresh()
        XCTAssertFalse(store.offline)
        XCTAssertFalse(store.loading)
        let snapshot = store.snapshot
        XCTAssertNotNil(snapshot?.latest.blue)
        XCTAssertNotNil(snapshot?.latest.oficial)
        XCTAssertNotNil(snapshot?.blueMove)
        XCTAssertNotNil(snapshot?.gap)
        XCTAssertGreaterThan(rangeOf(store.recent, .m1).count, 1, "the hero chart has days to draw")
        XCTAssertTrue(store.extras.isEmpty)

        let next = fixtureStore(fail: Set(Feed.allCases), cache: cache)
        await next.restore()
        XCTAssertEqual(next.snapshot, snapshot)
        XCTAssertTrue(next.extras.isEmpty)
    }

    func testWithoutNetworkAndWithoutCacheThereIsNothingToShow() async {
        let store = fixtureStore(fail: Set(Feed.allCases))
        await store.refresh()
        XCTAssertTrue(store.offline)
        XCTAssertFalse(store.hasData)
        XCTAssertNil(store.snapshot)
        XCTAssertNil(store.fetchedAt)
    }

    func testABodyThatIsNotTheExpectedJSONCountsAsAFailureNotACrash() async {
        let store = fixtureStore(overrides: [.latest: "<html>error</html>", .currencies: "[]"])
        await store.refresh()
        XCTAssertTrue(store.offline)
        XCTAssertTrue(store.currencies.isEmpty)
        XCTAssertFalse(store.recent.isEmpty)
    }

    func testWhatWasFetchedComesBackFromTheCacheAndStaysOnScreenWhenTheNetworkFails() async {
        let cache = MemoryCacheStore()
        let first = fixtureStore(cache: cache)
        await first.refresh()
        XCTAssertEqual(Set(cache.entries.keys), Set(Feed.allCases.map(\.rawValue)))

        let later = fixtureNow.addingTimeInterval(2 * 3600)
        let second = fixtureStore(fail: Set(Feed.allCases), cache: cache, clock: { later })
        await second.restore()
        XCTAssertTrue(second.hasData)
        XCTAssertEqual(second.fetchedAt, fixtureNow)
        XCTAssertEqual(second.series.count, first.series.count)
        await second.refresh()
        XCTAssertTrue(second.offline)
        XCTAssertEqual(second.latest!.blue!.sell, 171_000, "the cached quote is kept")
        XCTAssertEqual(second.fetchedAt, fixtureNow, "and still dated when it was fetched")
    }

    func testADamagedCacheEntryIsIgnored() async {
        let cache = MemoryCacheStore()
        cache.entries[Feed.latest.rawValue] = CacheEntry(fixtureNow, #"{"blue":"#)
        cache.entries[Feed.recent.rawValue] = CacheEntry(fixtureNow, fixture("recent"))
        let store = fixtureStore(cache: cache)
        await store.restore()
        XCTAssertFalse(store.hasData)
        XCTAssertFalse(store.recent.isEmpty)
    }

    // MARK: how often the network is used

    final class Clock {
        var now = fixtureNow
    }

    func counting() -> (store: AppStore, client: FixtureClient, clock: Clock) {
        let client = FixtureClient()
        let clock = Clock()
        let store = AppStore(api: BluelyticsAPI(client: client), cache: MemoryCacheStore(), clock: { clock.now })
        return (store, client, clock)
    }

    func count(_ client: FixtureClient, _ feed: Feed) -> Int { client.log.filter { $0.absoluteString == feed.url }.count }

    func testASecondRefreshInsideTheAPICacheWindowDoesNothingUnlessForced() async {
        let (store, client, clock) = counting()
        await store.refresh()
        clock.now = clock.now.addingTimeInterval(10)
        await store.refresh()
        XCTAssertEqual(count(client, .latest), 1)
        await store.refresh(force: true)
        XCTAssertEqual(count(client, .latest), 2)
        clock.now = clock.now.addingTimeInterval(31)
        await store.refresh()
        XCTAssertEqual(count(client, .latest), 3)
    }

    func testTheHistoryAndTheCurrenciesAreFetchedAFewTimesADayNotOnEveryRefresh() async {
        let (store, client, clock) = counting()
        await store.refresh()
        clock.now = clock.now.addingTimeInterval(5 * 60)
        await store.refresh()
        XCTAssertEqual(count(client, .recent), 2)
        XCTAssertEqual(count(client, .full), 1)
        XCTAssertEqual(count(client, .currencies), 1)
        clock.now = clock.now.addingTimeInterval(6 * 3600)
        await store.refresh()
        XCTAssertEqual(count(client, .full), 2)
        XCTAssertEqual(count(client, .currencies), 2)
    }

    func testSimultaneousRefreshesShareOneRun() async {
        let (store, client, _) = counting()
        async let a: Void = store.refresh()
        async let b: Void = store.refresh(force: true)
        async let c: Void = store.refresh()
        _ = await (a, b, c)
        XCTAssertEqual(count(client, .latest), 1)
    }

    // MARK: file cache

    var directory: URL!

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("bluelytics-cache-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testFileCacheRoundTripWithTheBodyKeptByteForByte() async throws {
        let dir = directory!
        let cache = FileCacheStore { dir }
        let missing = await cache.read("latest")
        XCTAssertNil(missing)
        let body = "{\"a\":\"línea 1\\n\"}\nsecond line\n"
        await cache.write("latest", CacheEntry(fixtureNow, body))
        let entry = await cache.read("latest")
        XCTAssertEqual(entry?.at, fixtureNow)
        XCTAssertEqual(entry?.body, body)
        // And again over the existing file.
        await cache.write("latest", CacheEntry(fixtureNow.addingTimeInterval(60), "{}"))
        let second = await cache.read("latest")
        XCTAssertEqual(second?.body, "{}")
        let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        XCTAssertEqual(names, ["bluelytics-latest.txt"], "no temporary file left behind")
    }

    func testFileCacheAFileThatIsNotACacheEntryReadsAsNothing() async throws {
        let dir = directory!
        let cache = FileCacheStore { dir }
        try Data("not a date\n{}".utf8).write(to: dir.appendingPathComponent("bluelytics-latest.txt"))
        let latest = await cache.read("latest")
        XCTAssertNil(latest)
        try Data("no newline".utf8).write(to: dir.appendingPathComponent("bluelytics-recent.txt"))
        let recent = await cache.read("recent")
        XCTAssertNil(recent)
    }

    func testFileCacheADirectoryThatCannotBeUsedNeverThrows() async {
        struct NoStorage: Error {}
        let cache = FileCacheStore { throw NoStorage() }
        let entry = await cache.read("latest")
        XCTAssertNil(entry)
        await cache.write("latest", CacheEntry(fixtureNow, "{}"))
    }
}
