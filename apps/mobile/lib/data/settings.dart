/// What the person chose and the app must remember.
library;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/format.dart';

class Settings extends ChangeNotifier {
  /// `deviceLocale` applies until a language is chosen: Spanish on a Spanish-language device,
  /// English everywhere else.
  Settings({required this.prefs, required AppLocale deviceLocale}) : locale = AppLocale.values.asNameMap()[prefs.getString(_localeKey)] ?? deviceLocale;

  static const String _localeKey = 'locale';

  final SharedPreferences prefs;

  AppLocale locale;

  Future<void> setLocale(AppLocale value) async {
    if (value == locale) return;
    locale = value;
    notifyListeners();
    await prefs.setString(_localeKey, value.name);
  }

  Future<void> toggleLocale() => setLocale(locale == AppLocale.es ? AppLocale.en : AppLocale.es);
}
