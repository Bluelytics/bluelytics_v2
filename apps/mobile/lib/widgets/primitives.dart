/// The small pieces of the "Editorial Bold" look shared by every screen.
library;

import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../domain/format.dart';
import '../domain/series.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import 'glyphs.dart';

/// Whether the platform asks for reduced motion: loops stop and entrances are skipped.
bool reducedMotion(BuildContext context) => MediaQuery.disableAnimationsOf(context);

Color directionColor(Direction direction, {Color flat = Bl.soft}) => switch (direction) {
  Direction.up => Bl.up,
  Direction.down => Bl.down,
  Direction.flat => flat,
};

/// The page background: ink with two soft glows at the top and a faint rule every 64 px.
class BlBackground extends StatelessWidget {
  const BlBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(painter: const _BackgroundPainter(), child: child);
  }
}

class _BackgroundPainter extends CustomPainter {
  const _BackgroundPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    canvas.drawRect(rect, Paint()..color = Bl.ink);
    void glow(Alignment center, double radius, Color color) {
      final shader = RadialGradient(center: center, radius: radius, colors: [color, color.withValues(alpha: 0)], stops: const [0, 0.7]).createShader(rect);
      canvas.drawRect(rect, Paint()..shader = shader);
    }

    glow(const Alignment(-0.64, -1.1), 0.95, Bl.navy.withValues(alpha: 0.95));
    glow(const Alignment(1, -1), 0.7, Bl.brandDeep.withValues(alpha: 0.16));
    final rule = Paint()
      ..color = Bl.brandInk.withValues(alpha: 0.035)
      ..strokeWidth = 1;
    for (var y = 0.5; y < size.height; y += 64) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), rule);
    }
  }

  @override
  bool shouldRepaint(_BackgroundPainter oldDelegate) => false;
}

/// Centres a screen's column and keeps it readable on tablets.
class ContentWidth extends StatelessWidget {
  const ContentWidth({super.key, required this.child, this.padded = true});

  final Widget child;
  final bool padded;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: Bl.maxWidth),
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: padded ? Bl.gutter : 0),
          child: child,
        ),
      ),
    );
  }
}

/// A 1 px rule.
class Hairline extends StatelessWidget {
  const Hairline({super.key, this.strong = false, this.vertical = false});

  final bool strong;
  final bool vertical;

  @override
  Widget build(BuildContext context) {
    final color = strong ? Bl.lineStrong : Bl.line;
    return vertical ? SizedBox(width: 1, child: ColoredBox(color: color)) : SizedBox(height: 1, child: ColoredBox(color: color));
  }
}

/// A hairline panel: no soft card, no shadow.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(16)});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Bl.navy.withValues(alpha: 0.5), Bl.surface.withValues(alpha: 0.5)],
        ),
        border: Border.all(color: Bl.line),
        borderRadius: BorderRadius.circular(Bl.radius),
      ),
      child: Padding(padding: padding, child: child),
    );
  }
}

/// A section title with the slanted blade tick in front.
class SectionHead extends StatelessWidget {
  const SectionHead(this.title, {super.key, this.note});

  final String title;
  final String? note;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Row(
            children: [
              Transform(
                transform: Matrix4.skewX(-math.tan(32 * math.pi / 180)),
                alignment: Alignment.center,
                child: const SizedBox(
                  width: 18,
                  height: 4.5,
                  child: DecoratedBox(
                    decoration: BoxDecoration(gradient: LinearGradient(colors: [Bl.brandDeep, Bl.brand])),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Flexible(child: Text(title, style: BlType.h2())),
            ],
          ),
        ),
        if (note != null) ...[const SizedBox(height: 6), Text(note!, style: BlType.small())],
      ],
    );
  }
}

/// The social cards' diagonal-cut block with the day's move: `▲ +30 │ +1,83 %`.
class MoveSlab extends StatelessWidget {
  const MoveSlab({super.key, required this.move, required this.locale});

  final Move move;
  final AppLocale locale;

