import { describe, expect, it } from 'vitest';
import { SOCIAL_CONFIG, canRetryPost, postCooldownMs, previousTradingDay, shouldPost, updateEventKey, weeklyEventKey } from '../src/index.ts';
import type { UpdatePostInput, WeeklyPostInput } from '../src/index.ts';

// Monday 2026-11-23, 12:00 in Buenos Aires.
const MONDAY_NOON = '2026-11-23T15:00:00.000Z';

function update(overrides: Partial<UpdatePostInput>): UpdatePostInput {
  return {
    kind: 'update',
    network: 'twitter',
    now: MONDAY_NOON,
    sellNow: 1690,
    lastSent: { sentAt: '2026-11-20T21:00:00.000Z', sell: 1670 },
    lastSentAt: '2026-11-20T21:00:00.000Z',
    previousClose: 1670,
    ...overrides,
  };
}

function weekly(overrides: Partial<WeeklyPostInput>): WeeklyPostInput {
  return {
    kind: 'weekly',
    network: 'instagram',
    now: '2026-11-27T21:05:00.000Z', // Friday 18:05 ART
    weekSells: [1670, 1680, 1690, 1700, 1710],
    lastSentEventKey: 'weekly-2026-W47',
    ...overrides,
  };
}

describe('shouldPost: update', () => {
  it('posts on a Monday, comparing with Friday’s close (legacy never posted on Mondays)', () => {
    expect(previousTradingDay('2026-11-23')).toBe('2026-11-20');
    expect(shouldPost(update({}))).toEqual({ post: true, eventKey: 'update-2026-11-23-1690-after-20261120T210000Z' });
  });

  it('only runs on weekdays between 10:00 and 18:59 ART', () => {
    expect(shouldPost(update({ now: '2026-11-23T12:59:59.999Z' }))).toEqual({ post: false, reason: 'outside_window' });
    expect(shouldPost(update({ now: '2026-11-23T13:00:00.000Z' })).post).toBe(true);
    expect(shouldPost(update({ now: '2026-11-23T21:59:59.000Z' })).post).toBe(true);
    expect(shouldPost(update({ now: '2026-11-23T22:00:00.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
    expect(shouldPost(update({ now: '2026-11-28T15:00:00.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
  });

  it('applies a per-network cooldown: 15 minutes on twitter, 60 elsewhere (exclusive)', () => {
    expect(postCooldownMs('twitter')).toBe(15 * 60_000);
    expect(postCooldownMs('instagram')).toBe(60 * 60_000);
    expect(postCooldownMs('facebook')).toBe(60 * 60_000);
    const sent = (sentAt: string) => ({ lastSent: { sentAt, sell: 1670 }, lastSentAt: sentAt });
    expect(shouldPost(update(sent('2026-11-23T14:45:00.000Z')))).toEqual({ post: false, reason: 'cooldown' });
    expect(shouldPost(update(sent('2026-11-23T14:44:59.999Z'))).post).toBe(true);
    expect(shouldPost(update({ network: 'instagram', ...sent('2026-11-23T14:10:00.000Z') }))).toEqual({ post: false, reason: 'cooldown' });
    expect(shouldPost(update({ network: 'instagram', ...sent('2026-11-23T14:00:00.000Z') }))).toEqual({ post: false, reason: 'cooldown' });
    expect(shouldPost(update({ network: 'instagram', ...sent('2026-11-23T13:59:59.999Z') })).post).toBe(true);
  });

  it('starts the cooldown at the network’s last sent post of any kind (a weekly post counts)', () => {
    const afterWeekly = update({ now: '2026-11-27T21:10:00.000Z', lastSentAt: '2026-11-27T21:00:00.000Z' }); // Friday 18:10 ART
    expect(shouldPost(afterWeekly)).toEqual({ post: false, reason: 'cooldown' });
    expect(shouldPost({ ...afterWeekly, now: '2026-11-27T21:15:00.001Z' }).post).toBe(true);
    // the update post's own time still counts if the caller passes an older lastSentAt
    expect(shouldPost(update({ lastSent: { sentAt: '2026-11-23T14:50:00.000Z', sell: 1670 }, lastSentAt: null }))).toEqual({
      post: false,
      reason: 'cooldown',
    });
  });

  it('needs a move of at least 0.75 % against the last posted sell (inclusive)', () => {
    const base = { lastSent: { sentAt: '2026-11-20T21:00:00.000Z', sell: 1600 }, previousClose: 1590 };
    expect(shouldPost(update({ ...base, sellNow: 1612 })).post).toBe(true); // exactly 0.75 %
    expect(shouldPost(update({ ...base, sellNow: 1611 }))).toEqual({ post: false, reason: 'small_change' });
    expect(shouldPost(update({ ...base, sellNow: 1588 })).post).toBe(true); // exactly −0.75 %
    expect(shouldPost(update({ ...base, sellNow: 1589 }))).toEqual({ post: false, reason: 'small_change' });
  });

  it('never posts the previous trading day’s close again', () => {
    expect(shouldPost(update({ sellNow: 1690, previousClose: 1690 }))).toEqual({ post: false, reason: 'same_as_previous_close' });
  });

  it('uses the previous close as the baseline for a network that never posted', () => {
    expect(shouldPost(update({ lastSent: null, lastSentAt: null, sellNow: 1690, previousClose: 1670 }))).toEqual({
      post: true,
      eventKey: 'update-2026-11-23-1690',
    });
    expect(shouldPost(update({ lastSent: null, sellNow: 1675, previousClose: 1670 }))).toEqual({ post: false, reason: 'small_change' });
    expect(shouldPost(update({ lastSent: null, previousClose: null }))).toEqual({ post: false, reason: 'no_baseline' });
  });

  it('derives the event key from the Argentine day, the sell and the post it follows', () => {
    expect(updateEventKey('2026-11-24T02:30:00.000Z', 1700, null)).toBe('update-2026-11-23-1700');
    expect(updateEventKey('2026-11-24T02:30:00.000Z', 1700, '2026-11-23T18:15:00.123Z')).toBe('update-2026-11-23-1700-after-20261123T181500Z');
  });

  it('gives a return to an already-posted sell on the same day its own key', () => {
    // 1600 posted at 14:00 ART, 1620 posted at 15:00, back to 1600 at 16:00 (1.23 % below 1620)
    const first = shouldPost(update({ now: '2026-11-23T17:00:00.000Z', sellNow: 1600, lastSent: null, lastSentAt: null, previousClose: 1580 }));
    const back = shouldPost(
      update({
        now: '2026-11-23T19:00:00.000Z',
        sellNow: 1600,
        lastSent: { sentAt: '2026-11-23T18:00:00.000Z', sell: 1620 },
        lastSentAt: '2026-11-23T18:00:00.000Z',
        previousClose: 1580,
      }),
    );
    expect(first).toEqual({ post: true, eventKey: 'update-2026-11-23-1600' });
    expect(back).toEqual({ post: true, eventKey: 'update-2026-11-23-1600-after-20261123T180000Z' });
    // a second run that sees the same last post makes the same decision with the same key
    const rerun = update({
      now: '2026-11-23T19:05:00.000Z',
      sellNow: 1600,
      lastSent: { sentAt: '2026-11-23T18:00:00.000Z', sell: 1620 },
      lastSentAt: '2026-11-23T18:00:00.000Z',
      previousClose: 1580,
    });
    expect(shouldPost(rerun)).toEqual(back);
  });
});

describe('shouldPost: weekly', () => {
  it('posts on Friday from 18:00 ART, once per ISO week and network', () => {
    expect(shouldPost(weekly({}))).toEqual({ post: true, eventKey: 'weekly-2026-W48' });
    expect(shouldPost(weekly({ lastSentEventKey: 'weekly-2026-W48' }))).toEqual({ post: false, reason: 'already_posted' });
    expect(shouldPost(weekly({ lastSentEventKey: null })).post).toBe(true);
  });

  it('goes out on Friday 18:00–18:59 ART only (inside the 10:00–18:59 social window)', () => {
    expect(shouldPost(weekly({ now: '2026-11-27T20:59:59.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
    expect(shouldPost(weekly({ now: '2026-11-27T21:00:00.000Z' })).post).toBe(true);
    expect(shouldPost(weekly({ now: '2026-11-27T21:59:59.999Z' })).post).toBe(true);
    expect(shouldPost(weekly({ now: '2026-11-27T22:00:00.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
    expect(shouldPost(weekly({ now: '2026-11-26T21:05:00.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
    // 00:30 UTC on Saturday is Friday 21:30 in Buenos Aires: too late
    expect(shouldPost(weekly({ now: '2026-11-28T00:30:00.000Z' }))).toEqual({ post: false, reason: 'outside_window' });
  });

  it('works for short weeks and refuses an empty one', () => {
    expect(shouldPost(weekly({ weekSells: [1700] })).post).toBe(true);
    expect(shouldPost(weekly({ weekSells: [1700, 1710, 1690] })).post).toBe(true);
    expect(shouldPost(weekly({ weekSells: [] }))).toEqual({ post: false, reason: 'no_data' });
  });

  it('keys the ISO week on the Argentine date, including the week-year', () => {
    expect(weeklyEventKey('2026-11-28T00:30:00.000Z')).toBe('weekly-2026-W48');
    expect(weeklyEventKey('2027-01-01T21:00:00.000Z')).toBe('weekly-2026-W53');
    expect(weeklyEventKey('2027-12-31T21:00:00.000Z')).toBe('weekly-2027-W52');
  });
});

describe('retries and config', () => {
  it('retries a failed post at most twice after the first attempt', () => {
    expect(canRetryPost({ status: 'failed', attempts: 1 })).toBe(true);
    expect(canRetryPost({ status: 'failed', attempts: 2 })).toBe(true);
    expect(canRetryPost({ status: 'failed', attempts: 3 })).toBe(false);
    expect(canRetryPost({ status: 'sent', attempts: 1 })).toBe(false);
    expect(canRetryPost({ status: 'pending', attempts: 0 })).toBe(false);
  });

  it('keeps every threshold in one config object', () => {
    expect(SOCIAL_CONFIG).toEqual({
      updateWindow: { fromHour: 10, toHour: 19 },
      cooldownMs: { twitter: 900_000, default: 3_600_000 },
      minChangePercent: 0.75,
      weekly: { isoWeekday: 5, fromHour: 18, toHour: 19 },
      maxAttempts: 3,
      pendingTimeoutMs: 900_000,
    });
    const strict = { ...SOCIAL_CONFIG, minChangePercent: 2 };
    expect(shouldPost(update({}), strict)).toEqual({ post: false, reason: 'small_change' });
  });
});
