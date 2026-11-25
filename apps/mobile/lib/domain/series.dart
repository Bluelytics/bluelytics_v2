/// Pure transforms of the daily series for the hero, the tiles, the charts and the history table
/// (the counterpart of apps/web/src/lib/series.ts and chart.ts).
library;

import 'format.dart';
import 'models.dart';

enum Direction { up, down, flat }

/// Change from `previous` to `current`, both in hundredths.
class Move {
  const Move({required this.previous, required this.delta, required this.ratio, required this.direction});

  final int previous;
  final int delta;
  final double ratio;
  final Direction direction;

  static Move? between(int? current, int? previous) {
    if (current == null || previous == null || previous <= 0) return null;
    final delta = current - previous;
    return Move(previous: previous, delta: delta, ratio: delta / previous, direction: delta > 0 ? Direction.up : (delta < 0 ? Direction.down : Direction.flat));
  }
}

/// Blue over official sell, minus one.
double? gapRatio(int? blueSell, int? oficialSell) {
  if (blueSell == null || oficialSell == null || blueSell <= 0 || oficialSell <= 0) return null;
  return blueSell / oficialSell - 1;
}

/// What the Today screen shows: the live quotes and their move against the previous close.
class Snapshot {
  const Snapshot({required this.latest, this.previousDay, this.blueMove, this.oficialMove, this.gap});

  final Latest latest;

  /// The day the moves are measured against (`YYYY-MM-DD`).
  final String? previousDay;
  final Move? blueMove;
  final Move? oficialMove;
  final double? gap;

  /// `days` is oldest first. The previous close is the last day with a blue quote before the
  /// Argentine day of `latest.updatedAt`.
  factory Snapshot.of(Latest latest, List<DayRates> days) {
    final updatedAt = latest.updatedAt;
    DayRates? previous;
    if (updatedAt != null) {
      final today = artDay(updatedAt);
      for (var i = days.length - 1; i >= 0; i--) {
        final day = days[i];
        if (day.day.compareTo(today) < 0 && day.blue != null) {
          previous = day;
          break;
        }
      }
    }
    return Snapshot(
      latest: latest,
      previousDay: previous?.day,
      blueMove: Move.between(latest.blue?.sell, previous?.blue?.sell),
      oficialMove: Move.between(latest.oficial?.sell, previous?.oficial?.sell),
      gap: gapRatio(latest.blue?.sell, latest.oficial?.sell),
    );
  }
}

/// Recent days over the full history: `full` up to the first recent day, then `recent`.
/// `recent` is refreshed on every load, `full` a few times a day.
List<DayRates> mergeSeries(List<DayRates> full, List<DayRates> recent) {
  if (recent.isEmpty) return full;
  if (full.isEmpty) return recent;
  final first = recent.first.day;
  return [
    for (final day in full)
      if (day.day.compareTo(first) < 0) day,
    ...recent,
  ];
}

enum RangePreset {
  m1(31),
  m3(92),
  m6(183),
  y1(366),
  y5(1827),
  max(null)
  ;

  const RangePreset(this.days);

  /// Calendar days in the window; `null` for the whole series.
  final int? days;
}

/// First day (inclusive) of a preset window ending on `lastDay`; `null` for the whole series.
String? rangeStart(String lastDay, RangePreset preset) {
  final span = preset.days;
  if (span == null) return null;
  final end = DateTime.utc(int.parse(lastDay.substring(0, 4)), int.parse(lastDay.substring(5, 7)), int.parse(lastDay.substring(8, 10)));
  return end.subtract(Duration(days: span - 1)).toIso8601String().substring(0, 10);
}

/// The part of `days` with `day >= from`.
List<DayRates> sliceFrom(List<DayRates> days, String? from) {
  if (from == null) return days;
  final start = days.indexWhere((d) => d.day.compareTo(from) >= 0);
  return start < 0 ? const [] : days.sublist(start);
}

/// The days of a preset window ending on the last day of `days`.
List<DayRates> rangeOf(List<DayRates> days, RangePreset preset) {
  return days.isEmpty ? days : sliceFrom(days, rangeStart(days.last.day, preset));
}

/// First, last, lowest and highest blue sell of a set of days.
class PeriodSummary {
  const PeriodSummary({required this.first, required this.last, required this.min, required this.max, required this.days});

  final DayRates first;
  final DayRates last;
  final DayRates min;
  final DayRates max;
  final int days;

  Move? get change => Move.between(last.blue?.sell, first.blue?.sell);

  static PeriodSummary? of(List<DayRates> days) {
    final withBlue = [
      for (final d in days)
        if (d.blue != null) d,
    ];
    if (withBlue.isEmpty) return null;
    var min = withBlue.first;
    var max = withBlue.first;
    for (final d in withBlue) {
      if (d.blue!.sell < min.blue!.sell) min = d;
      if (d.blue!.sell > max.blue!.sell) max = d;
    }
    return PeriodSummary(first: withBlue.first, last: withBlue.last, min: min, max: max, days: withBlue.length);
  }
}

// ───────────── Chart model ─────────────

enum ChartMode { rates, gap }

enum LineKey { blue, oficial, gap }

class PlotLine {
  const PlotLine(this.key, this.values);

  final LineKey key;

  /// Pesos (rates) or percent (gap) per day; `null` = no value that day.
  final List<double?> values;
}

class Tick {
  const Tick(this.pos, this.label);

