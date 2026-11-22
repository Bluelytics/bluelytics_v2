import type { AlertDecision, PublishedRate } from '@bluelytics/core';
import { ALERT_CONFIG, addSeconds, alertWindow, artDate, buildAlertNotification, epochMs, shouldAlert } from '@bluelytics/core';
import {
  buildRendered,
  getLastTickAtOrBefore,
  getLatestAlerts,
  getPreviousClose,
  getTicksBetween,
  insertAlertUnlessRecent,
  setAlertPushStatus,
  writeRendered,
} from '@bluelytics/db';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';
import { sendPush } from './fcm.ts';

export type AlertReport =
  | { fired: false; reason: Extract<AlertDecision, { fire: false }>['reason'] }
  | { fired: true; id: number; sell: number; pushStatus: string };

/**
 * Step 4 of ARCHITECTURE §7. The alert row is inserted and `/v2/alerts` re-rendered before the
 * push, so a failed push never loses the alert; `push_status` is `disabled` with `PUSH_ENABLED`
 * off, `sent`, or `failed: <reason>`.
 */
export async function runAlerts(deps: Deps, now: string, blue: PublishedRate): Promise<AlertReport> {
  const { db } = deps;
  const window = alertWindow(now);
  const [{ current: lastAlert }, windowTicks] = await Promise.all([getLatestAlerts(db), getTicksBetween(db, window.after, window.before)]);
  let previousSell: number | null = null;
  if (windowTicks.length === 0) {
    // Previous close: the last tick before the window, or (right after cutover, no ticks yet) the previous day's row.
    previousSell = (await getLastTickAtOrBefore(db, window.after))?.blueSell ?? (await getPreviousClose(db, artDate(now)))?.sell ?? null;
  }
  const decision = shouldAlert({
    now,
    sellNow: blue.sell,
    lastAlert: lastAlert && { alertAt: lastAlert.alertAt, sell: lastAlert.sell },
    windowSells: windowTicks.map((tick) => tick.blueSell),
    previousSell,
  });
  if (!decision.fire) return { fired: false, reason: decision.reason };

  const alert = await insertAlertUnlessRecent(
    db,
    { alertAt: now, buy: blue.buy, sell: blue.sell, pushStatus: 'pending' },
    addSeconds(now, -ALERT_CONFIG.cooldownMs / 1000),
  );
  if (!alert) return { fired: false, reason: 'cooldown' };
  await writeRendered(db, await buildRendered(db, { legacyBlueBug: deps.config.legacyBlueBug, keys: ['alerts'] }), now);
  // Without a previous alert the move is told against the breakout bound it crossed.
  const reference = lastAlert?.sell ?? (blue.sell > decision.max ? decision.max : decision.min);
  let pushStatus = 'disabled';
  if (deps.config.pushEnabled) {
    try {
      await sendPush(buildAlertNotification(blue.sell, reference), {
        fetch: deps.fetch,
        serviceAccountJson: deps.secrets.firebaseServiceAccountJson,
        nowMs: epochMs(now),
      });
      pushStatus = 'sent';
    } catch (error) {
      pushStatus = `failed: ${errorText(error)}`;
      deps.log('error', 'push failed', { alertId: alert.id, error: pushStatus });
    }
  }
  await setAlertPushStatus(db, alert.id, pushStatus);
  return { fired: true, id: alert.id, sell: blue.sell, pushStatus };
}
