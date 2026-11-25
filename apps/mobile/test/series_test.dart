import 'package:bluelytics/domain/format.dart';
import 'package:bluelytics/domain/models.dart';
import 'package:bluelytics/domain/series.dart';
import 'package:flutter_test/flutter_test.dart';

DayRates day(String name, int? blueSell, [int? oficialSell]) {
  return DayRates(
    name,
    blue: blueSell == null ? null : Quote(blueSell - 2000, blueSell),
    oficial: oficialSell == null ? null : Quote(oficialSell - 5000, oficialSell),
  );
}

void main() {
  test('a move has a sign, a ratio and a direction', () {
    final up = Move.between(171000, 170000)!;
    expect(up.delta, 1000);
    expect(up.ratio, closeTo(0.00588, 0.00001));
    expect(up.direction, Direction.up);
    expect(Move.between(170000, 171000)!.direction, Direction.down);
    expect(Move.between(170000, 170000)!.direction, Direction.flat);
    expect(Move.between(170000, null), isNull);
    expect(Move.between(null, 170000), isNull);
    expect(Move.between(170000, 0), isNull);
  });

  test('the gap is blue over official sell, minus one', () {
    expect(gapRatio(171000, 163000), closeTo(0.0491, 0.0001));
    expect(gapRatio(null, 163000), isNull);
    expect(gapRatio(171000, 0), isNull);
  });

  group('snapshot', () {
    final days = [day('2026-11-20', 168000, 160000), day('2026-11-23', 169000, 161000), day('2026-11-24', 170000, 161500), day('2026-11-25', 171000, 163000)];
    Latest at(String stamp) => Latest(blue: const Quote(169000, 171000), oficial: const Quote(158000, 163000), updatedAt: DateTime.parse(stamp));

    test('moves are measured against the last day before today, not today\'s own row', () {
      final snapshot = Snapshot.of(at('2026-11-25T19:20:00-03:00'), days);
      expect(snapshot.previousDay, '2026-11-24');
      expect(snapshot.blueMove!.delta, 1000);
      expect(snapshot.oficialMove!.delta, 1500);
      expect(snapshot.gap, closeTo(0.0491, 0.0001));
    });

    test('"today" is the Argentine day: 01:00 UTC still belongs to the evening before', () {
      final snapshot = Snapshot.of(at('2026-11-26T01:00:00Z'), days);
      expect(snapshot.previousDay, '2026-11-24');
    });

    test('before the first run of a new day the series may not have today yet', () {
      final snapshot = Snapshot.of(at('2026-11-26T08:00:00-03:00'), days);
      expect(snapshot.previousDay, '2026-11-25');
      expect(snapshot.blueMove!.direction, Direction.flat);
    });

    test('days without a blue quote are skipped; without history there is no move', () {
      final gappy = [day('2026-11-23', 169000, 161000), day('2026-11-24', null, 161500)];
      expect(Snapshot.of(at('2026-11-25T12:00:00-03:00'), gappy).previousDay, '2026-11-23');
      final empty = Snapshot.of(at('2026-11-25T12:00:00-03:00'), const []);
      expect(empty.previousDay, isNull);
      expect(empty.blueMove, isNull);
      expect(empty.gap, isNotNull);
    });
  });

  test('recent days replace the tail of the full history', () {
    final full = [day('2026-11-20', 1), day('2026-11-23', 2), day('2026-11-24', 3)];
    final recent = [day('2026-11-23', 20), day('2026-11-24', 30), day('2026-11-25', 40)];
    final merged = mergeSeries(full, recent);
    expect(merged.map((d) => d.day), ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25']);
    expect(merged[1].blue!.sell, 20);
    expect(mergeSeries(const [], recent), same(recent));
    expect(mergeSeries(full, const []), same(full));
  });

  test('range presets are calendar windows ending on the last day', () {
    expect(rangeStart('2026-11-25', RangePreset.m1), '2026-10-26');
    expect(rangeStart('2026-11-25', RangePreset.y1), '2025-11-25');
    expect(rangeStart('2026-11-25', RangePreset.max), isNull);
    final days = [day('2026-09-01', 1), day('2026-10-26', 2), day('2026-11-25', 3)];
    expect(rangeOf(days, RangePreset.m1).map((d) => d.day), ['2026-10-26', '2026-11-25']);
    expect(rangeOf(days, RangePreset.max), same(days));
    expect(rangeOf(const [], RangePreset.m1), isEmpty);
    expect(sliceFrom(days, '2027-01-01'), isEmpty);
  });

  test('period summary: first, last, low, high', () {
    final days = [day('2026-11-20', 168000), day('2026-11-23', 166000), day('2026-11-24', null, 161000), day('2026-11-25', 171000)];
    final summary = PeriodSummary.of(days)!;
    expect(summary.days, 3);
    expect(summary.min.day, '2026-11-23');
    expect(summary.max.day, '2026-11-25');
    expect(summary.change!.delta, 3000);
    expect(PeriodSummary.of([day('2026-11-24', null, 161000)]), isNull);
  });

  group('chart', () {
    test('axis bounds are round and contain the data', () {
      expect(niceScale(1550, 1712), (min: 1550.0, max: 1750.0, step: 50.0));
      expect(niceScale(-8, 27), (min: -10.0, max: 30.0, step: 10.0));
      final flat = niceScale(1700, 1700);
      expect(flat.min, lessThan(1700));
      expect(flat.max, greaterThan(1700));
      expect(niceScale(double.infinity, double.negativeInfinity), (min: 0.0, max: 1.0, step: 1.0));
    });

    test('rates: two lines in pesos with labels in the locale', () {
      final days = [day('2026-10-26', 156000, 155000), day('2026-11-10', 155000, 157000), day('2026-11-25', 171000, 163000)];
      final model = buildChart(days, ChartMode.rates, AppLocale.es, xTickCount: 3);
      expect(model.lines.map((line) => line.key), [LineKey.oficial, LineKey.blue]);
      expect(model.lines[1].values, [1560.0, 1550.0, 1710.0]);
      expect(model.yMin, 1550);
      expect(model.yMax, 1750);
      expect(model.yTicks.map((t) => t.label), ['1.550', '1.600', '1.650', '1.700', '1.750']);
      expect(model.xTicks.map((t) => t.label), ['26/10', '10/11', '25/11']);
      expect(model.xPos(0), 0);
      expect(model.xPos(2), 1);
      expect(model.yPos(1750), closeTo(chartPad, 1e-9));
      expect(model.yPos(1550), closeTo(1 - chartPad, 1e-9));
    });

    test('gap: one line in percent, null where a side is missing', () {
      final days = [day('2026-11-23', 169000, 161000), day('2026-11-24', 170000), day('2026-11-25', 171000, 163000)];
      final model = buildChart(days, ChartMode.gap, AppLocale.en);
      expect(model.lines.single.key, LineKey.gap);
      expect(model.lines.single.values[1], isNull);
      expect(model.lines.single.values[2], closeTo(4.91, 0.01));
      expect(model.yTicks.first.label, endsWith('%'));
    });

    test('long spans label the axis by month, then by year; old prices keep their cents', () {
      final months = buildChart(
        [day('2026-01-05', 120000), day('2026-06-05', 130000), day('2026-11-25', 171000)],
        ChartMode.rates,
        AppLocale.es,
        xTickCount: 3,
      );
      expect(months.xTicks.map((t) => t.label), ['ene 2026', 'jun 2026', 'nov 2026']);
      final years = buildChart([day('2011-01-03', 2407), day('2018-06-05', 2600), day('2026-11-25', 171000)], ChartMode.rates, AppLocale.es, xTickCount: 3);
      expect(years.xTicks.map((t) => t.label), ['2011', '2018', '2026']);
      final cents = buildChart([day('2011-01-03', 2407), day('2011-01-04', 2409)], ChartMode.rates, AppLocale.es);
      expect(cents.yTicks.first.label, contains(','));
    });

    test('an empty series makes an empty model, not an exception', () {
      final model = buildChart(const [], ChartMode.rates, AppLocale.es);
      expect(model.isEmpty, isTrue);
      expect(model.xTicks, isEmpty);
    });
  });
}
