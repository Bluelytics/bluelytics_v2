import { addSeconds, epochMs } from '@bluelytics/core';
import { getSourceHealth, getState, setState } from '@bluelytics/db';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';

const OPS_STATE_KEY = 'ops_incidents';
/** A source is reported after this many failed runs in a row (ARCHITECTURE §7 step 7). */
export const MAX_CONSECUTIVE_FAILURES = 6;
/** …and the blue consensus after this long with fewer than three voters. */
export const LOW_VOTERS_MS = 60 * 60_000;
const MIN_BLUE_VOTERS = 3;

interface Incidents {
  failing: string[];
  lowVotersSince: string | null;
  lowVotersReported: boolean;
}

export interface OpsReport {
  messages: string[];
}

/**
 * Step 7 of ARCHITECTURE §7: one message per incident (a source starts failing, or the blue
 * consensus has run short of voters for an hour) to `OPS_WEBHOOK_URL`, plus an error log line.
 * Open incidents live in `state`, so a long outage is reported once, and again only after it cleared.
 */
export async function checkSourceHealth(deps: Deps, now: string, blueVoters: number): Promise<OpsReport> {
  const { db } = deps;
  const tickSources = new Set<string>(deps.sources.map((source) => source.id));
  const [health, stored] = await Promise.all([getSourceHealth(db, addSeconds(now, -3600)), getState(db, OPS_STATE_KEY)]);
  const previous: Incidents = stored ? (JSON.parse(stored.value) as Incidents) : { failing: [], lowVotersSince: null, lowVotersReported: false };
  const failingNow = health.filter((row) => tickSources.has(row.source) && row.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES);
  const messages = failingNow
    .filter((row) => !previous.failing.includes(row.source))
    .map((row) => `bluelytics-jobs: source ${row.source} failed ${row.consecutiveFailures} consecutive runs (last error: ${row.lastError ?? 'none'})`);

  const next: Incidents = { failing: failingNow.map((row) => row.source), lowVotersSince: null, lowVotersReported: false };
  if (blueVoters < MIN_BLUE_VOTERS) {
    next.lowVotersSince = previous.lowVotersSince ?? now;
    next.lowVotersReported = previous.lowVotersReported;
    if (!next.lowVotersReported && epochMs(now) - epochMs(next.lowVotersSince) >= LOW_VOTERS_MS) {
      messages.push(`bluelytics-jobs: fewer than ${MIN_BLUE_VOTERS} blue voters since ${next.lowVotersSince} (now ${blueVoters})`);
      next.lowVotersReported = true;
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(previous)) await setState(db, OPS_STATE_KEY, JSON.stringify(next), now);
  for (const message of messages) {
    deps.log('error', message);
    await notifyOps(deps, message);
  }
  return { messages };
}

/** Slack (`text`), Discord (`content`) and Telegram bot `sendMessage?chat_id=…` (`text`) all accept this body. */
async function notifyOps(deps: Deps, message: string): Promise<void> {
  const url = deps.secrets.opsWebhookUrl;
  if (!url) return;
  try {
    const response = await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) deps.log('error', 'ops webhook failed', { status: response.status });
  } catch (error) {
    deps.log('error', 'ops webhook failed', { error: errorText(error) });
  }
}
