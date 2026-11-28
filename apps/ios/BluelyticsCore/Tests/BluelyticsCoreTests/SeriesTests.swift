import XCTest
@testable import BluelyticsCore

func day(_ name: String, _ blueSell: Int?, _ oficialSell: Int? = nil) -> DayRates {
    DayRates(
        name,
        blue: blueSell.map { Quote($0 - 2000, $0) },
        oficial: oficialSell.map { Quote($0 - 5000, $0) }
    )
}

final class SeriesTests: XCTestCase {
    func testAMoveHasASignARatioAndADirection() {
        let up = Move.between(171_000, 170_000)!
        XCTAssertEqual(up.delta, 1000)
        XCTAssertEqual(up.ratio, 0.00588, accuracy: 0.00001)
        XCTAssertEqual(up.direction, .up)
        XCTAssertEqual(Move.between(170_000, 171_000)!.direction, .down)
        XCTAssertEqual(Move.between(170_000, 170_000)!.direction, .flat)
        XCTAssertNil(Move.between(170_000, nil))
        XCTAssertNil(Move.between(nil, 170_000))
        XCTAssertNil(Move.between(170_000, 0))
    }

    func testTheGapIsBlueOverOfficialSellMinusOne() {
        XCTAssertClose(gapRatio(171_000, 163_000), 0.0491, 0.0001)
        XCTAssertNil(gapRatio(nil, 163_000))
        XCTAssertNil(gapRatio(171_000, 0))
    }

    // MARK: snapshot

    let days = [day("2026-11-20", 168_000, 160_000), day("2026-11-23", 169_000, 161_000), day("2026-11-24", 170_000, 161_500), day("2026-11-25", 171_000, 163_000)]

    func at(_ stamp: String) -> Latest {
        Latest(blue: Quote(169_000, 171_000), oficial: Quote(158_000, 163_000), updatedAt: parseInstant(stamp)!)
    }

    func testSnapshotMovesAreMeasuredAgainstTheLastDayBeforeTodayNotTodaysOwnRow() {
        let snapshot = Snapshot.of(at("2026-11-25T19:20:00-03:00"), days)
        XCTAssertEqual(snapshot.previousDay, "2026-11-24")
        XCTAssertEqual(snapshot.blueMove!.delta, 1000)
        XCTAssertEqual(snapshot.oficialMove!.delta, 1500)
        XCTAssertClose(snapshot.gap, 0.0491, 0.0001)
    }

    func testSnapshotTodayIsTheArgentineDay() {
        // 01:00 UTC still belongs to the evening before.
        XCTAssertEqual(Snapshot.of(at("2026-11-26T01:00:00Z"), days).previousDay, "2026-11-24")
    }

    func testSnapshotBeforeTheFirstRunOfANewDayTheSeriesMayNotHaveTodayYet() {
        let snapshot = Snapshot.of(at("2026-11-26T08:00:00-03:00"), days)
        XCTAssertEqual(snapshot.previousDay, "2026-11-25")
        XCTAssertEqual(snapshot.blueMove!.direction, .flat)
    }

    func testSnapshotDaysWithoutABlueQuoteAreSkippedWithoutHistoryThereIsNoMove() {
        let gappy = [day("2026-11-23", 169_000, 161_000), day("2026-11-24", nil, 161_500)]
        XCTAssertEqual(Snapshot.of(at("2026-11-25T12:00:00-03:00"), gappy).previousDay, "2026-11-23")
        let empty = Snapshot.of(at("2026-11-25T12:00:00-03:00"), [])
        XCTAssertNil(empty.previousDay)
        XCTAssertNil(empty.blueMove)
        XCTAssertNotNil(empty.gap)
    }

