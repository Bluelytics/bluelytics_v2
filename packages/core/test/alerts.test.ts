import { describe, expect, it } from 'vitest';
import { ALERT_CONFIG, FCM, alertWindow, buildAlertNotification, buildFcmMessage, shouldAlert } from '../src/index.ts';
import type { AlertRuleInput } from '../src/index.ts';

const NOW = '2026-11-20T20:00:54.374497Z';

function input(overrides: Partial<AlertRuleInput>): AlertRuleInput {
  return {
    now: NOW,
    sellNow: 1670,
    lastAlert: { alertAt: '2026-11-20T17:00:00.000Z', sell: 1658 },
    windowSells: [1650, 1655, 1660],
    previousSell: 1640,
    ...overrides,
  };
}

describe('shouldAlert', () => {
  it('fires for the last production alert (1658 → 1670, breakout above the window)', () => {
    expect(shouldAlert(input({}))).toEqual({ fire: true, min: 1650, max: 1660 });
  });

  it('respects the 10-minute cooldown (exclusive), across days too', () => {
    expect(shouldAlert(input({ lastAlert: { alertAt: '2026-11-20T19:51:00.000Z', sell: 1658 } }))).toEqual({ fire: false, reason: 'cooldown' });
    expect(shouldAlert(input({ lastAlert: { alertAt: '2026-11-20T19:50:54.374497Z', sell: 1658 } }))).toEqual({ fire: false, reason: 'cooldown' });
    expect(shouldAlert(input({ lastAlert: { alertAt: '2026-11-20T19:50:54.373Z', sell: 1658 } })).fire).toBe(true);
    // legacy `timedelta.seconds` would suppress this one (exactly one day + 5 minutes later)
    expect(shouldAlert(input({ lastAlert: { alertAt: '2026-11-19T19:55:54.374Z', sell: 1658 } })).fire).toBe(true);
  });

  it('needs a move of more than 0.5 % against the last alert’s sell', () => {
    expect(shouldAlert(input({ lastAlert: { alertAt: '2026-11-20T17:00:00.000Z', sell: 1662 } }))).toEqual({ fire: false, reason: 'small_change' });
    // exactly +0.5 %: 1608 / 1600 − 1 is 0.004999999999999893 in floats, below the threshold either way
    const exact = input({ sellNow: 1608, lastAlert: { alertAt: '2026-11-20T17:00:00.000Z', sell: 1600 }, windowSells: [1590, 1600] });
    expect(shouldAlert(exact)).toEqual({ fire: false, reason: 'small_change' });
    expect(shouldAlert({ ...exact, sellNow: 1609 }).fire).toBe(true);
    // exactly −0.5 %: |1592 / 1600 − 1| is 0.0050000000000000044 in floats, which float division (and
    // the legacy alerts.py) would put above the threshold; the integer comparison does not fire.
    const exactDown = { ...exact, sellNow: 1592, windowSells: [1600, 1610] };
    expect(shouldAlert(exactDown)).toEqual({ fire: false, reason: 'small_change' });
    expect(shouldAlert({ ...exactDown, sellNow: 1591 }).fire).toBe(true);
    // downwards
    expect(shouldAlert(input({ sellNow: 1640, windowSells: [1650, 1660] }))).toEqual({ fire: true, min: 1650, max: 1660 });
  });

  it('fires only strictly outside [min, max] of the window', () => {
    expect(shouldAlert(input({ windowSells: [1650, 1670] }))).toEqual({ fire: false, reason: 'inside_range' });
    expect(shouldAlert(input({ windowSells: [1670, 1700] }))).toEqual({ fire: false, reason: 'inside_range' });
    expect(shouldAlert(input({ windowSells: [1669] }))).toEqual({ fire: true, min: 1669, max: 1669 });
    expect(shouldAlert(input({ sellNow: 1648, windowSells: [1649, 1690] }))).toEqual({ fire: true, min: 1649, max: 1690 });
  });

  it('falls back to the previous close when the window is empty (opening gap)', () => {
    expect(shouldAlert(input({ windowSells: [], previousSell: 1640 }))).toEqual({ fire: true, min: 1640, max: 1640 });
    expect(shouldAlert(input({ windowSells: [], previousSell: 1670 }))).toEqual({ fire: false, reason: 'inside_range' });
    expect(shouldAlert(input({ windowSells: [], previousSell: null }))).toEqual({ fire: false, reason: 'no_reference' });
  });

  it('can fire the first alert ever (no cooldown or size check without a previous alert)', () => {
    expect(shouldAlert(input({ lastAlert: null, sellNow: 1661 }))).toEqual({ fire: true, min: 1650, max: 1660 });
    expect(shouldAlert(input({ lastAlert: null, sellNow: 1655 }))).toEqual({ fire: false, reason: 'inside_range' });
  });

  it('computes the window (now − 6 h, now − 15 min) at full precision', () => {
    expect(alertWindow(NOW)).toEqual({ after: '2026-11-20T14:00:54.374497Z', before: '2026-11-20T19:45:54.374497Z' });
    expect(alertWindow('2026-11-23T13:05:00.000Z')).toEqual({ after: '2026-11-23T07:05:00.000Z', before: '2026-11-23T12:50:00.000Z' });
    expect(ALERT_CONFIG).toEqual({ cooldownMs: 600_000, minChangePercent: 0.5, windowStartMs: 21_600_000, windowEndMs: 900_000 });
  });
});

