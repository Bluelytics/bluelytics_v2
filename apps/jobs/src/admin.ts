import { addSeconds, artDate, buildAlertNotification, epochMs, toStoredUtc } from '@bluelytics/core';
import { getLatestAlerts, getLatestRates, getRenderedEtags, getSourceHealth, getState } from '@bluelytics/db';
import type { CardKind, CardSize } from '@bluelytics/social';
import { BufferClient, CARD_KIND_SIZES, parseBufferChannels, planPosts, renderCardHtml, toCreateImagePostInput } from '@bluelytics/social';
import { isPublished, updateCardData, weeklyCardData } from './card-data.ts';
import { DAILY_STATE_KEY } from './daily.ts';
import type { Deps } from './deps.ts';
import { errorText } from './errors.ts';
import { sendPush } from './fcm.ts';
import { MAX_CONSECUTIVE_FAILURES } from './ops.ts';
import { LAST_RUN_STATE_KEY, runJobs } from './run.ts';
import { mediaUrl, storeCard } from './social.ts';
import { missingPurgeConfig } from './static-api.ts';

const json = (body: unknown, status = 200): Response =>
  new Response(`${JSON.stringify(body, null, 2)}\n`, { status, headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' } });

const notFound = (): Response => new Response('404 page not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=UTF-8' } });

/** Compares in time independent of where the strings differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] as number);
  return diff === 0;
}

export function isAuthorized(request: Request, adminToken: string | undefined): boolean {
  if (!adminToken) return false;
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && sameSecret(header.slice(7), adminToken);
}

/**
 * The admin API (ARCHITECTURE §7, MIGRATION.md 2.4–2.7, 4.10). Every route needs
 * `Authorization: Bearer $ADMIN_TOKEN`; without it, or without the secret, everything is 404.
 */
export async function handleAdmin(request: Request, deps: Deps, adminToken: string | undefined, now: string): Promise<Response> {
  if (!isAuthorized(request, adminToken)) return notFound();
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  try {
    switch (route) {
      case 'POST /admin/run':
        return json(await runJobs(deps, now, { force: url.searchParams.get('force') === '1' }));
      case 'GET /admin/health':
        return json(await health(deps, now));
      case 'GET /admin/card':
        return await card(deps, url, now);
      case 'POST /admin/social/test':
        return json(await socialTest(deps, now));
      case 'POST /admin/push/test':
        return json(await pushTest(deps, now));
      default:
        return notFound();
    }
  } catch (error) {
    deps.log('error', 'admin request failed', { route, error: errorText(error) });
    return json({ error: errorText(error) }, 500);
  }
}

async function health(deps: Deps, now: string) {
  const { db, config } = deps;
  const [lastRun, daily, latest, rendered, sources] = await Promise.all([
    getState(db, LAST_RUN_STATE_KEY),
    getState(db, DAILY_STATE_KEY),
    getLatestRates(db),
    getRenderedEtags(db),
    getSourceHealth(db, addSeconds(now, -86_400)),
  ]);
  let channels: string[] | { error: string };
  try {
    channels = Object.keys(parseBufferChannels(config.bufferChannels));
  } catch (error) {
    channels = { error: errorText(error) };
  }
  return {
    now,
    flags: {
      PUSH_ENABLED: config.pushEnabled,
      SOCIAL_ENABLED: config.socialEnabled,
      API_MODE: config.apiMode,
      LEGACY_V1_BLUE_BUG: config.legacyBlueBug,
    },
    ...(config.apiMode === 'static-first' ? { staticFirstMissing: missingPurgeConfig(deps) } : {}),
    channels,
    lastRun: lastRun && { updatedAt: lastRun.updatedAt, ...(JSON.parse(lastRun.value) as object) },
    dailyLastDay: daily?.value ?? null,
    latest,
    rendered,
    sources: sources.map((row) => ({
      status: row.lastOkAt === row.lastRunAt ? 'ok' : row.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'failing' : 'degraded',
      ...row,
    })),
  };
}

async function currentState(deps: Deps) {
  const state = await getLatestRates(deps.db);
  if (!isPublished(state)) throw new Error('latest_rates has no blue and oficial rates yet');
  return state;
}

async function card(deps: Deps, url: URL, now: string): Promise<Response> {
  const kind = (url.searchParams.get('kind') ?? 'update') as CardKind;
  const size = (url.searchParams.get('size') ?? 'portrait') as CardSize;
  const sizes: readonly CardSize[] | undefined = CARD_KIND_SIZES[kind];
  if (!sizes) return json({ error: 'kind must be update, weekly or og' }, 400);
  if (!sizes.includes(size)) return json({ error: `size for ${kind} must be one of ${sizes.join(', ')}` }, 400);
  const state = await currentState(deps);
  const data = kind === 'weekly' ? await weeklyCardData(deps.db, state, now) : await updateCardData(deps.db, state, now);
  return new Response(renderCardHtml(kind, size, data), { headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' } });
}

/** One Buffer **draft** per planned post (never published, no `social_posts` row), whatever `SOCIAL_ENABLED` says. */
async function socialTest(deps: Deps, now: string) {
  const channels = parseBufferChannels(deps.config.bufferChannels);
  const apiKey = deps.secrets.bufferApiKey;
  if (!apiKey) throw new Error('BUFFER_API_KEY is not set');
  const data = await updateCardData(deps.db, await currentState(deps), now);
  const buffer = new BufferClient({ apiKey, fetch: deps.fetch });
  const stamp = toStoredUtc(now).replace(/[-:]|\.\d+/g, '');
  const day = artDate(now);
  const results = [];
  for (const spec of planPosts(channels, { kind: 'update', data })) {
    const key = `social/${day.slice(0, 4)}/${day.slice(5, 7)}/test-${spec.network}-${spec.postKind}-${stamp}.jpg`;
    try {
      await storeCard(deps, spec, data, key);
      const post = await buffer.createImagePost(toCreateImagePostInput(spec, mediaUrl(deps, key), { draft: true }));
      results.push({ network: spec.network, postKind: spec.postKind, ok: true, draftId: post.id, status: post.status, imageUrl: mediaUrl(deps, key) });
    } catch (error) {
      results.push({ network: spec.network, postKind: spec.postKind, ok: false, error: errorText(error) });
    }
  }
  return { drafts: results };
}

/** FCM `validate_only` with the deployed secret and the current price: checks key, OAuth and payload, delivers nothing. */
async function pushTest(deps: Deps, now: string) {
  const state = await currentState(deps);
  const { current } = await getLatestAlerts(deps.db);
  const notification = buildAlertNotification(state.blue.sell, current?.sell ?? state.blue.sell);
  try {
    const name = await sendPush(notification, {
      fetch: deps.fetch,
      serviceAccountJson: deps.secrets.firebaseServiceAccountJson,
      nowMs: epochMs(now),
      validateOnly: true,
    });
    return { ok: true, validateOnly: true, name, notification };
  } catch (error) {
    return { ok: false, validateOnly: true, error: errorText(error), notification };
  }
}
