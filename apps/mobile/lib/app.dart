/// The app: theme, language, the masthead, the four tabs and the refresh loop.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/settings.dart';
import 'data/store.dart';
import 'domain/series.dart';
import 'i18n/strings.dart';
import 'push/alerts.dart';
import 'scope.dart';
import 'screens/alerts_screen.dart';
import 'screens/calculator_screen.dart';
import 'screens/history_screen.dart';
import 'screens/today_screen.dart';
import 'theme/tokens.dart';
import 'theme/type.dart';
import 'widgets/glyphs.dart';
import 'widgets/primitives.dart';

class BluelyticsApp extends StatelessWidget {
  const BluelyticsApp({super.key, required this.store, required this.settings, required this.alerts});

  final AppStore store;
  final Settings settings;
  final AlertsController alerts;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: settings,
      builder: (context, _) {
        return MaterialApp(
          title: 'Bluelytics',
          debugShowCheckedModeBanner: false,
          locale: Locale(settings.locale.name),
          supportedLocales: const [Locale('es'), Locale('en')],
          localizationsDelegates: GlobalMaterialLocalizations.delegates,
          theme: ThemeData(
            useMaterial3: true,
            brightness: Brightness.dark,
            fontFamily: 'Geist',
            scaffoldBackgroundColor: Bl.ink,
            colorScheme: const ColorScheme.dark(
              primary: Bl.brand,
              onPrimary: Bl.text,
              secondary: Bl.brandInk,
              surface: Bl.surface,
              onSurface: Bl.text,
              error: Bl.down,
            ),
            splashFactory: NoSplash.splashFactory,
            highlightColor: Colors.transparent,
            textSelectionTheme: TextSelectionThemeData(
              cursorColor: Bl.brandInk,
              selectionColor: Bl.brand.withValues(alpha: 0.45),
              selectionHandleColor: Bl.brandInk,
            ),
          ),
          builder: (context, child) {
            // Large system text is honoured up to a point the big figures can still take.
            return MediaQuery.withClampedTextScaling(
              maxScaleFactor: 1.3,
              child: AppScope(store: store, settings: settings, alerts: alerts, locale: settings.locale, child: child!),
            );
          },
          home: const AppShell(),
        );
      },
    );
  }
}

