/// A market tape with every published rate, scrolling like a trading-floor board (the site's
/// `Ticker.astro`). It is an endless horizontal list moved by a ticker: it can be dragged, it waits
/// while a finger is on it, and with reduced motion it only moves when dragged.
library;

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import '../domain/series.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import 'glyphs.dart';
import 'primitives.dart';

class TapeItem {
  const TapeItem({required this.label, required this.value, this.direction, this.change});

  final String label;
  final String value;
  final Direction? direction;
  final String? change;

  String get spoken => change == null ? '$label $value' : '$label $value, $change';
}

class TickerTape extends StatefulWidget {
  const TickerTape({super.key, required this.items, required this.semanticLabel});

  final List<TapeItem> items;
  final String semanticLabel;

  /// Pixels per second.
  static const double speed = 34;

  @override
  State<TickerTape> createState() => _TickerTapeState();
}

class _TickerTapeState extends State<TickerTape> with SingleTickerProviderStateMixin {
  final ScrollController _scroll = ScrollController();
  late final Ticker _ticker = createTicker(_onTick);
  Duration _last = Duration.zero;
  int _fingers = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animate = !reducedMotion(context);
    if (animate && !_ticker.isActive) {
      _last = Duration.zero;
      _ticker.start();
    } else if (!animate && _ticker.isActive) {
      _ticker.stop();
    }
  }

  void _onTick(Duration elapsed) {
    final dt = (elapsed - _last).inMicroseconds / 1e6;
    _last = elapsed;
    if (_fingers > 0 || !_scroll.hasClients || dt <= 0 || dt > 0.5) return;
    final position = _scroll.position;
    // A fling after a drag keeps its momentum; the tape resumes when it comes to rest.
    if (position.isScrollingNotifier.value) return;
    position.jumpTo(position.pixels + TickerTape.speed * dt);
  }

  @override
  void dispose() {
    _ticker.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;
    if (items.isEmpty) return const SizedBox.shrink();
    return Semantics(
      container: true,
      label: '${widget.semanticLabel}: ${items.map((item) => item.spoken).join('; ')}',
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Bl.navy.withValues(alpha: 0.45),
            border: const Border(bottom: BorderSide(color: Bl.line)),
          ),
          child: SizedBox(
            height: 38,
            child: Listener(
              onPointerDown: (_) => _fingers++,
              onPointerUp: (_) => _fingers = _fingers > 0 ? _fingers - 1 : 0,
              onPointerCancel: (_) => _fingers = _fingers > 0 ? _fingers - 1 : 0,
              child: ListView.builder(
                controller: _scroll,
                scrollDirection: Axis.horizontal,
                physics: const ClampingScrollPhysics(),
                padding: const EdgeInsets.only(left: Bl.gutter),
                itemBuilder: (context, index) => _TapeCell(items[index % items.length]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TapeCell extends StatelessWidget {
  const _TapeCell(this.item);

  final TapeItem item;

  @override
  Widget build(BuildContext context) {
    final direction = item.direction ?? Direction.flat;
    final changeColor = directionColor(direction, flat: Bl.dim);
    return Padding(
      padding: const EdgeInsets.only(right: 18),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(item.label.toUpperCase(), style: mono(11, weight: 500, color: Bl.dim, tracking: 0.1, height: 1)),
          const SizedBox(width: 10),
          Text(item.value, style: mono(12.5, weight: 600, color: Bl.text, height: 1)),
          if (item.change != null) ...[
            const SizedBox(width: 10),
            if (direction != Direction.flat) ...[DirectionMark(direction, size: 7, color: changeColor), const SizedBox(width: 5)],
            Text(item.change!, style: mono(11.5, weight: 500, color: changeColor, height: 1)),
          ],
          const SizedBox(width: 18),
          Text('/', style: mono(12.5, weight: 500, color: Bl.lineStrong, height: 1)),
        ],
      ),
    );
  }
}