describe('alert notification', () => {
  it('formats a rise exactly like the legacy sender', () => {
    expect(buildAlertNotification(1670, 1658)).toEqual({ title: 'Subió el Dólar Blue', body: 'Venta: 1670.00 (+12.00 / +0.72%)' });
  });

  it('formats a fall with the sign coming from the numbers', () => {
    expect(buildAlertNotification(1640, 1658)).toEqual({ title: 'Bajó el Dólar Blue', body: 'Venta: 1640.00 (-18.00 / -1.09%)' });
  });

  it('formats percentages like Python "{:.2f}", including exact binary ties', () => {
    // (1609/1600 − 1) * 100 evaluates to 0.56249999999999…, not a tie
    expect(buildAlertNotification(1609, 1600).body).toBe('Venta: 1609.00 (+9.00 / +0.56%)');
    // (132/128 − 1) * 100 is exactly 3.125: Python/C print "3.12" (half to even), toFixed would print "3.13"
    expect(buildAlertNotification(132, 128).body).toBe('Venta: 132.00 (+4.00 / +3.12%)');
    expect(buildAlertNotification(124, 128).body).toBe('Venta: 124.00 (-4.00 / -3.12%)');
    expect(buildAlertNotification(140, 128).body).toBe('Venta: 140.00 (+12.00 / +9.38%)');
    expect(buildAlertNotification(1600, 1600)).toEqual({ title: 'Bajó el Dólar Blue', body: 'Venta: 1600.00 (0.00 / 0.00%)' });
  });

  it('builds the FCM HTTP v1 message byte for byte (legacy-mobile.md §2.6)', () => {
    const message = buildFcmMessage(buildAlertNotification(1670, 1658));
    expect(JSON.stringify(message)).toBe(
      '{"message":{"topic":"alertas-blue","notification":{"title":"Subió el Dólar Blue","body":"Venta: 1670.00 (+12.00 / +0.72%)"},' +
        '"android":{"collapse_key":"dolar-blue","priority":"high","ttl":"1200s",' +
        '"notification":{"title":"Subió el Dólar Blue","body":"Venta: 1670.00 (+12.00 / +0.72%)","color":"#221199","channel_id":"Dolar Blue"}}}}',
    );
    expect(FCM.endpoint).toBe('https://fcm.googleapis.com/v1/projects/bluelytics-mobile/messages:send');
  });
});
