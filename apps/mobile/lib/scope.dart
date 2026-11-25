/// Hands the app's three long-lived objects to every screen.
library;

import 'package:flutter/widgets.dart';

import 'data/settings.dart';
import 'data/store.dart';
import 'domain/format.dart';
import 'i18n/strings.dart';
import 'push/alerts.dart';

class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.store, required this.settings, required this.alerts, required this.locale, required super.child});

  final AppStore store;
  final Settings settings;
  final AlertsController alerts;

  /// The language on screen; a change rebuilds everything below.
  final AppLocale locale;

  Strings get strings => Strings.of(locale);

  static AppScope of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!;

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      oldWidget.locale != locale || oldWidget.store != store || oldWidget.settings != settings || oldWidget.alerts != alerts;
}
