/// Alerts: the push switch, the last alert sent, and what Bluelytics is.
library;

import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config.dart';
import '../domain/format.dart';
import '../domain/models.dart';
import '../domain/series.dart';
import '../i18n/strings.dart';
import '../push/alerts.dart';
import '../scope.dart';
import '../theme/tokens.dart';
import '../theme/type.dart';
import '../widgets/glyphs.dart';
import '../widgets/primitives.dart';

class AlertsScreen extends StatelessWidget {
  const AlertsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final strings = scope.strings;
    final es = strings.locale == AppLocale.es;
    return ListenableBuilder(
      listenable: Listenable.merge([scope.store, scope.alerts]),
      builder: (context, _) {
        final alert = scope.store.alert;
        return SingleChildScrollView(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ContentWidth(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 24),
                    Semantics(header: true, child: Text(strings.alertsTitle, style: BlType.h1())),
                    const SizedBox(height: 8),
                    Text(strings.alertsLead, style: BlType.body()),
                    const SizedBox(height: 22),
                    _SwitchPanel(alerts: scope.alerts, strings: strings),
                    const SizedBox(height: 36),
                    SectionHead(strings.lastAlert),
                    const SizedBox(height: 14),
                    const Hairline(strong: true),
                    if (alert == null)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        child: Text(strings.noAlertYet, style: BlType.body(color: Bl.dim)),
                      )
                    else
                      _LastAlert(alert: alert, strings: strings),
                    const SizedBox(height: 36),
                    SectionHead(strings.aboutTitle),
                    const SizedBox(height: 12),
                    Text(strings.aboutBody, style: BlType.body()),
                    const SizedBox(height: 16),
                    const Hairline(strong: true),
                    _LinkRow(label: strings.linkSite, detail: 'bluelytics.com.ar', url: es ? Links.site : '${Links.site}/en/'),
                    _LinkRow(label: strings.linkMethod, url: es ? Links.about : Links.aboutEn),
                    _LinkRow(label: strings.linkApi, detail: 'api.bluelytics.com.ar', url: es ? Links.api : Links.apiEn),
                    _LinkRow(label: strings.linkSource, detail: 'GitHub', url: Links.source),
                    _LinkRow(label: strings.linkLicense, url: Links.license),
                    const SizedBox(height: 22),
                    Text(strings.follow.toUpperCase(), style: BlType.label()),
                    const SizedBox(height: 6),
                    const Wrap(
                      spacing: 22,
                      children: [
                        _SocialLink(label: 'X', url: Links.x),
                        _SocialLink(label: 'Instagram', url: Links.instagram),
                        _SocialLink(label: 'LinkedIn', url: Links.linkedin),
                      ],
                    ),
                    const SizedBox(height: 28),
                    Text(strings.disclaimer, style: BlType.small()),
                    const SizedBox(height: 10),
                    Text('${strings.version(appVersion)} · © Bluelytics', style: BlType.note()),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Wordmark(),
            ],
          ),
        );
      },
    );
  }
}

class _SwitchPanel extends StatelessWidget {
  const _SwitchPanel({required this.alerts, required this.strings});

  final AlertsController alerts;
  final Strings strings;

