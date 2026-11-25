/// Geist for text and figures, Geist Mono for labels and tabular numbers. Both are variable fonts:
/// the weight is set on the `wght` axis, so any value from 100 to 900 is a real cut.
library;

import 'package:flutter/painting.dart';

import 'tokens.dart';

const String _sansFamily = 'Geist';
const String _monoFamily = 'GeistMono';

/// `tracking` is in em (CSS `letter-spacing: -0.04em`), `height` a line-height multiple.
TextStyle _style(String family, double size, double weight, Color color, double tracking, double? height, bool tabular) {
  return TextStyle(
    fontFamily: family,
    fontSize: size,
    // The axis carries the weight; `fontWeight` stays at the file's own (400) so the engine never
    // adds synthetic bold on top.
    fontWeight: FontWeight.w400,
    fontVariations: [FontVariation('wght', weight)],
    fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null,
    color: color,
    letterSpacing: tracking * size,
    height: height,
    leadingDistribution: TextLeadingDistribution.even,
    decoration: TextDecoration.none,
  );
}

/// Geist.
TextStyle sans(double size, {double weight = 400, Color color = Bl.text, double tracking = 0, double? height, bool tabular = false}) {
  return _style(_sansFamily, size, weight, color, tracking, height, tabular);
}

/// Geist Mono (digits are tabular by design).
TextStyle mono(double size, {double weight = 500, Color color = Bl.text, double tracking = 0, double? height}) {
  return _style(_monoFamily, size, weight, color, tracking, height, false);
}

abstract final class BlType {
  /// The small uppercase mono label over every figure. Write the text in upper case.
  static TextStyle label({Color color = Bl.dim}) => mono(11, weight: 500, color: color, tracking: 0.14, height: 1.3);

  static TextStyle body({Color color = Bl.soft}) => sans(15, color: color, height: 1.5);

  static TextStyle small({Color color = Bl.dim}) => sans(13, color: color, height: 1.45);

  /// Screen titles.
  static TextStyle h1() => sans(34, weight: 800, tracking: -0.05, height: 1.05);

  /// Section titles (with the blade tick, see `SectionHead`).
  static TextStyle h2() => sans(21, weight: 800, tracking: -0.035, height: 1.15);

  /// Mono caption under figures.
  static TextStyle note({Color color = Bl.dim}) => mono(11.5, weight: 500, color: color, tracking: 0.04, height: 1.3);
}
