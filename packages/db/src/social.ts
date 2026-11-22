import { toStoredUtc } from '@bluelytics/core';
import type { Network, SocialPost, SocialPostKind, SocialPostStatus } from '@bluelytics/core';
import type { D1DatabaseLike } from './d1.ts';

interface SocialPostRecord {
  id: number;
  network: Network;
  kind: SocialPostKind;
  event_key: string;
  created_at: string;
  sent_at: string | null;
  buy: number | null;
  sell: number | null;
  status: SocialPostStatus;
  attempts: number;
  external_id: string | null;
  image_key: string | null;
  error: string | null;
}

function postFromRecord(row: SocialPostRecord): SocialPost {
  return {
    id: row.id,
    network: row.network,
    kind: row.kind,
    eventKey: row.event_key,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    buy: row.buy,
    sell: row.sell,
    status: row.status,
    attempts: row.attempts,
    externalId: row.external_id,
    imageKey: row.image_key,
    error: row.error,
  };
}

export interface NewSocialPost {
  network: Network;
  kind: SocialPostKind;
  eventKey: string;
  createdAt: string;
  /** Blue values the post shows; the next `update` decision compares against `sell`. */
  buy: number | null;
  sell: number | null;
}

/**
 * Claims `(network, eventKey)` with a `pending` row before anything is sent. `claimed: false`
 * means the event already had a row (returned as it is): do not send again unless it may be retried.
 */
export async function insertPendingPost(db: D1DatabaseLike, post: NewSocialPost): Promise<{ claimed: boolean; post: SocialPost }> {
  const inserted = await db
    .prepare(
      "INSERT INTO social_posts (network, kind, event_key, created_at, buy, sell, status) VALUES (?, ?, ?, ?, ?, ?, 'pending') " +
        'ON CONFLICT (network, event_key) DO NOTHING RETURNING *',
    )
    .bind(post.network, post.kind, post.eventKey, post.createdAt, post.buy, post.sell)
    .first<SocialPostRecord>();
  if (inserted) return { claimed: true, post: postFromRecord(inserted) };
  const existing = await db
    .prepare('SELECT * FROM social_posts WHERE network = ? AND event_key = ?')
    .bind(post.network, post.eventKey)
    .first<SocialPostRecord>();
  if (!existing) throw new Error(`insertPendingPost: ${post.network}/${post.eventKey} neither inserted nor found`);
  return { claimed: false, post: postFromRecord(existing) };
}

async function finishAttempt(
  db: D1DatabaseLike,
  id: number,
  status: SocialPostStatus,
  fields: { sentAt: string | null; externalId: string | null; imageKey: string | null; error: string | null },
): Promise<SocialPost> {
  const row = await db
    .prepare(
      'UPDATE social_posts SET status = ?, attempts = attempts + 1, sent_at = COALESCE(?, sent_at), external_id = COALESCE(?, external_id),' +
        ' image_key = COALESCE(?, image_key), error = ? WHERE id = ? RETURNING *',
    )
    .bind(status, fields.sentAt, fields.externalId, fields.imageKey, fields.error, id)
    .first<SocialPostRecord>();
  if (!row) throw new Error(`social post ${id} does not exist`);
  return postFromRecord(row);
}

/** Records a successful send (counts one attempt). */
export function markPostSent(
  db: D1DatabaseLike,
  id: number,
  result: { sentAt: string; externalId: string | null; imageKey?: string | null },
): Promise<SocialPost> {
  return finishAttempt(db, id, 'sent', { sentAt: result.sentAt, externalId: result.externalId, imageKey: result.imageKey ?? null, error: null });
}

/** Records a failed send (counts one attempt); `canRetryPost` from core decides whether to try again. */
export function markPostFailed(db: D1DatabaseLike, id: number, failure: { error: string; imageKey?: string | null }): Promise<SocialPost> {
  return finishAttempt(db, id, 'failed', { sentAt: null, externalId: null, imageKey: failure.imageKey ?? null, error: failure.error });
}

/** Records a run with `SOCIAL_ENABLED=false`: everything but the Buffer call happened. */
export function markPostDryRun(db: D1DatabaseLike, id: number, result: { at: string; imageKey?: string | null }): Promise<SocialPost> {
  return finishAttempt(db, id, 'dry_run', { sentAt: result.at, externalId: null, imageKey: result.imageKey ?? null, error: null });
}

/**
 * The newest post of a network whose status is in `statuses` (default: only `sent`), by `sent_at`,
 * of one kind or of any kind (`kind: null`). Any kind = the cooldown clock (`lastSentAt` of core
 * `shouldPost`); `'update'` = the comparison base of the next update post (`lastSent`).
 */
export async function getLastSentPost(
  db: D1DatabaseLike,
  network: Network,
  kind: SocialPostKind | null,
  statuses: readonly SocialPostStatus[] = ['sent'],
): Promise<SocialPost | null> {
  const byKind = kind === null ? '' : 'AND kind = ? ';
  const row = await db
    .prepare(
      `SELECT * FROM social_posts WHERE network = ? ${byKind}AND status IN (${statuses.map(() => '?').join(', ')}) ` +
        'AND sent_at IS NOT NULL ORDER BY sent_at DESC, id DESC LIMIT 1',
    )
    .bind(network, ...(kind === null ? [] : [kind]), ...statuses)
    .first<SocialPostRecord>();
  return row ? postFromRecord(row) : null;
}

/**
 * Records every `pending` post created before `before` as a failed attempt (`error` = `stale
 * pending`): its run died between the claim and the result, so whether Buffer received it is
 * unknown. The rows then follow the normal retry rule (`getRetryablePosts`, core `canRetryPost`).
 * Call it once per run with `now − SOCIAL_CONFIG.pendingTimeoutMs`; returns the rows changed.
 */
export async function failStalePendingPosts(db: D1DatabaseLike, before: string): Promise<SocialPost[]> {
  const { results } = await db
    .prepare(
      "UPDATE social_posts SET status = 'failed', attempts = attempts + 1, error = 'stale pending' " +
        "WHERE status = 'pending' AND created_at < ? RETURNING *",
    )
    .bind(toStoredUtc(before))
    .all<SocialPostRecord>();
  return results.map(postFromRecord);
}

/** Failed posts with fewer than `maxAttempts` attempts, oldest first (candidates for a retry). */
export async function getRetryablePosts(db: D1DatabaseLike, maxAttempts: number): Promise<SocialPost[]> {
  const { results } = await db
    .prepare("SELECT * FROM social_posts WHERE status = 'failed' AND attempts < ? ORDER BY created_at, id")
    .bind(maxAttempts)
    .all<SocialPostRecord>();
  return results.map(postFromRecord);
}
