/// Line chart of the daily series: blue and official sell, or the gap between them. Drag sideways
/// (or press and hold) to read any day; the line above the plot is both legend and readout.
library;

import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import '../domain/format.dart';
import '../domain/models.dart';
import '../domain/series.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';

Color lineColor(LineKey key) => switch (key) {
  LineKey.blue => Bl.lineBlue,
  LineKey.oficial => Bl.lineOficial,
  LineKey.gap => Bl.lineGap,
};

/// At most this many vertices per drawn line; the readout still reads every day.
const int _maxVertices = 480;

class RateChart extends StatefulWidget {
  const RateChart({
    super.key,
    required this.days,
    required this.mode,
    required this.locale,
    required this.lineNames,
    required this.emptyText,
    this.height = 220,
    this.xTickCount = 4,
  });

  /// Oldest first.
  final List<DayRates> days;
  final ChartMode mode;
  final AppLocale locale;

  /// Legend text of each line.
  final Map<LineKey, String> lineNames;
  final String emptyText;
  final double height;
  final int xTickCount;

  @override
  State<RateChart> createState() => _RateChartState();
}

class _RateChartState extends State<RateChart> {
  late ChartModel _model = _build();
  int? _scrub;
  Timer? _release;

  ChartModel _build() => buildChart(widget.days, widget.mode, widget.locale, xTickCount: widget.xTickCount);

