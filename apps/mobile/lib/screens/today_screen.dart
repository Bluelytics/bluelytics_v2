/// Today: the tape, the blue dollar hero, the other rates and a quick dollars-to-pesos table.
library;

import 'package:flutter/material.dart' show RefreshIndicator;
import 'package:flutter/widgets.dart';

import '../data/store.dart';
import '../domain/format.dart';
import '../domain/models.dart';
import '../domain/series.dart';
import '../i18n/strings.dart';
import '../scope.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import '../widgets/blade.dart';
import '../widgets/glyphs.dart';
import '../widgets/primitives.dart';
import '../widgets/rate_chart.dart';
import '../widgets/ticker_tape.dart';

class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key, required this.onOpenHistory});

  /// Opens the History tab in the given mode (from the official and gap tiles).
  final ValueChanged<ChartMode> onOpenHistory;

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final store = scope.store;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final snapshot = store.snapshot;
        if (snapshot == null || snapshot.latest.blue == null) return _Empty(store: store, strings: scope.strings);
        return RefreshIndicator.adaptive(
          color: Bl.brandInk,
          backgroundColor: Bl.surface2,
          onRefresh: () => store.refresh(force: true),
          child: _Content(store: store, snapshot: snapshot, strings: scope.strings, onOpenHistory: onOpenHistory),
        );
      },
    );
  }
}

/// Nothing to show yet: the first load is running, or it failed with an empty cache.
class _Empty extends StatelessWidget {
  const _Empty({required this.store, required this.strings});

  final AppStore store;
  final Strings strings;

  @override
  Widget build(BuildContext context) {
    final failed = store.offline && !store.loading;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: failed
            ? Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(strings.firstLoadFailed, textAlign: TextAlign.center, style: BlType.h2()),
                  const SizedBox(height: 8),
                  Text(strings.firstLoadHint, textAlign: TextAlign.center, style: BlType.body()),
                  const SizedBox(height: 24),
                  Pressable(
                    onTap: () => store.refresh(force: true),
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: Bl.brand, borderRadius: BorderRadius.circular(2)),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
                        child: Text(strings.retry.toUpperCase(), style: mono(12.5, weight: 600, tracking: 0.12, height: 1)),
                      ),
                    ),
                  ),
                ],
              )
            : Text(strings.loading.toUpperCase(), style: BlType.label()),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.store, required this.snapshot, required this.strings, required this.onOpenHistory});

  final AppStore store;
  final Snapshot snapshot;
  final Strings strings;
  final ValueChanged<ChartMode> onOpenHistory;

  static const List<String> _extraOrder = ['mep', 'ccl', 'cripto', 'tarjeta', 'mayorista'];

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    final latest = snapshot.latest;
    final blue = latest.blue!;
    final oficial = latest.oficial;
    final extras = [
      for (final code in _extraOrder)
        for (final rate in store.extras)
          if (rate.code == code) rate,
    ];
    String? changeOf(Move? move) => move == null ? null : formatSignedPercent(move.ratio, locale, 2);
    final tape = [
      TapeItem(label: strings.blue, value: formatPesos(blue.sell, locale), direction: snapshot.blueMove?.direction, change: changeOf(snapshot.blueMove)),
      if (oficial != null)
        TapeItem(
          label: strings.oficial,
          value: formatPesos(oficial.sell, locale),
          direction: snapshot.oficialMove?.direction,
          change: changeOf(snapshot.oficialMove),
        ),
      if (latest.blueEuro != null) TapeItem(label: strings.euroBlue, value: formatPesos(latest.blueEuro!.sell, locale)),
      if (snapshot.gap != null) TapeItem(label: strings.gap, value: formatPercent(snapshot.gap!, locale)),
      for (final rate in extras) TapeItem(label: strings.extraName(rate.code), value: formatPesosCents(rate.sell, locale)),
    ];
    final tiles = [
      if (oficial != null)
        _Tile(
          label: strings.oficial,
          value: formatPesos(oficial.sell, locale),
          move: snapshot.oficialMove,
          foot: '${strings.buy} ${formatPesos(oficial.buy, locale)}',
          locale: locale,
          onTap: () => onOpenHistory(ChartMode.rates),
        ),
      if (snapshot.gap != null)
        _Tile(
          label: strings.gapLong,
          value: formatPercent(snapshot.gap!, locale),
          foot: strings.gapFoot,
          locale: locale,
          onTap: () => onOpenHistory(ChartMode.gap),
        ),
      if (latest.blueEuro != null)
        _Tile(
          label: strings.euroBlue,
          value: formatPesos(latest.blueEuro!.sell, locale),
          foot: '${strings.buy} ${formatPesos(latest.blueEuro!.buy, locale)}',
          locale: locale,
        ),
      if (latest.oficialEuro != null)
        _Tile(
          label: strings.euroOficial,
          value: formatPesos(latest.oficialEuro!.sell, locale),
          foot: '${strings.buy} ${formatPesos(latest.oficialEuro!.buy, locale)}',
          locale: locale,
        ),
    ];

    // A plain column, not a lazy list: there are a dozen blocks, and exact heights keep the scroll
    // extent right from the first frame.
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TickerTape(items: tape, semanticLabel: strings.allRates),
          const SizedBox(height: 20),
          ContentWidth(
            child: _Hero(strings: strings, blue: blue, snapshot: snapshot, offline: store.offline, chartDays: rangeOf(store.recent, RangePreset.m1)),
          ),
          if (tiles.isNotEmpty) ...[const SizedBox(height: 28), ContentWidth(child: _TileGrid(tiles: tiles))],
          if (extras.isNotEmpty) ...[
            const SizedBox(height: 36),
            ContentWidth(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SectionHead(strings.otherRates, note: strings.otherRatesNote),
                  const SizedBox(height: 16),
                  _MiniGrid(
                    children: [for (final rate in extras) _Mini(label: strings.extraName(rate.code), value: formatPesosCents(rate.sell, locale))],
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 36),
          ContentWidth(
            child: _QuickTable(blue: blue, strings: strings),
          ),
          const SizedBox(height: 28),
          ContentWidth(child: Text(strings.disclaimer, style: BlType.small())),
          const SizedBox(height: 28),
          const Wordmark(),
        ],
      ),
    );
  }
}

