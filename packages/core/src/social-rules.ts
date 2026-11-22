import { artParts, epochMs, isoWeekKey, toUtcZ } from './time.ts';
import type { Network } from './types.ts';

export interface SocialConfig {
  /** `update` posts are evaluated on weekdays with `fromHour <= hour < toHour`, Argentine time. */
  updateWindow: { fromHour: number; toHour: number };
  /** Minimum time since the network's last sent post of any kind (exclusive). */
  cooldownMs: Readonly<Partial<Record<Network, number>>> & { default: number };
  /** Minimum move against the last posted sell, in percent (inclusive). */
  minChangePercent: number;
  /** `weekly` posts go out on this ISO weekday with `fromHour <= hour < toHour` (Argentine time), once per ISO week. */
  weekly: { isoWeekday: number; fromHour: number; toHour: number };
  /** Total send attempts per event: the first try plus two retries on later runs. */
  maxAttempts: number;
  /**
   * A `pending` row older than this belongs to a run that died between the claim and the result
   * (a Worker invocation cannot outlive it); it is then recorded as a failed attempt.
   */
  pendingTimeoutMs: number;
}

export const SOCIAL_CONFIG: SocialConfig = {
  updateWindow: { fromHour: 10, toHour: 19 },
  cooldownMs: { twitter: 15 * 60_000, default: 60 * 60_000 },
  minChangePercent: 0.75,
  weekly: { isoWeekday: 5, fromHour: 18, toHour: 19 },
  maxAttempts: 3,
  pendingTimeoutMs: 15 * 60_000,
};

export interface UpdatePostInput {
  kind: 'update';
  network: Network;
  /** Instant of this run (UTC ISO). */
  now: string;
  /** Blue sell published by this run, in pesos. */
  sellNow: number;
  /** That network's last *sent* update post (the comparison base), or `null` when it has never posted one. */
  lastSent: { sentAt: string; sell: number } | null;
  /** `sent_at` of that network's newest sent post of any kind (the cooldown clock), or `null`. */
  lastSentAt: string | null;
  /** Blue sell of the previous trading day's daily row (Monday → Friday), or `null` when unknown. */
  previousClose: number | null;
}

export interface WeeklyPostInput {
  kind: 'weekly';
  network: Network;
  now: string;
  /** Daily blue sell values of the current ISO week so far, Monday first (1–5 points). */
  weekSells: readonly number[];
  /** Event key of that network's last *sent* weekly post, or `null`. */
  lastSentEventKey: string | null;
}

export type PostInput = UpdatePostInput | WeeklyPostInput;

/**
 * `outside_window`: wrong day or hour; `cooldown`: too soon after the last post; `small_change`:
 * under 0.75 % from the last posted sell; `same_as_previous_close`: equals yesterday's close;
 * `no_baseline`: nothing to compare with; `already_posted`: this week's chart went out;
 * `no_data`: the week has no daily rows yet.
 */
export type PostSkipReason =
  | 'outside_window'
  | 'cooldown'
  | 'small_change'
  | 'same_as_previous_close'
  | 'no_baseline'
  | 'already_posted'
  | 'no_data';

export type PostDecision = { post: true; eventKey: string } | { post: false; reason: PostSkipReason };

/**
 * Idempotency key of an update post: the Argentine day, the sell, and the update post it follows
 * (`afterSentAt` = its `sent_at`, `null` for a network's first one). Runs that see the same last post
 * claim the same key, so a decision is sent once; a later return to an already-posted sell follows a
 * different post and gets a new key. Example: `update-2026-11-20-1600-after-20261120T171500Z`.
 */
export function updateEventKey(now: string, sellNow: number, afterSentAt: string | null): string {
  const key = `update-${artParts(now).day}-${sellNow}`;
  return afterSentAt === null ? key : `${key}-after-${toUtcZ(afterSentAt).replace(/[-:]|\.\d+/g, '')}`;
}

/** Idempotency key of a weekly post: one per ISO week (Argentine date), e.g. `weekly-2026-W47`. */
export function weeklyEventKey(now: string): string {
  return `weekly-${isoWeekKey(artParts(now).day)}`;
}

/** Cooldown between update posts for a network: 15 minutes on twitter, 60 elsewhere. */
export function postCooldownMs(network: Network, config: SocialConfig = SOCIAL_CONFIG): number {
  return config.cooldownMs[network] ?? config.cooldownMs.default;
}

/** Whether a stored post may be attempted (again): only failed ones, up to `maxAttempts` in total. */
export function canRetryPost(post: { status: string; attempts: number }, config: SocialConfig = SOCIAL_CONFIG): boolean {
  return post.status === 'failed' && post.attempts < config.maxAttempts;
}

function shouldPostUpdate(input: UpdatePostInput, config: SocialConfig): PostDecision {
  const { isoWeekday: weekday, hour } = artParts(input.now);
  if (weekday > 5 || hour < config.updateWindow.fromHour || hour >= config.updateWindow.toHour) {
    return { post: false, reason: 'outside_window' };
  }
  const { sellNow, lastSent, previousClose } = input;
  const clocks = [input.lastSentAt, lastSent?.sentAt].filter((at): at is string => typeof at === 'string');
  const sinceLastPostMs = Math.min(...clocks.map((at) => epochMs(input.now) - epochMs(at)));
  if (sinceLastPostMs <= postCooldownMs(input.network, config)) return { post: false, reason: 'cooldown' };
  const baseline = lastSent ? lastSent.sell : previousClose;
  if (baseline === null) return { post: false, reason: 'no_baseline' };
  // |sellNow / baseline - 1| * 100 < pct, cross-multiplied so that exact boundaries are not lost to float division.
  if (Math.abs(sellNow - baseline) * 100 < config.minChangePercent * baseline) return { post: false, reason: 'small_change' };
  if (sellNow === previousClose) return { post: false, reason: 'same_as_previous_close' };
  return { post: true, eventKey: updateEventKey(input.now, sellNow, lastSent?.sentAt ?? null) };
}

function shouldPostWeekly(input: WeeklyPostInput, config: SocialConfig): PostDecision {
  const { isoWeekday: weekday, hour } = artParts(input.now);
  if (weekday !== config.weekly.isoWeekday || hour < config.weekly.fromHour || hour >= config.weekly.toHour) {
    return { post: false, reason: 'outside_window' };
  }
  const eventKey = weeklyEventKey(input.now);
  if (input.lastSentEventKey === eventKey) return { post: false, reason: 'already_posted' };
  if (input.weekSells.length === 0) return { post: false, reason: 'no_data' };
  return { post: true, eventKey };
}

/**
 * The social posting rule for one network and one kind. A positive decision carries the
 * `event_key` to claim in `social_posts` (UNIQUE per network) before anything is sent.
 */
export function shouldPost(input: PostInput, config: SocialConfig = SOCIAL_CONFIG): PostDecision {
  return input.kind === 'update' ? shouldPostUpdate(input, config) : shouldPostWeekly(input, config);
}
