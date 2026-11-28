import type { AlertDecision, AlertNotification, PublishedRate } from '@bluelytics/core';
import { ALERT_CONFIG, addSeconds, alertWindow, artDate, buildAlertNotification, epochMs, shouldAlert } from '@bluelytics/core';
import {
  buildRendered,
  getLastTickAtOrBefore,
  getLatestAlerts,
  getPreviousClose,
  getTicksBetween,
  insertAlertUnlessRecent,
  deleteApnsDevices,
  listApnsDevices,
  setAlertPushStatus,
  writeRendered,
} from '@bluelytics/db';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';
import { sendApns } from './apns.ts';
import { sendPush } from './fcm.ts';

export type AlertReport =
  | { fired: false; reason: Extract<AlertDecision, { fire: false }>['reason'] }
  | { fired: true; id: number; sell: number; pushStatus: string };

/**
 * Step 4 of ARCHITECTURE §7. The alert row is inserted and `/v2/alerts` re-rendered before the
 * push, so a failed push never loses the alert. Android gets it through the FCM topic, iPhones
 * straight from APNs, each independently of the other. `push_status` is `disabled` with
 * `PUSH_ENABLED` off, `sent` when both went out, or `failed: <reasons>`.
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
    const notification = buildAlertNotification(blue.sell, reference);
    const [android, ios] = await Promise.all([pushAndroid(deps, notification, now), pushIos(deps, notification, now)]);
    const failures = [android, ios].filter((failure) => failure !== null);
    pushStatus = failures.length === 0 ? 'sent' : `failed: ${failures.join('; ')}`;
    if (failures.length > 0) deps.log('error', 'push failed', { alertId: alert.id, error: pushStatus });
  }
  await setAlertPushStatus(db, alert.id, pushStatus);
  return { fired: true, id: alert.id, sell: blue.sell, pushStatus };
}

/** The FCM topic (Android). `null` when sent, else the reason. */
async function pushAndroid(deps: Deps, notification: AlertNotification, now: string): Promise<string | null> {
  try {
    await sendPush(notification, { fetch: deps.fetch, serviceAccountJson: deps.secrets.firebaseServiceAccountJson, nowMs: epochMs(now) });
    return null;
  } catch (error) {
    return `fcm: ${errorText(error)}`;
  }
}

/** Every registered iPhone through APNs; dead tokens are deleted. `null` when nothing failed. */
async function pushIos(deps: Deps, notification: AlertNotification, now: string): Promise<string | null> {
  try {
    const devices = await listApnsDevices(deps.db);
    const report = await sendApns(notification, devices, {
      fetch: deps.fetch,
      keyP8: deps.secrets.apnsKeyP8,
      keyId: deps.secrets.apnsKeyId,
      nowMs: epochMs(now),
    });
    await deleteApnsDevices(deps.db, report.invalid);
    if (report.failed.length === 0) return null;
    const reasons = [...new Set(report.failed.map((failure) => failure.reason))].join(', ');
    return `apns: ${report.failed.length} of ${devices.length} failed (${reasons})`;
  } catch (error) {
    return `apns: ${errorText(error)}`;
  }
}
