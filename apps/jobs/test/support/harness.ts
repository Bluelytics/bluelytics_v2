/**
 * Test harness: a real local D1 (Miniflare) seeded from the legacy goldens, and fakes for every
 * external effect: one recording `fetch` routing by host (sources, currencies, Buffer, Google
 * OAuth, FCM, the ops webhook, the purge API), an in-memory R2 bucket and a renderer.
 */
import { readFileSync } from 'node:fs';
import type { D1DatabaseLike } from '@bluelytics/db';
import { createLocalD1, seedFromGoldens } from '@bluelytics/db/testing';
import type { Source } from '@bluelytics/scrapers';
import { infobae, TICK_SOURCES } from '@bluelytics/scrapers';
import type { Renderer, Viewport } from '@bluelytics/social';
import type { Deps, LogLevel } from '../../src/deps.ts';
import type { Env, MediaBucket } from '../../src/env.ts';
import { readConfig, readSecrets } from '../../src/env.ts';
import type { RunReport } from '../../src/run.ts';
import { runJobs } from '../../src/run.ts';

const FIXTURES = new URL('../../../../packages/scrapers/test/fixtures/', import.meta.url);
export const fixture = (name: string): string => readFileSync(new URL(name, FIXTURES), 'utf8');

/** A source's answer for the next runs: whole-peso quotes, or a failure. */
export type Quote = { buy: number; sell: number } | 'down';

/** Real ids, kinds and URLs; the body is `{"buy":…,"sell":…}` so a scenario can set any price. Parsers are tested in scrapers. */
// infobae is not in production's TICK_SOURCES (blocked from Cloudflare) but stays scripted here so the
// Cronista-substitute logic keeps its tests.
export const SCRIPTED_SOURCES: readonly Source[] = [...TICK_SOURCES, infobae].map((source) => ({
  ...source,
  format: 'json',
  parse(text: string) {
    const { buy, sell } = JSON.parse(text) as { buy: number; sell: number };
    return { buyCents: buy * 100, sellCents: sell * 100, sourceTs: null };
  },
}));

export interface Call {
  url: string;
  host: string;
  method: string;
  headers: Headers;
  body: string;
}

export interface Net {
  calls: Call[];
  /** Per source id (sources missing here fail with HTTP 503). */
  market: Map<string, Quote>;
  /** Overrides by exact URL (fixtures served verbatim). */
  pages: Map<string, string | (() => Response)>;
  buffer: { fail?: string; nextId: number };
  fcm: { status: number };
  callsTo(host: string): Call[];
  fetch(url: string, init: RequestInit): Promise<Response>;
}

export const EXTERNAL_HOSTS = ['api.buffer.com', 'oauth2.googleapis.com', 'fcm.googleapis.com', 'ops.example', 'api.cloudflare.com'];

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createNet(): Net {
  const net: Net = {
    calls: [],
    market: new Map(),
    pages: new Map(),
    buffer: { nextId: 1 },
    fcm: { status: 200 },
    callsTo: (host) => net.calls.filter((call) => call.host === host),
    async fetch(url, init) {
      const body = typeof init.body === 'string' ? init.body : '';
      const host = new URL(url).host;
      net.calls.push({ url, host, method: init.method ?? 'GET', headers: new Headers(init.headers), body });
      const page = net.pages.get(url);
      if (page !== undefined) return typeof page === 'string' ? new Response(page) : page();
      const source = SCRIPTED_SOURCES.find((candidate) => candidate.url === url);
      if (source) {
        const quote = net.market.get(source.id);
        return quote === undefined || quote === 'down' ? new Response('unavailable', { status: 503 }) : json(quote);
      }
      switch (host) {
        case 'api.buffer.com': {
          if (net.buffer.fail) return json({ errors: [{ message: net.buffer.fail, extensions: { code: 'UNAUTHORIZED' } }] });
          const input = (JSON.parse(body) as { variables: { input: { channelId: string; text?: string; saveToDraft?: boolean } } }).variables.input;
          const post = {
            id: `post-${net.buffer.nextId++}`,
            status: input.saveToDraft ? 'draft' : 'sending',
            text: input.text ?? '',
            channelId: input.channelId,
            channelService: 'twitter',
            dueAt: null,
            sentAt: null,
            externalLink: null,
            error: null,
          };
          return json({ data: { createPost: { __typename: 'PostActionSuccess', post } } });
        }
        case 'oauth2.googleapis.com':
          return json({ access_token: 'test-access-token', expires_in: 3599, token_type: 'Bearer' });
        case 'fcm.googleapis.com':
          return net.fcm.status === 200
            ? json({ name: 'projects/bluelytics-mobile/messages/0:1' })
            : json({ error: { code: net.fcm.status, message: 'denied' } }, net.fcm.status);
        case 'ops.example':
        case 'api.cloudflare.com':
          return json({ success: true });
        default:
          return new Response('not found', { status: 404 });
      }
    },
  };
  return net;
}