  @override
  void didUpdateWidget(RateChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.days, widget.days) ||
        oldWidget.mode != widget.mode ||
        oldWidget.locale != widget.locale ||
        oldWidget.xTickCount != widget.xTickCount) {
      _model = _build();
      _release?.cancel();
      _scrub = null;
    }
  }

  @override
  void dispose() {
    _release?.cancel();
    super.dispose();
  }

  void _scrubTo(double x, double width) {
    final count = _model.days.length;
    if (count == 0 || width <= 0) return;
    final index = count == 1 ? 0 : ((x / width) * (count - 1)).round().clamp(0, count - 1);
    _release?.cancel();
    if (index == _scrub) return;
    HapticFeedback.selectionClick();
    setState(() => _scrub = index);
  }

  /// The reading stays a moment after the finger lifts, then the chart goes back to the last day.
  void _letGo() {
    _release?.cancel();
    _release = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _scrub = null);
    });
  }

  /// The day the readout shows: the scrubbed one, else the last with any value.
  int? get _shown {
    if (_scrub != null) return _scrub;
    for (var i = _model.days.length - 1; i >= 0; i--) {
      if (_model.lines.any((line) => line.values[i] != null)) return i;
    }
    return null;
  }

  String _valueText(double value) {
    if (_model.mode == ChartMode.gap) return formatPercent(value / 100, widget.locale);
    return formatPesos((value * 100).round(), widget.locale);
  }

  @override
  Widget build(BuildContext context) {
    final model = _model;
    if (model.isEmpty) {
      return SizedBox(
        height: widget.height,
        child: Center(child: Text(widget.emptyText, style: BlType.small())),
      );
    }
    final shown = _shown;
    final day = shown == null ? null : model.days[shown];
    final entries = [for (final line in model.lines) (line.key, widget.lineNames[line.key] ?? line.key.name, shown == null ? null : line.values[shown])];
    final spoken = [
      if (day != null) formatDay(day, widget.locale),
      for (final (_, name, value) in entries)
        if (value != null) '$name ${_valueText(value)}',
    ].join(', ');

    return Semantics(
      container: true,
      image: true,
      label: spoken,
      child: ExcludeSemantics(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 14,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (day != null)
                  Text(formatDay(day, widget.locale, short: true), style: mono(12.5, weight: 500, color: _scrub == null ? Bl.dim : Bl.text, height: 1.4)),
                for (final (key, name, value) in entries)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(width: 10, height: 3, child: ColoredBox(color: lineColor(key))),
                      const SizedBox(width: 6),
                      Text(name, style: mono(12.5, weight: 500, color: lineColor(key), height: 1.4)),
                      const SizedBox(width: 6),
                      Text(value == null ? '–' : _valueText(value), style: mono(12.5, weight: 600, color: Bl.text, height: 1.4)),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 8),
            LayoutBuilder(
              builder: (context, constraints) {
                final width = constraints.maxWidth;
                return GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTapDown: (details) => _scrubTo(details.localPosition.dx, width),
                  onTapUp: (_) => _letGo(),
                  onTapCancel: _letGo,
                  onHorizontalDragStart: (details) => _scrubTo(details.localPosition.dx, width),
                  onHorizontalDragUpdate: (details) => _scrubTo(details.localPosition.dx, width),
                  onHorizontalDragEnd: (_) => _letGo(),
                  onHorizontalDragCancel: _letGo,
                  onLongPressStart: (details) => _scrubTo(details.localPosition.dx, width),
                  onLongPressMoveUpdate: (details) => _scrubTo(details.localPosition.dx, width),
                  onLongPressEnd: (_) => _letGo(),
                  child: RepaintBoundary(
                    child: CustomPaint(size: Size(width, widget.height), painter: _ChartPainter(model, _scrub)),
                  ),
                );
              },
            ),
            SizedBox(
              height: 26,
              child: Stack(
                children: [
                  for (final tick in model.xTicks)
                    Align(
                      alignment: Alignment(tick.pos * 2 - 1, 0),
                      child: Text(tick.label, style: mono(10.5, weight: 500, color: Bl.dim, height: 1)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(this.model, this.scrub);

  final ChartModel model;
  final int? scrub;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final grid = Paint()
      ..color = Bl.line
      ..strokeWidth = 1;
    for (final tick in model.yTicks) {
      final y = (tick.pos * h).roundToDouble() + 0.5;
      canvas.drawLine(Offset(0, y), Offset(w, y), grid);
    }

    final count = model.days.length;
    final stride = (count / _maxVertices).ceil().clamp(1, count);
    for (final line in model.lines) {
      final color = lineColor(line.key);
      final path = Path();
      Offset? first, last;
      var pen = false;
      for (var i = 0; i < count; i++) {
        // Every `stride`-th day, and always the last one so the line ends on today.
        if (i % stride != 0 && i != count - 1) continue;
        final value = line.values[i];
        if (value == null) {
          pen = false;
          continue;
        }
        final point = Offset(model.xPos(i) * w, model.yPos(value) * h);
        if (pen) {
          path.lineTo(point.dx, point.dy);
        } else {
          path.moveTo(point.dx, point.dy);
          pen = true;
        }
        first ??= point;
        last = point;
      }
      if (first == null || last == null) continue;

      // The leading line (blue, or the gap) sits on a soft wash down to the axis.
      if (line.key != LineKey.oficial && first != last) {
        final area = Path.from(path)
          ..lineTo(last.dx, h)
          ..lineTo(first.dx, h)
          ..close();
        canvas.drawPath(area, Paint()..shader = ui.Gradient.linear(Offset.zero, Offset(0, h), [color.withValues(alpha: 0.2), color.withValues(alpha: 0)]));
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round,
      );
      if (scrub == null) canvas.drawCircle(last, 3, Paint()..color = color);
    }

    // Axis labels go over the lines, on a patch of the background so both stay readable.
    for (final tick in model.yTicks) {
      final y = (tick.pos * h).roundToDouble() + 0.5;
      final label = TextPainter(
        text: TextSpan(
          text: tick.label,
          style: mono(10.5, weight: 500, color: Bl.dim, height: 1),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      final at = Offset(0, y - label.height - 4);
      canvas.drawRect(Rect.fromLTWH(at.dx - 2, at.dy - 2, label.width + 8, label.height + 4), Paint()..color = Bl.ink.withValues(alpha: 0.72));
      label.paint(canvas, at);
    }

    final index = scrub;
    if (index != null && index < count) {
      final x = model.xPos(index) * w;
      canvas.drawLine(Offset(x, 0), Offset(x, h), Paint()..color = Bl.lineStrong);
      for (final line in model.lines) {
        final value = line.values[index];
        if (value == null) continue;
        final point = Offset(x, model.yPos(value) * h);
        canvas.drawCircle(point, 5.5, Paint()..color = Bl.ink);
        canvas.drawCircle(point, 3.5, Paint()..color = lineColor(line.key));
      }
    }
  }

  @override
  bool shouldRepaint(_ChartPainter oldDelegate) => !identical(oldDelegate.model, model) || oldDelegate.scrub != scrub;
}
