/// History: the daily series since 2011 as a chart with range presets, a summary of the period and
/// the days themselves, newest first.
library;

import 'package:flutter/widgets.dart';

import '../domain/format.dart';
import '../domain/models.dart';
import '../domain/series.dart';
import '../i18n/strings.dart';
import '../scope.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import '../widgets/primitives.dart';
import '../widgets/rate_chart.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.mode, required this.onModeChanged});

  /// Owned by the shell, so the Today tiles can open this screen on the gap.
  final ChartMode mode;
  final ValueChanged<ChartMode> onModeChanged;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  RangePreset _range = RangePreset.y1;

  // The window is recomputed only when the series or the preset changes: the chart keeps its
  // reading while unrelated store updates pass by.
  List<DayRates>? _source;
  RangePreset? _sourceRange;
  List<DayRates> _window = const [];

  List<DayRates> _windowOf(List<DayRates> series) {
    if (!identical(series, _source) || _sourceRange != _range) {
      _source = series;
      _sourceRange = _range;
      _window = rangeOf(series, _range);
    }
    return _window;
  }

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final strings = scope.strings;
    final locale = strings.locale;
    final store = scope.store;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final days = _windowOf(store.series);
        final summary = PeriodSummary.of(days);
        // Presets longer than the recent days need the full history, which arrives a moment later.
        final waiting = !store.hasFullSeries && store.loading;
        return CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: ContentWidth(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 24),
                    Semantics(header: true, child: Text(strings.historyTitle, style: BlType.h1())),
                    const SizedBox(height: 8),
                    Text(strings.historyLead, style: BlType.body()),
                    const SizedBox(height: 20),
                    Segmented<ChartMode>(
                      values: ChartMode.values,
                      selected: widget.mode,
                      labelOf: (mode) => mode == ChartMode.rates ? strings.modeRates : strings.modeGap,
                      onChanged: widget.onModeChanged,
                      semanticLabel: strings.chartOf,
                    ),
                    const SizedBox(height: 10),
                    Segmented<RangePreset>(
                      values: RangePreset.values,
                      selected: _range,
                      labelOf: (preset) => strings.rangeLabel(preset.name),
                      onChanged: (preset) => setState(() => _range = preset),
                      semanticLabel: strings.range,
                    ),
                    const SizedBox(height: 18),
                    Panel(
                      padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                      child: RateChart(
                        days: days,
                        mode: widget.mode,
                        locale: locale,
                        lineNames: {LineKey.blue: strings.blueShort, LineKey.oficial: strings.oficialShort, LineKey.gap: strings.gap},
                        emptyText: waiting ? strings.loadingHistory : strings.noData,
                        height: 240,
                      ),
                    ),
                    if (waiting) ...[const SizedBox(height: 10), Text(strings.loadingHistory, style: BlType.note())],
                    if (summary != null) ...[const SizedBox(height: 24), _Summary(summary: summary, strings: strings)],
                    const SizedBox(height: 36),
                    SectionHead(strings.dayByDay, note: summary == null ? null : strings.daysCount(summary.days)),
                    const SizedBox(height: 14),
                    const Hairline(strong: true),
                    _DayRow.head(strings),
                  ],
                ),
              ),
            ),
            SliverList.builder(
              itemCount: days.length,
              // Newest first.
              itemBuilder: (context, index) => ContentWidth(
                child: _DayRow(day: days[days.length - 1 - index], locale: locale),
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 40)),
          ],
        );
      },
    );
  }
}

/// Change, low, high and the current gap of the period, as a 2×2 ledger.
class _Summary extends StatelessWidget {
  const _Summary({required this.summary, required this.strings});

  final PeriodSummary summary;
  final Strings strings;

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    final change = summary.change;
    final gap = gapRatio(summary.last.blue?.sell, summary.last.oficial?.sell);
    Widget cell(String label, String value, String? foot, {Color color = Bl.text, bool left = true}) {
      return Expanded(
        child: Padding(
          padding: EdgeInsets.fromLTRB(left ? 0 : 16, 12, left ? 12 : 0, 14),
          child: MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label.toUpperCase(), style: BlType.label()),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(value, style: sans(24, weight: 700, color: color, tracking: -0.04, height: 1.15, tabular: true)),
                ),
                if (foot != null) ...[const SizedBox(height: 4), Text(foot, style: BlType.note())],
              ],
            ),
          ),
        ),
      );
    }

    Widget row(Widget a, Widget b) => DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Bl.line)),
      ),
      child: IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [a, const Hairline(vertical: true), b]),
      ),
    );

    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Bl.lineStrong)),
      ),
      child: Column(
        children: [
          row(
            cell(
              strings.change,
              change == null ? '–' : formatSignedPercent(change.ratio, locale),
              change == null ? null : '${formatPesos(summary.first.blue!.sell, locale)} → ${formatPesos(summary.last.blue!.sell, locale)}',
              color: change == null ? Bl.text : directionColor(change.direction, flat: Bl.text),
            ),
            cell(strings.gapNow, gap == null ? '–' : formatPercent(gap, locale), strings.gapFoot, left: false),
          ),
          row(
            cell(strings.lowest, formatPesos(summary.min.blue!.sell, locale), formatDay(summary.min.day, locale, short: true)),
            cell(strings.highest, formatPesos(summary.max.blue!.sell, locale), formatDay(summary.max.day, locale, short: true), left: false),
          ),
        ],
      ),
    );
  }
}

/// One day of the table: date, blue sell, official sell and the gap.
class _DayRow extends StatelessWidget {
  const _DayRow({required DayRates this.day, required AppLocale this.locale}) : strings = null;

  const _DayRow.head(Strings this.strings) : day = null, locale = null;

  final DayRates? day;
  final AppLocale? locale;
  final Strings? strings;

  @override
  Widget build(BuildContext context) {
    final head = strings;
    final List<String> cells;
    if (head != null) {
      cells = [head.date, head.blueShort, head.oficialSellHead, head.gap].map((text) => text.toUpperCase()).toList();
    } else {
      final d = day!;
      final l = locale!;
      final gap = gapRatio(d.blue?.sell, d.oficial?.sell);
      cells = [
        formatDayNumeric(d.day, l, withYear: true),
        d.blue == null ? '–' : formatAmount(d.blue!.sell, l),
        d.oficial == null ? '–' : formatAmount(d.oficial!.sell, l),
        gap == null ? '–' : formatPercent(gap, l),
      ];
    }
    final style = head != null ? BlType.label() : mono(13, weight: 500, color: Bl.text, height: 1.3);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: head != null ? Bl.lineStrong : Bl.line)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: MergeSemantics(
          child: Row(
            children: [
              Expanded(
                flex: 5,
                child: Text(cells[0], style: head != null ? style : mono(13, weight: 500, color: Bl.soft, height: 1.3)),
              ),
              Expanded(
                flex: 4,
                child: Text(cells[1], textAlign: TextAlign.right, style: style),
              ),
              Expanded(
                flex: 4,
                child: Text(cells[2], textAlign: TextAlign.right, style: style),
              ),
              Expanded(
                flex: 4,
                child: Text(
                  cells[3],
                  textAlign: TextAlign.right,
                  style: head != null ? style : mono(13, weight: 500, color: Bl.muted, height: 1.3),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