  /// 0 = left/top, 1 = right/bottom.
  final double pos;
  final String label;
}

class ChartModel {
  const ChartModel({
    required this.days,
    required this.lines,
    required this.mode,
    required this.yMin,
    required this.yMax,
    required this.yTicks,
    required this.xTicks,
  });

  final List<String> days;
  final List<PlotLine> lines;
  final ChartMode mode;
  final double yMin;
  final double yMax;
  final List<Tick> yTicks;
  final List<Tick> xTicks;

  bool get isEmpty => days.isEmpty || lines.every((line) => line.values.every((v) => v == null));

  /// Horizontal position (0–1) of day `index`.
  double xPos(int index) => days.length <= 1 ? 0.5 : index / (days.length - 1);

  /// Vertical position (0–1 from the top) of a value.
  double yPos(double value) => 1 - chartPad - ((value - yMin) / (yMax - yMin)) * (1 - 2 * chartPad);
}

/// Fraction of the height kept free above and below the data.
const double chartPad = 0.06;

/// Blue and official sell in pesos, or the gap in percent `(blue / oficial − 1) × 100`.
List<PlotLine> linesFor(ChartMode mode, List<DayRates> days) {
  if (mode == ChartMode.rates) {
    return [
      PlotLine(LineKey.oficial, [for (final d in days) d.oficial == null ? null : d.oficial!.sell / 100]),
      PlotLine(LineKey.blue, [for (final d in days) d.blue == null ? null : d.blue!.sell / 100]),
    ];
  }
  return [
    PlotLine(LineKey.gap, [
      for (final d in days)
        switch (gapRatio(d.blue?.sell, d.oficial?.sell)) {
          final double ratio => ratio * 100,
          null => null,
        },
    ]),
  ];
}

double _log10(double x) {
  // Powers of ten by repeated scaling: exact for the axis steps this is used for.
  var exponent = 0;
  var value = x;
  while (value >= 10) {
    value /= 10;
    exponent++;
  }
  while (value < 1) {
    value *= 10;
    exponent--;
  }
  return exponent.toDouble();
}

double _pow10(double exponent) {
  var result = 1.0;
  final n = exponent.abs().toInt();
  for (var i = 0; i < n; i++) {
    result *= 10;
  }
  return exponent < 0 ? 1 / result : result;
}

double _niceStep(double raw) {
  if (!(raw > 0) || !raw.isFinite) return 1;
  final power = _pow10(_log10(raw));
  final fraction = raw / power;
  final nice = fraction <= 1 ? 1.0 : (fraction <= 2 ? 2.0 : (fraction <= 2.5 ? 2.5 : (fraction <= 5 ? 5.0 : 10.0)));
  return nice * power;
}

/// Round axis bounds and a step that gives about `count` intervals.
({double min, double max, double step}) niceScale(double min, double max, [int count = 4]) {
  if (!min.isFinite || !max.isFinite) return (min: 0, max: 1, step: 1);
  if (min == max) {
    final spread = min.abs() * 0.05 == 0 ? 1.0 : min.abs() * 0.05;
    min -= spread;
    max += spread;
  }
  final step = _niceStep((max - min) / count);
  return (min: (min / step).floorToDouble() * step, max: (max / step).ceilToDouble() * step, step: step);
}

String _yLabel(double value, ChartMode mode, double step, AppLocale locale) {
  if (mode == ChartMode.rates) {
    // Old values are a few pesos: keep a decimal when the step is below one peso.
    return step < 1 ? formatHundredths((value * 100).round(), locale) : formatInteger(value.round(), locale);
  }
  return formatPercent(value / 100, locale, step < 1 ? 1 : 0);
}

List<Tick> _xTicks(List<String> days, AppLocale locale, int count) {
  if (days.isEmpty) return const [];
  final spanDays = DateTime.parse(days.last).difference(DateTime.parse(days.first)).inDays;
  String label(String day) {
    if (spanDays <= 100) return formatDayNumeric(day, locale);
    if (spanDays <= 3 * 366) return formatMonthShort(int.parse(day.substring(0, 4)), int.parse(day.substring(5, 7)), locale);
    return day.substring(0, 4);
  }

  final ticks = <Tick>[];
  final n = count < days.length ? count : days.length;
  for (var i = 0; i < n; i++) {
    final index = n == 1 ? days.length - 1 : ((i * (days.length - 1)) / (n - 1)).round();
    final text = label(days[index]);
    if (ticks.isNotEmpty && ticks.last.label == text) continue;
    ticks.add(Tick(days.length == 1 ? 0.5 : index / (days.length - 1), text));
  }
  return ticks;
}

ChartModel buildChart(List<DayRates> days, ChartMode mode, AppLocale locale, {int xTickCount = 4}) {
  final lines = linesFor(mode, days);
  final names = [for (final d in days) d.day];
  var low = double.infinity;
  var high = double.negativeInfinity;
  for (final line in lines) {
    for (final value in line.values) {
      if (value == null) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  final scale = niceScale(low, high);
  final yTicks = <Tick>[];
  for (var v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) {
    yTicks.add(Tick(1 - chartPad - ((v - scale.min) / (scale.max - scale.min)) * (1 - 2 * chartPad), _yLabel(v, mode, scale.step, locale)));
  }
  return ChartModel(days: names, lines: lines, mode: mode, yMin: scale.min, yMax: scale.max, yTicks: yTicks, xTicks: _xTicks(names, locale, xTickCount));
}
