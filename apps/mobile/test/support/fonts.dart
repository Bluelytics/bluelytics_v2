import 'dart:io';

import 'package:flutter/services.dart';

/// Registers the app's fonts with the test engine, which otherwise draws every glyph as a box.
Future<void> loadAppFonts() async {
  for (final (family, file) in const [('Geist', 'Geist-Variable.ttf'), ('GeistMono', 'GeistMono-Variable.ttf')]) {
    final bytes = File('assets/fonts/$file').readAsBytesSync();
    final loader = FontLoader(family)..addFont(Future.value(ByteData.sublistView(bytes)));
    await loader.load();
  }
}
