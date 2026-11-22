import { formatFixed2, pesosToHundredths } from './money.ts';
import { addSeconds, epochMs } from './time.ts';

export interface AlertConfig {
  /** Minimum time since the previous alert (exclusive). */
  cooldownMs: number;
  /** Minimum move against the previous alert's sell, in percent (exclusive). */
  minChangePercent: number;
  /** The breakout window is (now − windowStartMs, now − windowEndMs), both ends exclusive. */
  windowStartMs: number;
  windowEndMs: number;
}

export const ALERT_CONFIG: AlertConfig = {
  cooldownMs: 10 * 60_000,
  minChangePercent: 0.5,
  windowStartMs: 6 * 3_600_000,
  windowEndMs: 15 * 60_000,
};

/** Contract with the installed mobile apps (legacy-mobile.md §2.6). Do not change any value. */
export const FCM = {
  projectId: 'bluelytics-mobile',
  endpoint: 'https://fcm.googleapis.com/v1/projects/bluelytics-mobile/messages:send',
  scope: 'https://www.googleapis.com/auth/firebase.messaging',
  topic: 'alertas-blue',
  collapseKey: 'dolar-blue',
  priority: 'high',
  ttl: '1200s',
  color: '#221199',
  channelId: 'Dolar Blue',
} as const;

export interface AlertRuleInput {
  /** Instant of this run (UTC ISO). */
  now: string;
  /** Blue sell published by this run, in pesos. */
  sellNow: number;
  /** The newest row of `alerts`, or `null` when there has never been one. */
  lastAlert: { alertAt: string; sell: number } | null;
  /** Published blue sell of every tick inside {@link alertWindow}. */
  windowSells: readonly number[];
  /** Blue sell of the last tick at or before the window start (the previous close); used when the window is empty. */
  previousSell: number | null;
}

/**
 * `cooldown`: 10 minutes have not passed since the last alert; `small_change`: within 0.5 % of
 * the last alert's sell; `inside_range`: not a breakout; `no_reference`: no tick to compare with.
 */
export type AlertSkipReason = 'cooldown' | 'small_change' | 'inside_range' | 'no_reference';

export type AlertDecision =
  | { fire: true; min: number; max: number }
  | { fire: false; reason: AlertSkipReason };

export interface AlertNotification {
  title: string;
  body: string;
}

export interface FcmMessage {
  message: {
    topic: string;
    notification: AlertNotification;
    android: {
      collapse_key: string;
      priority: string;
      ttl: string;
      notification: AlertNotification & { color: string; channel_id: string };
    };
  };
}

/** Bounds of the breakout window for a run: ticks with `after < run_at < before` belong to it. */
export function alertWindow(now: string, config: AlertConfig = ALERT_CONFIG): { after: string; before: string } {
  return {
    after: addSeconds(now, -config.windowStartMs / 1000),
    before: addSeconds(now, -config.windowEndMs / 1000),
  };
}

/**
 * The alert rule. Fires when all hold: more than 10 minutes since the last alert; the sell moved
 * more than 0.5 % against the last alert's sell; and the sell is strictly outside the [min, max]
 * of the window's ticks (or, with an empty window, differs from the previous close). Without any
 * previous alert the first two conditions are waived.
 */
export function shouldAlert(input: AlertRuleInput, config: AlertConfig = ALERT_CONFIG): AlertDecision {
  const { sellNow, lastAlert } = input;
  if (lastAlert) {
    if (epochMs(input.now) - epochMs(lastAlert.alertAt) <= config.cooldownMs) return { fire: false, reason: 'cooldown' };
    // |sellNow / last - 1| * 100 <= pct, cross-multiplied so that exact boundaries are not lost to float division.
    if (Math.abs(sellNow - lastAlert.sell) * 100 <= config.minChangePercent * lastAlert.sell) {
      return { fire: false, reason: 'small_change' };
    }
  }
  const reference = input.windowSells.length > 0 ? input.windowSells : input.previousSell === null ? [] : [input.previousSell];
  if (reference.length === 0) return { fire: false, reason: 'no_reference' };
  const min = Math.min(...reference);
  const max = Math.max(...reference);
  return sellNow > max || sellNow < min ? { fire: true, min, max } : { fire: false, reason: 'inside_range' };
}

/**
 * Python `'{:.2f}'.format(x)`: `toFixed(2)` except on exact binary ties (odd multiples of 1/8),
 * where C formatting rounds half to even and `toFixed` rounds half up.
 */
function formatFloat2(x: number): string {
  const eighths = Math.abs(x) * 8;
  if (!Number.isInteger(eighths) || eighths % 2 === 0) return x.toFixed(2);
  const lower = (eighths * 25 - 1) / 2; // |x| * 100 - 0.5, an integer
  const hundredths = lower % 2 === 0 ? lower : lower + 1;
  return (x < 0 ? '-' : '') + formatFixed2(hundredths);
}

/**
 * Title and body of the push notification, exactly as the legacy sender formats them:
 * `Subió el Dólar Blue` / `Venta: 1670.00 (+12.00 / +0.72%)`. Both arguments are sell values in
 * pesos; `previousSell` is the sell stored with the previous alert.
 */
export function buildAlertNotification(currentSell: number, previousSell: number): AlertNotification {
  const up = currentSell > previousSell;
  const sign = up ? '+' : '';
  const change = formatFixed2(pesosToHundredths(currentSell - previousSell));
  const percent = formatFloat2((currentSell / previousSell - 1) * 100);
  return {
    title: up ? 'Subió el Dólar Blue' : 'Bajó el Dólar Blue',
    body: `Venta: ${formatFixed2(pesosToHundredths(currentSell))} (${sign}${change} / ${sign}${percent}%)`,
  };
}

/** The FCM HTTP v1 request body for a notification; `JSON.stringify` it and POST to `FCM.endpoint`. */
export function buildFcmMessage(notification: AlertNotification): FcmMessage {
  const { title, body } = notification;
  return {
    message: {
      topic: FCM.topic,
      notification: { title, body },
      android: {
        collapse_key: FCM.collapseKey,
        priority: FCM.priority,
        ttl: FCM.ttl,
        notification: { title, body, color: FCM.color, channel_id: FCM.channelId },
      },
    },
  };
}