  @override
  Widget build(BuildContext context) {
    final style = mono(16.5, weight: 700, color: Bl.ink, tracking: -0.01, height: 1);
    final delta = formatSignedAmount(move.delta, locale);
    final percent = formatSignedPercent(move.ratio, locale, 2);
    return Semantics(
      label: '$delta, $percent',
      child: ExcludeSemantics(
        child: ClipPath(
          clipper: const _SlabClipper(),
          child: ColoredBox(
            color: directionColor(move.direction),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 28, 10),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (move.direction != Direction.flat) ...[DirectionMark(move.direction, size: 11, color: Bl.ink), const SizedBox(width: 10)],
                  Text(delta, style: style),
                  const SizedBox(width: 11),
                  SizedBox(width: 1, height: 18, child: ColoredBox(color: Bl.ink.withValues(alpha: 0.35))),
                  const SizedBox(width: 11),
                  Text(percent, style: style),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SlabClipper extends CustomClipper<Path> {
  const _SlabClipper();

  @override
  Path getClip(Size size) {
    return Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width - 16, size.height)
      ..lineTo(0, size.height)
      ..close();
  }

  @override
  bool shouldReclip(_SlabClipper oldClipper) => false;
}

/// The compact inline form of a move: `▲ +10 (+0,62 %)`.
class MoveChip extends StatelessWidget {
  const MoveChip({super.key, required this.move, required this.locale});

  final Move move;
  final AppLocale locale;

  @override
  Widget build(BuildContext context) {
    final color = directionColor(move.direction);
    final background = switch (move.direction) {
      Direction.up => Bl.upBg,
      Direction.down => Bl.downBg,
      Direction.flat => Bl.flatBg,
    };
    final text = '${formatSignedAmount(move.delta, locale)} (${formatSignedPercent(move.ratio, locale, 2)})';
    return Semantics(
      label: text,
      child: ExcludeSemantics(
        child: DecoratedBox(
          decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(2)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (move.direction != Direction.flat) ...[DirectionMark(move.direction, size: 8, color: color), const SizedBox(width: 6)],
                Flexible(
                  child: Text(
                    text,
                    style: mono(12, weight: 600, color: color, height: 1.2),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The dot in front of the "updated" stamp: pulsing green when live, still amber when not.
class LiveDot extends StatefulWidget {
  const LiveDot({super.key, required this.live});

  final bool live;

  @override
  State<LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(LiveDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    final animate = widget.live && !reducedMotion(context);
    if (animate && !_pulse.isAnimating) {
      _pulse.repeat();
    } else if (!animate && _pulse.isAnimating) {
      _pulse.stop();
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.live ? Bl.up : Bl.warn;
    return SizedBox.square(
      dimension: 7,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, _) => CustomPaint(painter: _DotPainter(color, widget.live && _pulse.isAnimating ? _pulse.value : null)),
      ),
    );
  }
}

class _DotPainter extends CustomPainter {
  const _DotPainter(this.color, this.pulse);

  final Color color;
  final double? pulse;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final t = pulse;
    if (t != null && t < 0.7) {
      final spread = t / 0.7;
      canvas.drawCircle(center, 3.5 + 8 * spread, Paint()..color = color.withValues(alpha: 0.6 * (1 - spread)));
    }
    canvas.drawCircle(center, 3.5, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_DotPainter oldDelegate) => oldDelegate.color != color || oldDelegate.pulse != pulse;
}

/// Entrance: the child rises 14 px while fading in, after `delay`. Skipped with reduced motion.
class Rise extends StatefulWidget {
  const Rise({super.key, required this.child, this.delay = Duration.zero});

  final Widget child;
  final Duration delay;

  @override
  State<Rise> createState() => _RiseState();
}

class _RiseState extends State<Rise> with SingleTickerProviderStateMixin {
  static const Duration _length = Duration(milliseconds: 700);
  late final AnimationController _controller = AnimationController(vsync: this, duration: widget.delay + _length);
  late final Animation<double> _curve = CurvedAnimation(
    parent: _controller,
    curve: Interval(widget.delay.inMilliseconds / (widget.delay + _length).inMilliseconds, 1, curve: const Cubic(0.2, 0.7, 0.2, 1)),
  );
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
    return AnimatedBuilder(
      animation: _curve,
      child: widget.child,
      builder: (context, child) {
        final t = _curve.value;
        if (t >= 1) return child!;
        return Opacity(
          opacity: 0.2 + 0.8 * t,
          child: Transform.translate(offset: Offset(0, 14 * (1 - t)), child: child),
        );
      },
    );
  }
}

/// A pressable area with a quiet highlight; at least 44 px tall for touch.
class Pressable extends StatefulWidget {
  const Pressable({super.key, required this.onTap, required this.child, this.semanticLabel, this.selected, this.minHeight = 44});

  final VoidCallback? onTap;
  final Widget child;
  final String? semanticLabel;
  final bool? selected;
  final double minHeight;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  bool _down = false;

  void _set(bool value) {
    if (_down != value && mounted) setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: widget.onTap != null,
      label: widget.semanticLabel,
      selected: widget.selected,
      excludeSemantics: widget.semanticLabel != null,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        onTapDown: widget.onTap == null ? null : (_) => _set(true),
        onTapUp: (_) => _set(false),
        onTapCancel: () => _set(false),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: widget.minHeight),
          child: AnimatedOpacity(opacity: _down ? 0.55 : 1, duration: const Duration(milliseconds: 90), child: widget.child),
        ),
      ),
    );
  }
}

/// The segmented control of the site (`.seg`, `.ranges`): mono caps in a hairline box.
class Segmented<T> extends StatelessWidget {
  const Segmented({
    super.key,
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onChanged,
    this.semanticLabel,
    this.expand = true,
  });

  final List<T> values;
  final T selected;
  final String Function(T value) labelOf;
  final ValueChanged<T> onChanged;
  final String? semanticLabel;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final cells = <Widget>[];
    for (var i = 0; i < values.length; i++) {
      final value = values[i];
      final active = value == selected;
      final cell = Pressable(
        onTap: () => onChanged(value),
        selected: active,
        semanticLabel: labelOf(value),
        minHeight: 40,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: active ? Bl.brand.withValues(alpha: 0.22) : null,
            border: Border(
              left: i == 0 ? BorderSide.none : const BorderSide(color: Bl.line),
              bottom: BorderSide(color: active ? Bl.brand : const Color(0x00000000), width: 2),
            ),
          ),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Text(
                labelOf(value).toUpperCase(),
                maxLines: 1,
                style: mono(11.5, weight: active ? 600 : 500, color: active ? Bl.text : Bl.dim, tracking: 0.1, height: 1),
              ),
            ),
          ),
        ),
      );
      cells.add(expand ? Expanded(child: cell) : cell);
    }
    return Semantics(
      container: true,
      label: semanticLabel,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: Bl.lineStrong),
          borderRadius: BorderRadius.circular(2),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(1),
          child: Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, children: cells),
        ),
      ),
    );
  }
}

/// The site footer's outlined wordmark, running off the edge: the last thing on a screen.
class Wordmark extends StatelessWidget {
  const Wordmark({super.key});

  @override
  Widget build(BuildContext context) {
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = Bl.lineStrong;
    return ExcludeSemantics(
      child: SizedBox(
        height: 92,
        child: OverflowBox(
          alignment: Alignment.centerLeft,
          maxWidth: double.infinity,
          child: Padding(
            padding: const EdgeInsets.only(left: Bl.gutter),
            child: Text(
              'bluelytics',
              maxLines: 1,
              softWrap: false,
              textScaler: TextScaler.noScaling,
              style: sans(104, weight: 800, tracking: -0.025, height: 1).copyWith(color: null, foreground: stroke),
            ),
          ),
        ),
      ),
    );
  }
}