export interface StoredObject {
  value: string | Uint8Array;
  contentType: string | undefined;
  cacheControl: string | undefined;
}

export function createBucket(): MediaBucket & { objects: Map<string, StoredObject>; failPuts: boolean } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    failPuts: false,
    async put(key, value, options) {
      if (this.failPuts) throw new Error('simulated crash: R2 put');
      const stored = typeof value === 'string' ? value : value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { value: stored, contentType: options?.httpMetadata?.contentType, cacheControl: options?.httpMetadata?.cacheControl });
      return {};
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { text: async () => (typeof object.value === 'string' ? object.value : new TextDecoder().decode(object.value)) };
    },
  };
}

export const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

/** `hang` never resolves: the invocation "dies" mid-render (a crash between the claim and the result). */
export function createRenderer(): Renderer & { renders: { html: string; viewport: Viewport }[]; mode: 'ok' | 'hang' | 'fail' } {
  const renders: { html: string; viewport: Viewport }[] = [];
  return {
    renders,
    mode: 'ok',
    render(html, viewport) {
      renders.push({ html, viewport });
      if (this.mode === 'hang') return new Promise<Uint8Array>(() => {});
      if (this.mode === 'fail') return Promise.reject(new Error('Browser Run 429: Browser time limit exceeded for today'));
      return Promise.resolve(FAKE_JPEG);
    },
  };
}

export interface Harness {
  db: D1DatabaseLike;
  net: Net;
  bucket: ReturnType<typeof createBucket>;
  renderer: ReturnType<typeof createRenderer>;
  logs: { level: LogLevel; message: string }[];
  deps: Deps;
  run(at: string, options?: { force?: boolean }): Promise<RunReport>;
  /** Sets every blue primary (plus infobae and lanacion) to one quote. */
  setBlue(quote: Quote): void;
  rows<T = Record<string, unknown>>(sql: string, ...values: (string | number)[]): Promise<T[]>;
  dispose(): Promise<void>;
}

export const BLUE_SOURCES = ['ambito', 'dolarhoy', 'cronista', 'infodolar', 'infobae', 'lanacion'];

export async function createHarness(env: Partial<Env> = {}, options: { seed?: boolean } = {}): Promise<Harness> {
  const local = await createLocalD1();
  if (options.seed !== false) await seedFromGoldens(local.db);
  const net = createNet();
  const bucket = createBucket();
  const renderer = createRenderer();
  const logs: Harness['logs'] = [];
  const fullEnv = {
    PUSH_ENABLED: 'false',
    SOCIAL_ENABLED: 'false',
    BUFFER_CHANNELS: '{"twitter":"chan-x","instagram":"chan-ig"}',
    ...env,
  } as Env;
  const deps: Deps = {
    db: local.db,
    bucket,
    renderer,
    fetch: (url, init) => net.fetch(url, init),
    config: readConfig(fullEnv),
    secrets: readSecrets(fullEnv),
    sources: SCRIPTED_SOURCES,
    log: (level, message) => logs.push({ level, message }),
  };
  return {
    db: local.db,
    net,
    bucket,
    renderer,
    logs,
    deps,
    run: (at, runOptions) => runJobs(deps, at, runOptions),
    setBlue(quote) {
      for (const id of BLUE_SOURCES) net.market.set(id, quote);
    },
    async rows<T>(sql: string, ...values: (string | number)[]) {
      return (await local.db.prepare(sql).bind(...values).all<T>()).results;
    },
    dispose: () => local.dispose(),
  };
}

/** `HH:MM` Argentine time on `day` as a storage-form UTC instant (ART = UTC−3). */
export function art(day: string, time: string): string {
  return new Date(`${day}T${time}:00.000-03:00`).toISOString();
}