/// The page's main quote in the social cards' language: the blade sweeps behind a very large sell
/// price, the move sits in a diagonal-cut slab, buy and average follow on a ruled ledger.
class _Hero extends StatelessWidget {
  const _Hero({required this.strings, required this.blue, required this.snapshot, required this.offline, required this.chartDays});

  final Strings strings;
  final Quote blue;
  final Snapshot snapshot;
  final bool offline;
  final List<DayRates> chartDays;

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    final move = snapshot.blueMove;
    final direction = move?.direction ?? Direction.flat;
    final updatedAt = snapshot.latest.updatedAt;
    final width = MediaQuery.sizeOf(context).width.clamp(0.0, Bl.maxWidth);
    // The site's `clamp(4.6rem, 2.2rem + 12vw, 10.5rem)`.
    final figureSize = (35.2 + 0.12 * width).clamp(73.6, 132.0);
    final price = formatAmount(blue.sell, locale);

    return ClipRRect(
      borderRadius: BorderRadius.circular(Bl.radius),
      child: DecoratedBox(
        position: DecorationPosition.foreground,
        decoration: BoxDecoration(
          border: Border.all(color: Bl.line),
          borderRadius: BorderRadius.circular(Bl.radius),
        ),
        child: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(begin: Alignment(-0.6, -1), end: Alignment(0.6, 1), colors: [Bl.navy, Bl.ink], stops: [0, 0.78]),
          ),
          child: Stack(
            children: [
              Positioned.fill(child: _Sweep(direction: direction)),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Rise(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Semantics(
                            header: true,
                            child: Text(strings.todayTitle, style: sans(19, weight: 700, color: Bl.soft, tracking: -0.02, height: 1.15)),
                          ),
                          if (updatedAt != null) ...[const SizedBox(height: 8), _Stamp(strings: strings, updatedAt: updatedAt, offline: offline)],
                        ],
                      ),
                    ),
                    const SizedBox(height: 22),
                    Rise(
                      delay: const Duration(milliseconds: 80),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(strings.sell.toUpperCase(), style: BlType.label()),
                          const SizedBox(height: 6),
                          Semantics(
                            label: '${strings.sell} ${formatPesos(blue.sell, locale)}',
                            child: ExcludeSemantics(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Padding(
                                      padding: EdgeInsets.only(top: figureSize * 0.1, right: figureSize * 0.1),
                                      child: Text(r'$', style: sans(figureSize * 0.36, weight: 600, color: Bl.soft, height: 1)),
                                    ),
                                    Text(
                                      price,
                                      style: sans(figureSize, weight: 800, tracking: -0.065, height: 0.9, tabular: true).copyWith(
                                        shadows: [Shadow(color: Bl.ink.withValues(alpha: 0.55), blurRadius: 30, offset: const Offset(0, 2))],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          if (move != null) ...[
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 14,
                              runSpacing: 8,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                MoveSlab(move: move, locale: locale),
                                if (snapshot.previousDay != null)
                                  Text(strings.vsPrevious(formatDay(snapshot.previousDay!, locale, short: true)), style: BlType.note()),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 22),
                    Rise(
                      delay: const Duration(milliseconds: 160),
                      child: _Ledger(entries: [(strings.buy, formatPesos(blue.buy, locale)), (strings.average, formatPesosCents(blue.average, locale))]),
                    ),
                    if (chartDays.length > 1) ...[
                      const SizedBox(height: 22),
                      Rise(
                        delay: const Duration(milliseconds: 240),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Bl.ink.withValues(alpha: 0.78),
                            border: Border.all(color: Bl.line),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                            child: RateChart(
                              days: chartDays,
                              mode: ChartMode.rates,
                              locale: locale,
                              lineNames: {LineKey.blue: strings.blueShort, LineKey.oficial: strings.oficialShort},
                              emptyText: strings.noData,
                              height: 150,
                              xTickCount: 3,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The blade, sweeping in once from the left.
class _Sweep extends StatefulWidget {
  const _Sweep({required this.direction});

  final Direction direction;

  @override
  State<_Sweep> createState() => _SweepState();
}

class _SweepState extends State<_Sweep> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));
  late final Animation<double> _curve = CurvedAnimation(parent: _controller, curve: const Cubic(0.2, 0.7, 0.2, 1));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (reducedMotion(context)) {
      _controller.value = 1;
    } else {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _curve,
        builder: (context, _) => CustomPaint(
          painter: BladePainter(direction: widget.direction, progress: _curve.value),
        ),
      ),
    );
  }
}

class _Stamp extends StatelessWidget {
  const _Stamp({required this.strings, required this.updatedAt, required this.offline});

  final Strings strings;
  final DateTime updatedAt;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final when = formatDateTime(updatedAt, strings.locale);
    final text = offline ? '${strings.offline} · $when' : '${strings.updated} $when';
    return DecoratedBox(
      decoration: BoxDecoration(color: Bl.ink.withValues(alpha: 0.72)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            LiveDot(live: !offline),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                text.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: mono(11, weight: 500, color: offline ? Bl.warn : Bl.dim, tracking: 0.08, height: 1.3),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Two figures side by side under a strong rule, split by a hairline.
class _Ledger extends StatelessWidget {
  const _Ledger({required this.entries});

  final List<(String label, String value)> entries;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Bl.lineStrong)),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < entries.length; i++) ...[
              if (i > 0) const Hairline(vertical: true),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(top: 12, left: i > 0 ? 18 : 0),
                  child: MergeSemantics(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(entries[i].$1.toUpperCase(), style: BlType.label()),
                        const SizedBox(height: 4),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(entries[i].$2, style: sans(25, weight: 700, tracking: -0.04, height: 1.15, tabular: true)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A ruled ledger entry for one rate.
class _Tile extends StatelessWidget {
  const _Tile({required this.label, required this.value, required this.locale, this.move, this.foot, this.onTap});

  final String label;
  final String value;
  final AppLocale locale;
  final Move? move;
  final String? foot;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final body = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(label.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: BlType.label()),
            ),
            if (onTap != null) const GlyphIcon(Glyph.arrowRight, size: 14, color: Bl.dim, stroke: 1.4),
          ],
        ),
        const SizedBox(height: 8),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(value, style: sans(30, weight: 750, tracking: -0.045, height: 1.1, tabular: true)),
        ),
        if (move != null) ...[const SizedBox(height: 8), MoveChip(move: move!, locale: locale)],
        if (foot != null) ...[const SizedBox(height: 8), Text(foot!, style: mono(12, weight: 500, color: Bl.dim, height: 1.3))],
      ],
    );
    if (onTap == null) return MergeSemantics(child: body);
    return Pressable(
      onTap: onTap,
      child: MergeSemantics(child: body),
    );
  }
}

/// Tiles two to a row, ruled like a ledger page.
class _TileGrid extends StatelessWidget {
  const _TileGrid({required this.tiles});

  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      final second = i + 1 < tiles.length ? tiles[i + 1] : null;
      rows.add(
        DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: Bl.line)),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: Padding(padding: const EdgeInsets.fromLTRB(0, 18, 14, 18), child: tiles[i]),
                ),
                const Hairline(vertical: true),
                Expanded(
                  child: second == null ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.fromLTRB(16, 18, 0, 18), child: second),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Bl.lineStrong)),
      ),
      child: Column(children: rows),
    );
  }
}

