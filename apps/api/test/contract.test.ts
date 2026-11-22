/**
 * Contract: the bundled Worker in workerd, on a D1 seeded from the legacy goldens, answers every
 * capture of `packages/contract/golden-manifest.json` with the same status, content type, CORS
 * headers and body bytes.
 */
import type { GoldenCapture } from '@bluelytics/contract';
import { goldenBody, goldenHeaders, goldenManifest, goldenText } from '@bluelytics/contract/golden';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocalWorker } from './support/worker.ts';
import { startWorker } from './support/worker.ts';

const CAPTURES = goldenManifest();

function requestOf(capture: GoldenCapture): [string, { method: string; headers: Record<string, string> }] {
  const path = capture.query === null ? capture.path : `${capture.path}?${capture.query}`;
  return [path, { method: capture.method, headers: capture.requestHeaders }];
}

/** The golden's value of a header, repeated headers joined like `Headers.get` does. */
function goldenHeader(capture: GoldenCapture, name: string): string | null {
  const values = goldenHeaders(capture.name)
    .headers.filter(([key]) => key === name)
    .map(([, value]) => value);
  return values.length === 0 ? null : values.join(', ');
}

/** Body text with every value replaced by its kind: what must match when the values differ. */
function shape(body: string): string {
  return body
    .replace(/"\d{4}-\d\d-\d\dT[^"]*"/g, '"<time>"')
    .replace(/"alert_id":\d+/g, '"alert_id":<int>')
    .replace(/-?\d+\.\d\d(?=[,}\]])/g, '<number>');
}

async function bytesOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe('legacy contract (LEGACY_V1_BLUE_BUG=true: every capture byte for byte)', () => {
  let worker: LocalWorker;
  beforeAll(async () => {
    worker = await startWorker({ legacyBlueBug: true });
  });
  afterAll(() => worker.dispose());

  it('covers all 27 captures', () => {
    expect(CAPTURES).toHaveLength(27);
  });

  it.each(CAPTURES.map((capture) => [capture.name, capture] as const))('%s', async (_name, capture) => {
    const response = await worker.fetch(...requestOf(capture));
    expect(response.status).toBe(capture.status);
    expect(response.headers.get('content-type')).toBe(capture.contentType);
    for (const name of ['access-control-allow-origin', 'access-control-allow-methods', 'vary']) {
      expect(response.headers.get(name), name).toBe(goldenHeader(capture, name));
    }
    const body = await bytesOf(response);
    expect(body.length).toBe(capture.bytes);
    expect(body.equals(Buffer.from(goldenBody(capture.name))), `${capture.name} body bytes`).toBe(true);
  });
});

describe('legacy contract (default flags: time-varying captures structurally)', () => {
  let worker: LocalWorker;
  beforeAll(async () => {
    worker = await startWorker();
  });
  afterAll(() => worker.dispose());

  const timeVarying = CAPTURES.filter((capture) => capture.body === 'time-varying');

  it('has the six time-varying captures', () => {
    expect(timeVarying.map((capture) => capture.name).sort()).toEqual(
      ['origin', 'v1_last_price', 'v1_last_price_jsonp', 'v2_alerts', 'v2_latest', 'v2_latest_jsonp'].sort(),
    );
  });

  it.each(timeVarying.map((capture) => [capture.name, capture] as const))('%s', async (_name, capture) => {
    const response = await worker.fetch(...requestOf(capture));
    expect(response.status).toBe(capture.status);
    expect(response.headers.get('content-type')).toBe(capture.contentType);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(shape(await response.text())).toBe(shape(goldenText(capture.name)));
  });

  it('fixes the /json/last_price blue entry (ARCHITECTURE §2 change 4)', async () => {
    const latest = JSON.parse(goldenText('v2_latest')) as { blue: Record<string, number> };
    const response = await worker.fetch('/json/last_price');
    const [oficial, blue] = JSON.parse(await response.text()) as Record<string, unknown>[];
    expect(oficial?.['source']).toBe('oficial');
    expect(blue).toMatchObject({ source: 'blue', ...latest.blue });
  });

  it('keeps the Content-Length on HEAD in workerd', async () => {
    for (const path of ['/v2/latest', '/v2/evolution.json']) {
      const getBytes = (await bytesOf(await worker.fetch(path))).length;
      const head = await worker.fetch(path, { method: 'HEAD' });
      expect(head.headers.get('content-length'), path).toBe(String(getBytes));
    }
  });

  it('serves the static captures byte for byte too', async () => {
    for (const capture of CAPTURES.filter((entry) => entry.body === 'static')) {
      const body = await bytesOf(await worker.fetch(...requestOf(capture)));
      expect(body.equals(Buffer.from(goldenBody(capture.name))), capture.name).toBe(true);
    }
  });
});
