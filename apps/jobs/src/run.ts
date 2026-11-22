import type { RateKind } from '@bluelytics/core';
import { isTradingWindow } from '@bluelytics/core';
import { buildRendered, setState, writeRendered } from '@bluelytics/db';
import type { AlertReport } from './alerts.ts';
import { runAlerts } from './alerts.ts';
import { isPublished } from './card-data.ts';
import type { DailyReport } from './daily.ts';
import { isDailyDue, runDaily } from './daily.ts';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';
import { refreshOgImage } from './og.ts';
import type { OpsReport } from './ops.ts';
import { checkSourceHealth } from './ops.ts';
import type { SocialReport } from './social.ts';
import { runSocial } from './social.ts';
import type { StaticSyncReport } from './static-api.ts';
import { syncStaticApi } from './static-api.ts';
import { runObservationOnly, runTick } from './tick.ts';

export const LAST_RUN_STATE_KEY = 'last_run';

export interface SourceStatus {
  source: string;
  ok: boolean;
  error: string | null;
}

export interface RunReport {
  at: string;
  forced: boolean;
  /** `tick`: inside the trading window; `observe`: forced outside it; `daily`: only the daily step; `idle`: nothing to do. */
  mode: 'tick' | 'observe' | 'daily' | 'idle';
  sources?: SourceStatus[];
  voters?: Record<RateKind, string[]>;
  held?: Record<RateKind, boolean>;
  changed?: boolean;
  rendered?: string[];
  alert?: AlertReport | undefined;
  social?: SocialReport | undefined;
  ogRefreshed?: boolean | undefined;
  ops?: OpsReport | undefined;
  daily?: DailyReport;
  staticApi?: StaticSyncReport | undefined;
  /** Steps that failed without stopping the run (`step: message`). */
  errors: string[];
}

/** Runs a step whose failure must not stop the others; the failure is logged and reported. */
async function step<T>(deps: Deps, report: RunReport, name: string, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    const message = `${name}: ${errorText(error)}`;
    report.errors.push(message);
    deps.log('error', 'step failed', { step: name, error: message });
    return undefined;
  }
}

/**
 * One cron invocation (ARCHITECTURE §7), branching on Argentine time: the daily step when due,
 * then inside the trading window the full tick (sources → consensus → bodies → alerts → social →
 * og image → source health). Outside the window nothing runs, unless `force` (admin) asks for a
 * run, which then only records observations and re-renders the bodies (MIGRATION.md C6).
 * The tick's core (fetch + one D1 batch) throws; every later step fails on its own.
 */
export async function runJobs(deps: Deps, now: string, options: { force?: boolean } = {}): Promise<RunReport> {
  const forced = options.force ?? false;
  const inWindow = isTradingWindow(now);
  const dailyDue = await isDailyDue(deps, now);
  const report: RunReport = { at: now, forced, mode: inWindow ? 'tick' : forced ? 'observe' : dailyDue ? 'daily' : 'idle', errors: [] };
  if (report.mode === 'idle') return report;

  if (dailyDue) report.daily = await runDaily(deps, now);

  if (inWindow) {
    const tick = await runTick(deps, now);
    const { consensus } = tick;
    Object.assign(report, {
      sources: tick.observations.map((o) => ({ source: o.source, ok: o.ok, error: o.error })),
      voters: consensus.voters,
      held: consensus.held,
      changed: consensus.changed,
      rendered: tick.rendered,
    });
    const state = consensus.state;
    if (isPublished(state)) {
      if (!consensus.held.blue) report.alert = await step(deps, report, 'alerts', () => runAlerts(deps, now, state.blue));
      report.social = await step(deps, report, 'social', () => runSocial(deps, now, state));
      report.ogRefreshed = await step(deps, report, 'og', () => refreshOgImage(deps, now, state));
    }
    report.ops = await step(deps, report, 'health', () => checkSourceHealth(deps, now, consensus.voters.blue.length));
  } else if (forced) {
    const { observations } = await runObservationOnly(deps, now);
    report.sources = observations.map((o) => ({ source: o.source, ok: o.ok, error: o.error }));
    report.rendered = await writeRendered(deps.db, await buildRendered(deps.db, { legacyBlueBug: deps.config.legacyBlueBug }), now);
  }

  if (deps.config.apiMode === 'static-first') report.staticApi = await step(deps, report, 'static-api', () => syncStaticApi(deps, now));
  await step(deps, report, 'last-run', () => setState(deps.db, LAST_RUN_STATE_KEY, JSON.stringify(summary(report)), now));
  return report;
}

/** What `/admin/health` shows of the last run: the report without the per-source details. */
function summary(report: RunReport): Omit<RunReport, 'sources'> & { failedSources?: string[] } {
  const { sources, ...rest } = report;
  return sources ? { ...rest, failedSources: sources.filter((s) => !s.ok).map((s) => s.source) } : rest;
}
