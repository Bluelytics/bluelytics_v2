/// The one dark palette of the social cards' "Editorial Bold" (packages/social/design/final/card.mjs
/// TOKENS), as on the website (apps/web/src/styles/global.css `:root`).
library;

import 'package:flutter/painting.dart';

abstract final class Bl {
  static const Color ink = Color(0xFF040A14);
  static const Color navy = Color(0xFF06203D);
  static const Color surface = Color(0xFF061325);
  static const Color surface2 = Color(0xFF0A1C34);

  /// Hairlines: brand-ink at 13 % and 30 %.
  static const Color line = Color(0x217DBEFF);
  static const Color lineStrong = Color(0x4D7DBEFF);

  static const Color text = Color(0xFFF4F8FC);
  static const Color soft = Color(0xFFC3D6EA);
  static const Color muted = Color(0xFFA9BDD3);
  static const Color dim = Color(0xFF93A9C2);

  static const Color brand = Color(0xFF1C7FD6);
  static const Color brandDeep = Color(0xFF0069AC);
  static const Color brandInk = Color(0xFF7DBEFF);

  static const Color up = Color(0xFF2FD67B);
  static const Color down = Color(0xFFFF5D5D);
  static const Color warn = Color(0xFFFBBF24);
  static const Color upBg = Color(0x242FD67B);
  static const Color downBg = Color(0x24FF5D5D);
  static const Color flatBg = Color(0x1AC3D6EA);

  static const Color lineBlue = Color(0xFF4BA3F0);
  static const Color lineOficial = Color(0xFF5CC46E);
  static const Color lineGap = Color(0xFFFBBF24);

  static const double radius = 4;

  /// Side gutter of every screen, and the widest a column of content gets on tablets.
  static const double gutter = 16;
  static const double maxWidth = 620;
}
