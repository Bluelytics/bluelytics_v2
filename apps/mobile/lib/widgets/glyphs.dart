/// Every icon in the app, drawn as strokes in a 24×24 box: no icon font ships with the app, and the
/// line weight matches the hairline look of the rest of the interface.
library;

import 'package:flutter/widgets.dart';

import '../domain/series.dart';

enum Glyph { today, history, calculator, bell, swap, chevronDown, arrowRight, external, check, search, close, refresh }

class GlyphIcon extends StatelessWidget {
  const GlyphIcon(this.glyph, {super.key, this.size = 22, required this.color, this.stroke = 1.6});

  final Glyph glyph;
  final double size;
  final Color color;
  final double stroke;

  @override
  Widget build(BuildContext context) {
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _GlyphPainter(glyph, color, stroke)),
    );
  }
}

class _GlyphPainter extends CustomPainter {
  const _GlyphPainter(this.glyph, this.color, this.stroke);

  final Glyph glyph;
  final Color color;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 24, size.height / 24);
    final line = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke * 24 / size.width
      ..strokeCap = StrokeCap.square
      ..strokeJoin = StrokeJoin.miter;
    final fill = Paint()..color = color;
    Path poly(List<double> xy, {bool close = false}) {
      final path = Path()..moveTo(xy[0], xy[1]);
      for (var i = 2; i < xy.length; i += 2) {
        path.lineTo(xy[i], xy[i + 1]);
      }
      if (close) path.close();
      return path;
    }

    switch (glyph) {
      case Glyph.today:
        // The blade: a rising stroke with its sliver.
        canvas.drawPath(poly([3, 19, 9, 13, 13, 16, 21, 5]), line);
        canvas.drawPath(poly([15.5, 5, 21, 5, 21, 10.5]), line);
      case Glyph.history:
        canvas.drawPath(poly([4, 4, 4, 20, 20, 20]), line);
        canvas.drawPath(poly([7.5, 15.5, 11, 11.5, 14, 13.5, 19, 7]), line);
      case Glyph.calculator:
        canvas.drawRect(const Rect.fromLTWH(5, 3.5, 14, 17), line);
        canvas.drawPath(poly([8.5, 8, 15.5, 8]), line);
        for (final y in const [12.5, 16.5]) {
          for (final x in const [8.75, 12.0, 15.25]) {
            canvas.drawRect(Rect.fromCenter(center: Offset(x, y), width: 1.5, height: 1.5), fill);
          }
        }
      case Glyph.bell:
        final bell = Path()
          ..moveTo(5, 17)
          ..lineTo(7, 14.5)
          ..lineTo(7, 10.5)
          ..cubicTo(7, 7.2, 9.2, 5, 12, 5)
          ..cubicTo(14.8, 5, 17, 7.2, 17, 10.5)
          ..lineTo(17, 14.5)
          ..lineTo(19, 17)
          ..close();
        canvas.drawPath(bell, line);
        canvas.drawPath(poly([10.2, 20, 13.8, 20]), line);
        canvas.drawPath(poly([12, 3, 12, 5]), line);
      case Glyph.swap:
        canvas.drawPath(poly([8, 20, 8, 5]), line);
        canvas.drawPath(poly([4.5, 8.5, 8, 5, 11.5, 8.5]), line);
        canvas.drawPath(poly([16, 4, 16, 19]), line);
        canvas.drawPath(poly([12.5, 15.5, 16, 19, 19.5, 15.5]), line);
      case Glyph.chevronDown:
        canvas.drawPath(poly([6, 9.5, 12, 15.5, 18, 9.5]), line);
      case Glyph.arrowRight:
        canvas.drawPath(poly([4, 12, 19, 12]), line);
        canvas.drawPath(poly([13.5, 6.5, 19, 12, 13.5, 17.5]), line);
      case Glyph.external:
        canvas.drawPath(poly([7, 17, 17, 7]), line);
        canvas.drawPath(poly([9.5, 7, 17, 7, 17, 14.5]), line);
      case Glyph.check:
        canvas.drawPath(poly([5, 12.5, 10, 17.5, 19, 7]), line);
      case Glyph.search:
        canvas.drawCircle(const Offset(10.5, 10.5), 5.5, line);
        canvas.drawPath(poly([15, 15, 20, 20]), line);
      case Glyph.close:
        canvas.drawPath(poly([6, 6, 18, 18]), line);
        canvas.drawPath(poly([18, 6, 6, 18]), line);
      case Glyph.refresh:
        final arc = Path()..addArc(const Rect.fromLTWH(5, 5, 14, 14), -0.6, 5.0);
        canvas.drawPath(arc, line);
        canvas.drawPath(poly([14.5, 4.5, 18.6, 7.2, 15.6, 11]), line);
    }
  }

  @override
  bool shouldRepaint(_GlyphPainter oldDelegate) => oldDelegate.glyph != glyph || oldDelegate.color != color || oldDelegate.stroke != stroke;
}

/// The up/down triangle that goes with every move, so colour is never the only cue.
class DirectionMark extends StatelessWidget {
  const DirectionMark(this.direction, {super.key, this.size = 10, required this.color});

  final Direction direction;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (direction == Direction.flat) return const SizedBox.shrink();
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(painter: _TrianglePainter(direction == Direction.up, color)),
    );
  }
}

class _TrianglePainter extends CustomPainter {
  const _TrianglePainter(this.up, this.color);

  final bool up;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width, h = size.height;
    final path = up
        ? (Path()
            ..moveTo(w / 2, h * 0.1)
            ..lineTo(w * 0.95, h * 0.9)
            ..lineTo(w * 0.05, h * 0.9))
        : (Path()
            ..moveTo(w / 2, h * 0.9)
            ..lineTo(w * 0.05, h * 0.1)
            ..lineTo(w * 0.95, h * 0.1));
    canvas.drawPath(path..close(), Paint()..color = color);
  }

  @override
  bool shouldRepaint(_TrianglePainter oldDelegate) => oldDelegate.up != up || oldDelegate.color != color;
}
