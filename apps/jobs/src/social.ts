import type { SocialPost, SocialPostStatus } from '@bluelytics/core';
import { SOCIAL_CONFIG, addSeconds, artDate, artParts, canRetryPost, shouldPost } from '@bluelytics/core';
import {
  failStalePendingPosts,
  getLastSentPost,
  getPreviousClose,
  getRetryablePosts,
  insertPendingPost,
  markPostDryRun,
  markPostFailed,
  markPostSent,
} from '@bluelytics/db';
import type { BufferChannels, CardData, CardKind, CardSize, PostSpec, Viewport } from '@bluelytics/social';
import { BufferClient, parseBufferChannels, planPosts, renderCardHtml, toCreateImagePostInput } from '@bluelytics/social';
import type { Published } from './card-data.ts';
import { updateCardData, weeklyCardData } from './card-data.ts';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';

/** What a post needs to be sent again on a later run: stored next to its image. */
interface PostPayload {
  spec: PostSpec;
  data: CardData;
}

function inWeeklyWindow(now: string): boolean {
  const { isoWeekday, hour } = artParts(now);
  const { weekly } = SOCIAL_CONFIG;
  return isoWeekday === weekly.isoWeekday && hour >= weekly.fromHour && hour < weekly.toHour;
}

/** Suffix of every event key claimed while `SOCIAL_ENABLED` is off. */
export const DRY_RUN_SUFFIX = '-dry';

/** The decision key a stored row was claimed for: without the story and dry-run suffixes. */
const decisionKey = (eventKey: string): string => eventKey.replace(/(-story)?(-dry)?$/, '');

export interface SocialReport {
  /** `<network>/<event_key>` → final status of this run's attempt. */
  attempts: Record<string, string>;
  staleFailed: number;
}

/** R2 key stem of a post: `social/<yyyy>/<mm>/<network>-<event_key>` (ARCHITECTURE §7 step 5), month of its ART day. */
export function postObjectStem(post: Pick<SocialPost, 'network' | 'eventKey' | 'createdAt'>): string {
  const day = artDate(post.createdAt);
  return `social/${day.slice(0, 4)}/${day.slice(5, 7)}/${post.network}-${post.eventKey}`;
}

export const mediaUrl = (deps: Deps, key: string): string => `https://${deps.config.mediaHostname}/${key}`;