    func testRecentDaysReplaceTheTailOfTheFullHistory() {
        let full = [day("2026-11-20", 1), day("2026-11-23", 2), day("2026-11-24", 3)]
        let recent = [day("2026-11-23", 20), day("2026-11-24", 30), day("2026-11-25", 40)]
        let merged = mergeSeries(full, recent)
        XCTAssertEqual(merged.map(\.day), ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"])
        XCTAssertEqual(merged[1].blue!.sell, 20)
        XCTAssertEqual(mergeSeries([], recent), recent)
        XCTAssertEqual(mergeSeries(full, []), full)
    }

    func testRangePresetsAreCalendarWindowsEndingOnTheLastDay() {
        XCTAssertEqual(rangeStart("2026-11-25", .m1), "2026-10-26")
        XCTAssertEqual(rangeStart("2026-11-25", .y1), "2025-11-25")
        XCTAssertNil(rangeStart("2026-11-25", .max))
        let days = [day("2026-09-01", 1), day("2026-10-26", 2), day("2026-11-25", 3)]
        XCTAssertEqual(rangeOf(days, .m1).map(\.day), ["2026-10-26", "2026-11-25"])
        XCTAssertEqual(rangeOf(days, .max), days)
        XCTAssertTrue(rangeOf([], .m1).isEmpty)
        XCTAssertTrue(sliceFrom(days, "2027-01-01").isEmpty)
    }

    func testPeriodSummaryFirstLastLowHigh() {
        let days = [day("2026-11-20", 168_000), day("2026-11-23", 166_000), day("2026-11-24", nil, 161_000), day("2026-11-25", 171_000)]
        let summary = PeriodSummary.of(days)!
        XCTAssertEqual(summary.days, 3)
        XCTAssertEqual(summary.min.day, "2026-11-23")
        XCTAssertEqual(summary.max.day, "2026-11-25")
        XCTAssertEqual(summary.change!.delta, 3000)
        XCTAssertNil(PeriodSummary.of([day("2026-11-24", nil, 161_000)]))
    }

    // MARK: chart

    func testChartAxisBoundsAreRoundAndContainTheData() {
        XCTAssertTrue(niceScale(1550, 1712) == (1550, 1750, 50))
        XCTAssertTrue(niceScale(-8, 27) == (-10, 30, 10))
        let flat = niceScale(1700, 1700)
        XCTAssertLessThan(flat.min, 1700)
        XCTAssertGreaterThan(flat.max, 1700)
        XCTAssertTrue(niceScale(.infinity, -.infinity) == (0, 1, 1))
    }

    func testChartRatesTwoLinesInPesosWithLabelsInTheLocale() {
        let days = [day("2026-10-26", 156_000, 155_000), day("2026-11-10", 155_000, 157_000), day("2026-11-25", 171_000, 163_000)]
        let model = buildChart(days, .rates, .es, xTickCount: 3)
        XCTAssertEqual(model.lines.map(\.key), [.oficial, .blue])
        XCTAssertEqual(model.lines[1].values, [1560.0, 1550.0, 1710.0])
        XCTAssertEqual(model.yMin, 1550)
        XCTAssertEqual(model.yMax, 1750)
        XCTAssertEqual(model.yTicks.map(\.label), ["1.550", "1.600", "1.650", "1.700", "1.750"])
        XCTAssertEqual(model.xTicks.map(\.label), ["26/10", "10/11", "25/11"])
        XCTAssertEqual(model.xPos(0), 0)
        XCTAssertEqual(model.xPos(2), 1)
        XCTAssertEqual(model.yPos(1750), chartPad, accuracy: 1e-9)
        XCTAssertEqual(model.yPos(1550), 1 - chartPad, accuracy: 1e-9)
    }

    func testChartGapOneLineInPercentNilWhereASideIsMissing() {
        let days = [day("2026-11-23", 169_000, 161_000), day("2026-11-24", 170_000), day("2026-11-25", 171_000, 163_000)]
        let model = buildChart(days, .gap, .en)
        XCTAssertEqual(model.lines.count, 1)
        XCTAssertEqual(model.lines[0].key, .gap)
        XCTAssertNil(model.lines[0].values[1])
        XCTAssertClose(model.lines[0].values[2], 4.91, 0.01)
        XCTAssertTrue(model.yTicks.first!.label.hasSuffix("%"))
    }

    func testChartLongSpansLabelTheAxisByMonthThenByYearOldPricesKeepTheirCents() {
        let months = buildChart([day("2026-01-05", 120_000), day("2026-06-05", 130_000), day("2026-11-25", 171_000)], .rates, .es, xTickCount: 3)
        XCTAssertEqual(months.xTicks.map(\.label), ["ene 2026", "jun 2026", "nov 2026"])
        let years = buildChart([day("2011-01-03", 2407), day("2018-06-05", 2600), day("2026-11-25", 171_000)], .rates, .es, xTickCount: 3)
        XCTAssertEqual(years.xTicks.map(\.label), ["2011", "2018", "2026"])
        let cents = buildChart([day("2011-01-03", 2407), day("2011-01-04", 2409)], .rates, .es)
        XCTAssertTrue(cents.yTicks.first!.label.contains(","))
    }

    func testChartAnEmptySeriesMakesAnEmptyModelNotACrash() {
        let model = buildChart([], .rates, .es)
        XCTAssertTrue(model.isEmpty)
        XCTAssertTrue(model.xTicks.isEmpty)
    }

    // Not in the Dart suite: the blade geometry moved here from the drawing code.
    func testBladeShapesAreClosedOutlinesThatLeaveTheBox() {
        for direction in [Direction.up, .down, .flat] {
            let shape = Blade.shape(direction)
            XCTAssertEqual(shape.band.count, 2 * 66)
            XCTAssertEqual(shape.sliver.count, 2 * 66)
            let b = shape.bandBounds
            XCTAssertTrue(b.minX < 0 || b.maxX > Blade.width || b.minY < 0 || b.maxY > Blade.height)
            XCTAssertTrue(shape.band.allSatisfy { $0.x.isFinite && $0.y.isFinite })
        }
    }
}
