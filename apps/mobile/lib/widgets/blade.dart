/// The brand blade of the social cards (packages/social/design/final/card.mjs) and of the site's hero
/// (apps/web/src/lib/blade.ts): a tapered ribbon along a cubic Bézier plus a thin sliver in the
/// direction colour. Built in a fixed 1200×640 box and scaled to cover the hero, anchored right.
library;

import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import '../domain/series.dart';
import '../theme/tokens.dart';

const double _w = 1200;
const double _h = 640;
const double _extend = 600;

typedef _Point = (double x, double y);

double _lerp(double a, double b, double t) => a + (b - a) * t;

/// Centre line: up is a growth curve, down an inverted one, flat a long shallow sweep.
List<_Point> _curve(Direction direction) {
  if (direction == Direction.down) {
    const p0 = (0.42 * _w, -80.0);
    const p3 = (_w + 80, 0.78 * _h);
    return [p0, (_lerp(p0.$1, p3.$1, 0.12), _lerp(p0.$2, p3.$2, 0.7)), (_lerp(p0.$1, p3.$1, 0.55), p3.$2), p3];
  }
  final p0 = (-80.0, (direction == Direction.up ? 0.92 : 0.7) * _h);
  final p3 = direction == Direction.up ? (0.98 * _w, -80.0) : (_w + 80, 0.12 * _h);
  return [p0, (_lerp(p0.$1, p3.$1, 0.4), p0.$2), (_lerp(p0.$1, p3.$1, 0.75), _lerp(p0.$2, p3.$2, 0.3)), p3];
}

/// Point and unit normal of the curve at `t`.
(double x, double y, double nx, double ny) _bez(List<_Point> p, double t) {
  final u = 1 - t;
  final b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  final d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
  final dx = d0 * (p[1].$1 - p[0].$1) + d1 * (p[2].$1 - p[1].$1) + d2 * (p[3].$1 - p[2].$1);
  final dy = d0 * (p[1].$2 - p[0].$2) + d1 * (p[2].$2 - p[1].$2) + d2 * (p[3].$2 - p[2].$2);
  final len = math.max(math.sqrt(dx * dx + dy * dy), 1e-9);
  return (b0 * p[0].$1 + b1 * p[1].$1 + b2 * p[2].$1 + b3 * p[3].$1, b0 * p[0].$2 + b1 * p[1].$2 + b2 * p[2].$2 + b3 * p[3].$2, dy / len, -dx / len);
}

Path _closed(List<_Point> top, List<_Point> bottom) {
  final path = Path()..moveTo(top.first.$1, top.first.$2);
  for (final point in top.skip(1)) {
    path.lineTo(point.$1, point.$2);
  }
  for (final point in bottom.reversed) {
    path.lineTo(point.$1, point.$2);
  }
  return path..close();
}

/// The band and the sliver, in the 1200×640 box.
({Path band, Path sliver}) bladeShape(Direction direction, {double width = 260, int n = 64}) {
  final p = _curve(direction);
  final sliverWidth = width * 0.06;
  final top = <_Point>[], bottom = <_Point>[], sTop = <_Point>[], sBottom = <_Point>[];
  var last = (0.0, 0.0, 0.0, 1.0);
  for (var i = 0; i <= n; i++) {
    final t = i / n;
    last = _bez(p, t);
    final (x, y, nx, ny) = last;
    final half = (width / 2) * math.pow(t, 0.9);
    final gap = width * 0.06 * math.pow(t, 0.6);
    final sliver = sliverWidth * math.pow(t, 1.1);
    top.add((x + nx * half, y + ny * half));
    bottom.add((x - nx * half, y - ny * half));
    sTop.add((x + nx * (half + gap + sliver), y + ny * (half + gap + sliver)));
    sBottom.add((x + nx * (half + gap), y + ny * (half + gap)));
  }
  // Run both shapes on past the box along the end tangent, so they never end inside the hero.
  final tx = -last.$4 * _extend, ty = last.$3 * _extend;
  for (final side in [top, bottom, sTop, sBottom]) {
    side.add((side.last.$1 + tx, side.last.$2 + ty));
  }
  return (band: _closed(top, bottom), sliver: _closed(sTop, sBottom));
}

class BladePainter extends CustomPainter {
  BladePainter({required this.direction, this.progress = 1}) : _shape = bladeShape(direction);

  final Direction direction;

  /// 0 → 1: the entrance sweep (fade in while sliding 6 % from the left).
  final double progress;
  final ({Path band, Path sliver}) _shape;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || progress <= 0) return;
    // SVG `preserveAspectRatio="xMaxYMid slice"`: cover, anchored to the right edge.
    final scale = math.max(size.width / _w, size.height / _h);
    final dx = size.width - _w * scale - (1 - progress) * 0.06 * size.width;
    final dy = (size.height - _h * scale) / 2;
    final alpha = 0.8 * progress;

    canvas.save();
    canvas.clipRect(Offset.zero & size);
    canvas.translate(dx, dy);
    canvas.scale(scale);
    final bounds = _shape.band.getBounds();
    final band = Paint()
      ..isAntiAlias = true
      ..shader = ui.Gradient.linear(
        bounds.bottomLeft,
        bounds.topRight,
        [Bl.brandDeep.withValues(alpha: 0), const Color(0xFF005E9D).withValues(alpha: 0.85 * alpha), Bl.brand.withValues(alpha: alpha)],
        const [0, 0.35, 1],
      );
    canvas.drawPath(_shape.band, band);
    final sliverColor = switch (direction) {
      Direction.up => Bl.up,
      Direction.down => Bl.down,
      Direction.flat => Bl.brandInk,
    };
    canvas.drawPath(_shape.sliver, Paint()..color = sliverColor.withValues(alpha: alpha));
    canvas.restore();
  }

  @override
  bool shouldRepaint(BladePainter oldDelegate) => oldDelegate.direction != direction || oldDelegate.progress != progress;
}