enum _Tab { today, history, calculator, alerts }

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  /// How often the live quotes are asked for while the app is on screen.
  static const Duration pollEvery = Duration(seconds: 60);

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> with WidgetsBindingObserver {
  _Tab _tab = _Tab.today;
  ChartMode _historyMode = ChartMode.rates;
  Timer? _poll;
  Timer? _bannerTimer;
  StreamSubscription<AlertMessage>? _messages;
  AlertMessage? _banner;
  AppStore? _store;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final scope = AppScope.of(context);
    if (_store == scope.store) return;
    _store = scope.store;
    _messages?.cancel();
    _messages = scope.alerts.messages.listen(_onMessage);
    _startPolling();
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(AppShell.pollEvery, (_) => _store?.refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _store?.refresh();
      _startPolling();
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _poll?.cancel();
      _poll = null;
    }
  }

  /// An alert arrived while the app is open: show it and fetch the price it talks about.
  void _onMessage(AlertMessage message) {
    _store?.refresh(force: true);
    _bannerTimer?.cancel();
    setState(() => _banner = message);
    _bannerTimer = Timer(const Duration(seconds: 8), () {
      if (mounted) setState(() => _banner = null);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _bannerTimer?.cancel();
    _messages?.cancel();
    super.dispose();
  }

  void _select(_Tab tab) {
    if (tab == _tab) return;
    HapticFeedback.selectionClick();
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _tab = tab);
  }

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final strings = scope.strings;
    final screens = <_Tab, Widget>{
      _Tab.today: TodayScreen(
        onOpenHistory: (mode) => setState(() {
          _historyMode = mode;
          _tab = _Tab.history;
        }),
      ),
      _Tab.history: HistoryScreen(mode: _historyMode, onModeChanged: (mode) => setState(() => _historyMode = mode)),
      _Tab.calculator: const CalculatorScreen(),
      _Tab.alerts: const AlertsScreen(),
    };
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
        systemNavigationBarColor: Bl.ink,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: Bl.ink,
        // The keyboard covers the tab bar instead of pushing it up: the amount field sits at the top.
        resizeToAvoidBottomInset: false,
        body: BlBackground(
          child: SafeArea(
            bottom: false,
            child: Column(
              children: [
                _Masthead(strings: strings, onToggleLanguage: scope.settings.toggleLocale),
                Expanded(
                  child: Stack(
                    children: [
                      IndexedStack(
                        index: _tab.index,
                        sizing: StackFit.expand,
                        children: [
                          // Hidden tabs keep their state but stop their animations.
                          for (final tab in _Tab.values) TickerMode(enabled: tab == _tab, child: screens[tab]!),
                        ],
                      ),
                      if (_banner != null)
                        Positioned(
                          left: 0,
                          right: 0,
                          top: 0,
                          child: _Banner(message: _banner!, onClose: () => setState(() => _banner = null), closeLabel: strings.close),
                        ),
                    ],
                  ),
                ),
                _TabBar(selected: _tab, strings: strings, onSelect: _select),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Masthead extends StatelessWidget {
  const _Masthead({required this.strings, required this.onToggleLanguage});

  final Strings strings;
  final VoidCallback onToggleLanguage;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Bl.ink.withValues(alpha: 0.82),
        border: const Border(bottom: BorderSide(color: Bl.line)),
      ),
      child: ContentWidth(
        child: SizedBox(
          height: 52,
          child: Row(
            children: [
              Semantics(
                header: true,
                label: 'Bluelytics',
                child: ExcludeSemantics(
                  child: Row(
                    children: [
                      Image.asset('assets/brand/mark.png', width: 28, height: 28, filterQuality: FilterQuality.medium),
                      const SizedBox(width: 9),
                      Text('bluelytics', style: sans(18.5, weight: 800, tracking: -0.045, height: 1)),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              Pressable(
                onTap: onToggleLanguage,
                semanticLabel: strings.switchLanguage,
                child: Center(
                  widthFactor: 1,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border.all(color: Bl.lineStrong),
                      borderRadius: BorderRadius.circular(2),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      child: Text(strings.otherLanguageCode, style: mono(12, weight: 500, color: Bl.soft, tracking: 0.12, height: 1)),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabBar extends StatelessWidget {
  const _TabBar({required this.selected, required this.strings, required this.onSelect});

  final _Tab selected;
  final Strings strings;
  final ValueChanged<_Tab> onSelect;

  @override
  Widget build(BuildContext context) {
    final entries = [
      (_Tab.today, Glyph.today, strings.tabToday),
      (_Tab.history, Glyph.history, strings.tabHistory),
      (_Tab.calculator, Glyph.calculator, strings.tabCalculator),
      (_Tab.alerts, Glyph.bell, strings.tabAlerts),
    ];
    return Semantics(
      container: true,
      label: strings.sections,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Bl.ink.withValues(alpha: 0.94),
          border: const Border(top: BorderSide(color: Bl.line)),
        ),
        child: SafeArea(
          top: false,
          child: ContentWidth(
            padded: false,
            child: Row(
              children: [
                for (final (tab, glyph, label) in entries)
                  Expanded(
                    child: Pressable(
                      onTap: () => onSelect(tab),
                      selected: tab == selected,
                      semanticLabel: label,
                      minHeight: 58,
                      child: _TabCell(glyph: glyph, label: label, active: tab == selected),
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

class _TabCell extends StatelessWidget {
  const _TabCell({required this.glyph, required this.label, required this.active});

  final Glyph glyph;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // The site's underline for the current page, here on the top edge.
        AnimatedContainer(
          duration: Duration(milliseconds: reducedMotion(context) ? 0 : 180),
          height: 2,
          width: active ? 34 : 0,
          color: Bl.brand,
        ),
        const SizedBox(height: 9),
        GlyphIcon(glyph, size: 21, color: active ? Bl.brandInk : Bl.dim, stroke: active ? 1.8 : 1.5),
        const SizedBox(height: 6),
        Text(
          label.toUpperCase(),
          maxLines: 1,
          style: mono(10, weight: active ? 600 : 500, color: active ? Bl.text : Bl.dim, tracking: 0.1, height: 1),
        ),
        const SizedBox(height: 9),
      ],
    );
  }
}

/// An alert that arrived while the app is open.
class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.onClose, required this.closeLabel});

  final AlertMessage message;
  final VoidCallback onClose;
  final String closeLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: Bl.surface2,
          border: Border(bottom: BorderSide(color: Bl.brand, width: 2)),
        ),
        child: ContentWidth(
          child: Row(
            children: [
              const GlyphIcon(Glyph.bell, size: 18, color: Bl.brandInk),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (message.title.isNotEmpty) Text(message.title, style: sans(15, weight: 700, height: 1.25)),
                      if (message.body.isNotEmpty) Text(message.body, style: mono(12.5, weight: 500, color: Bl.soft, height: 1.35)),
                    ],
                  ),
                ),
              ),
              Pressable(
                onTap: onClose,
                semanticLabel: closeLabel,
                child: const Padding(
                  padding: EdgeInsets.all(12),
                  child: GlyphIcon(Glyph.close, size: 18, color: Bl.soft),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