  @override
  Widget build(BuildContext context) {
    final on = alerts.enabled;
    final problem = switch (alerts.problem) {
      AlertsProblem.denied => strings.alertsDenied,
      AlertsProblem.failed => strings.alertsFailed,
      null => null,
    };
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Pressable(
            onTap: alerts.supported && !alerts.busy ? () => alerts.setEnabled(!on) : null,
            minHeight: 48,
            child: Semantics(
              toggled: on,
              enabled: alerts.supported && !alerts.busy,
              label: strings.alertsToggle,
              excludeSemantics: true,
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(strings.alertsToggle, style: sans(17, weight: 700, tracking: -0.02, height: 1.2)),
                        const SizedBox(height: 4),
                        Text((on ? strings.alertsOn : strings.alertsOff).toUpperCase(), style: BlType.label(color: on ? Bl.up : Bl.dim)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Opacity(
                    opacity: alerts.supported ? (alerts.busy ? 0.5 : 1) : 0.35,
                    child: _Switch(on: on),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Hairline(),
          const SizedBox(height: 12),
          Text(alerts.supported ? strings.alertsHelp : strings.alertsUnsupported, style: BlType.small(color: Bl.muted)),
          if (problem != null) ...[
            const SizedBox(height: 10),
            Semantics(
              liveRegion: true,
              child: Text(problem, style: BlType.small(color: Bl.down)),
            ),
          ],
        ],
      ),
    );
  }
}

/// A square-cut switch, in the angular language of the rest of the interface.
class _Switch extends StatelessWidget {
  const _Switch({required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) {
    final still = reducedMotion(context);
    final time = Duration(milliseconds: still ? 0 : 160);
    return AnimatedContainer(
      duration: time,
      width: 54,
      height: 30,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: on ? Bl.brand : Bl.ink.withValues(alpha: 0.6),
        border: Border.all(color: on ? Bl.brand : Bl.lineStrong),
        borderRadius: BorderRadius.circular(2),
      ),
      child: AnimatedAlign(
        duration: time,
        curve: Curves.easeOut,
        alignment: on ? Alignment.centerRight : Alignment.centerLeft,
        child: SizedBox(
          width: 22,
          height: 22,
          child: DecoratedBox(
            decoration: BoxDecoration(color: on ? Bl.text : Bl.dim, borderRadius: BorderRadius.circular(1)),
          ),
        ),
      ),
    );
  }
}

class _LastAlert extends StatelessWidget {
  const _LastAlert({required this.alert, required this.strings});

  final AlertInfo alert;
  final Strings strings;

  @override
  Widget build(BuildContext context) {
    final locale = strings.locale;
    final move = Move.between(alert.current.sell, alert.previous?.sell);
    final direction = move?.direction ?? Direction.flat;
    final title = switch (direction) {
      Direction.up => strings.alertRose,
      Direction.down => strings.alertFell,
      Direction.flat => strings.alertMoved,
    };
    return MergeSemantics(
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: Bl.line)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (direction != Direction.flat) ...[DirectionMark(direction, size: 10, color: directionColor(direction)), const SizedBox(width: 8)],
                  Flexible(child: Text(title, style: sans(17, weight: 700, tracking: -0.02, height: 1.2))),
                ],
              ),
              const SizedBox(height: 10),
              Text(strings.sell.toUpperCase(), style: BlType.label()),
              const SizedBox(height: 4),
              Text(formatPesos(alert.current.sell, locale), style: sans(34, weight: 800, tracking: -0.05, height: 1.1, tabular: true)),
              if (move != null) ...[const SizedBox(height: 10), MoveChip(move: move, locale: locale)],
              const SizedBox(height: 10),
              Text(formatDateTime(alert.at, locale), style: BlType.note()),
            ],
          ),
        ),
      ),
    );
  }
}

Future<void> _open(String url) async {
  try {
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  } on Object {
    // No browser to hand the link to: nothing useful to do.
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({required this.label, required this.url, this.detail});

  final String label;
  final String url;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      link: true,
      child: Pressable(
        onTap: () => _open(url),
        minHeight: 50,
        child: DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: Bl.line)),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              children: [
                Expanded(child: Text(label, style: sans(15.5, weight: 500, height: 1.25))),
                if (detail != null) ...[Text(detail!, style: BlType.note()), const SizedBox(width: 10)],
                const GlyphIcon(Glyph.external, size: 16, color: Bl.brandInk, stroke: 1.4),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SocialLink extends StatelessWidget {
  const _SocialLink({required this.label, required this.url});

  final String label;
  final String url;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      link: true,
      child: Pressable(
        onTap: () => _open(url),
        child: Center(
          widthFactor: 1,
          child: Text(label, style: sans(15.5, weight: 600, color: Bl.brandInk, height: 1.25)),
        ),
      ),
    );
  }
}