/** Renders a card to JPEG and stores it on R2; returns its key. */
export async function storeCard(deps: Deps, spec: { cardKind: CardKind; size: CardSize; viewport: Viewport }, data: CardData, key: string): Promise<string> {
  const jpeg = await deps.renderer.render(renderCardHtml(spec.cardKind, spec.size, data), spec.viewport);
  await deps.bucket.put(key, jpeg, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' } });
  return key;
}

/**
 * One attempt for a claimed (`pending`) or retried (`failed`) row: card → R2 → Buffer, or `dry_run`
 * with `SOCIAL_ENABLED` off (Buffer is never constructed then). Always ends the row in a final status.
 */
async function attemptPost(deps: Deps, post: SocialPost, payload: PostPayload, now: string): Promise<string> {
  const stem = postObjectStem(post);
  let imageKey: string | null = null;
  try {
    imageKey = await storeCard(deps, payload.spec, payload.data, `${stem}.jpg`);
    if (!deps.config.socialEnabled) {
      await markPostDryRun(deps.db, post.id, { at: now, imageKey });
      deps.log('info', 'social dry run', { network: post.network, eventKey: post.eventKey, imageKey });
      return 'dry_run';
    }
    const apiKey = deps.secrets.bufferApiKey;
    if (!apiKey) throw new Error('BUFFER_API_KEY is not set');
    const buffer = new BufferClient({ apiKey, fetch: deps.fetch });
    const sent = await buffer.createImagePost(toCreateImagePostInput(payload.spec, mediaUrl(deps, imageKey)));
    await markPostSent(deps.db, post.id, { sentAt: now, externalId: sent.id, imageKey });
    return 'sent';
  } catch (error) {
    const message = errorText(error);
    await markPostFailed(deps.db, post.id, { error: message, imageKey });
    deps.log('error', 'social post failed', { network: post.network, eventKey: post.eventKey, error: message });
    return 'failed';
  }
}

/**
 * Step 5 of ARCHITECTURE §7 for every network in `BUFFER_CHANNELS`. Idempotency: each post claims
 * `(network, event_key)` as `pending` before anything is sent; a row that already exists is never
 * sent again, except a `failed` one through the retry rule (at most two retries, and only on the
 * day it was created, so an old price is never published). Stories are their own rows (`<key>-story`).
 *
 * Shadow mode (`SOCIAL_ENABLED` off): `dry_run` rows count as sent for the cooldowns and baselines,
 * so the dry runs show what live posting would have done, and their keys end in `-dry`, so they never
 * block a live post. Once enabled only `sent` rows count (MIGRATION.md C9) and `-dry` rows are never retried.
 */
export async function runSocial(deps: Deps, now: string, state: Published): Promise<SocialReport> {
  const { db } = deps;
  const channels = parseBufferChannels(deps.config.bufferChannels);
  const shadow = !deps.config.socialEnabled;
  const baseline: readonly SocialPostStatus[] = shadow ? ['sent', 'dry_run'] : ['sent'];
  const report: SocialReport = { attempts: {}, staleFailed: 0 };
  if (Object.keys(channels).length === 0) return report;

  report.staleFailed = (await failStalePendingPosts(db, addSeconds(now, -SOCIAL_CONFIG.pendingTimeoutMs / 1000))).length;
  for (const post of await getRetryablePosts(db, SOCIAL_CONFIG.maxAttempts)) {
    if (!canRetryPost(post) || artDate(post.createdAt) !== artDate(now) || !(post.network in channels)) continue;
    if (!shadow && post.eventKey.endsWith(DRY_RUN_SUFFIX)) continue;
    const stored = await deps.bucket.get(`${postObjectStem(post)}.json`);
    if (!stored) {
      await markPostFailed(db, post.id, { error: 'retry: payload missing' });
      continue;
    }
    report.attempts[`${post.network}/${post.eventKey}`] = await attemptPost(deps, post, JSON.parse(await stored.text()) as PostPayload, now);
  }

  const previousClose = (await getPreviousClose(db, artDate(now)))?.sell ?? null;
  const cardData: { update?: Promise<CardData>; weekly?: Promise<CardData> } = {};
  for (const network of Object.keys(channels) as (keyof BufferChannels)[]) {
    const [lastUpdate, lastAny, lastWeekly] = await Promise.all([
      getLastSentPost(db, network, 'update', baseline),
      getLastSentPost(db, network, null, baseline),
      getLastSentPost(db, network, 'weekly', baseline),
    ]);
    const update = shouldPost({
      kind: 'update',
      network,
      now,
      sellNow: state.blue.sell,
      lastSent: lastUpdate?.sentAt && lastUpdate.sell !== null ? { sentAt: lastUpdate.sentAt, sell: lastUpdate.sell } : null,
      lastSentAt: lastAny?.sentAt ?? null,
      previousClose,
    });
    const decisions: { kind: 'update' | 'weekly'; eventKey: string }[] = [];
    if (update.post) decisions.push({ kind: 'update', eventKey: update.eventKey });
    // The week's rows are read only in the weekly window; elsewhere the rule answers `outside_window` first.
    const weekSells = inWeeklyWindow(now) ? (await (cardData.weekly ??= weeklyCardData(db, state, now))).series.map((point) => point.sell) : [];
    const weekly = shouldPost({
      kind: 'weekly',
      network,
      now,
      weekSells,
      lastSentEventKey: lastWeekly ? decisionKey(lastWeekly.eventKey) : null,
    });
    if (weekly.post) decisions.push({ kind: 'weekly', eventKey: weekly.eventKey });

    for (const decision of decisions) {
      const data = await (decision.kind === 'update'
        ? (cardData.update ??= updateCardData(db, state, now))
        : (cardData.weekly ??= weeklyCardData(db, state, now)));
      for (const spec of planPosts({ [network]: channels[network] }, { kind: decision.kind, data })) {
        const eventKey = `${decision.eventKey}${spec.postKind === 'story' ? '-story' : ''}${shadow ? DRY_RUN_SUFFIX : ''}`;
        const claim = await insertPendingPost(db, { network, kind: decision.kind, eventKey, createdAt: now, buy: state.blue.buy, sell: state.blue.sell });
        if (!claim.claimed) continue;
        // Stored before the attempt so that a retry on a later run sends exactly this post.
        await deps.bucket.put(`${postObjectStem(claim.post)}.json`, JSON.stringify({ spec, data } satisfies PostPayload), {
          httpMetadata: { contentType: 'application/json' },
        });
        report.attempts[`${network}/${eventKey}`] = await attemptPost(deps, claim.post, { spec, data }, now);
      }
    }
  }
  return report;
}