class _MiniGrid extends StatelessWidget {
  const _MiniGrid({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 10.0;
        final width = (constraints.maxWidth - gap) / 2;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [for (final child in children) SizedBox(width: width, child: child)],
        );
      },
    );
  }
}

/// A small reference rate: a brand rule on the left and a wash fading right.
class _Mini extends StatelessWidget {
  const _Mini({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return MergeSemantics(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [Bl.brandDeep.withValues(alpha: 0.12), Bl.brandDeep.withValues(alpha: 0)]),
          border: const Border(left: BorderSide(color: Bl.brandDeep, width: 2)),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: BlType.label()),
              const SizedBox(height: 4),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(value, style: sans(20, weight: 700, tracking: -0.03, height: 1.2, tabular: true)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What 1 to 1,000 dollars come to at the blue rate.
class _QuickTable extends StatelessWidget {
  const _QuickTable({required this.blue, required this.strings});

  final Quote blue;
  final Strings strings;

  static const List<int> _amounts = [1, 10, 100, 500, 1000];

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    Widget row(String a, String b, String c, {required bool head}) {
      final style = head ? BlType.label() : mono(13.5, weight: 500, color: Bl.text, height: 1.3);
      return DecoratedBox(
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: head ? Bl.lineStrong : Bl.line)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 11),
          child: MergeSemantics(
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Text(a, style: head ? style : mono(13.5, weight: 500, color: Bl.soft, height: 1.3)),
                ),
                Expanded(
                  flex: 4,
                  child: Text(b, textAlign: TextAlign.right, style: style),
                ),
                Expanded(
                  flex: 4,
                  child: Text(c, textAlign: TextAlign.right, style: style),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHead(strings.quickTitle),
        const SizedBox(height: 14),
        const Hairline(strong: true),
        row('USD', strings.ifYouBuy.toUpperCase(), strings.ifYouSell.toUpperCase(), head: true),
        for (final amount in _amounts)
          row(
            'US\$${locale == AppLocale.es ? nbsp : ''}${formatInteger(amount, locale)}',
            formatPesos(amount * blue.sell, locale),
            formatPesos(amount * blue.buy, locale),
            head: false,
          ),
        const SizedBox(height: 12),
        Text(strings.quickNote, style: BlType.small()),
      ],
    );
  }
}
