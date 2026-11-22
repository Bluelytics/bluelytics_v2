import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { BrowserRunRenderer, CARD_SIZES, RenderError, renderCardHtml, type BrowserRunBinding, type ScreenshotQuickAction } from '../src/index.ts';
import { DEFAULT_CHROME_PATH, LocalChromeRenderer } from '../src/local.ts';
import { UP } from './fixtures.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function fakeBinding(...responses: Response[]): BrowserRunBinding & { requests: ScreenshotQuickAction[] } {
  const requests: ScreenshotQuickAction[] = [];
  return {
    requests,
    async quickAction(action, options) {
      expect(action).toBe('screenshot');
      requests.push(options);
      const next = responses.shift();
      if (!next) throw new Error('unexpected quickAction');
      return next;
    },
  };
}

const rateLimited = (retryAfter?: string) =>
  new Response(JSON.stringify({ success: false, errors: [{ code: 2001, message: 'Rate limit exceeded' }] }), {
    status: 429,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  });

describe('BrowserRunRenderer', () => {
  it('requests a JPEG screenshot at the exact viewport', async () => {
    const binding = fakeBinding(new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } }));
    const bytes = await new BrowserRunRenderer(binding).render('<!doctype html><p>x', CARD_SIZES.portrait);
    expect(bytes).toEqual(JPEG);
    expect(binding.requests).toEqual([
      {
        html: '<!doctype html><p>x',
        viewport: { width: 1080, height: 1350, deviceScaleFactor: 1 },
        screenshotOptions: { type: 'jpeg', quality: 90, fullPage: false },
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30_000 },
        cacheTTL: 0,
      },
    ]);
  });

  it('waits out a short 429 (free plan: one Quick Action per 10 s) and retries', async () => {
    const waits: number[] = [];
    const binding = fakeBinding(rateLimited('7'), rateLimited(), new Response(JPEG));
    const renderer = new BrowserRunRenderer(binding, { sleep: async (ms) => void waits.push(ms) });
    expect(await renderer.render('<p>', CARD_SIZES.landscape)).toEqual(JPEG);
    expect(waits).toEqual([7_000, 10_000]);
  });

  it('fails at once when the wait is too long (daily quota) or retries run out', async () => {
    const sleep = async () => undefined;
    const quota = new BrowserRunRenderer(fakeBinding(rateLimited('3600')), { sleep });
    await expect(quota.render('<p>', CARD_SIZES.og)).rejects.toMatchObject({ status: 429, retryAfterMs: 3_600_000 });

    const busy = new BrowserRunRenderer(fakeBinding(rateLimited('1'), rateLimited('1')), { sleep, maxRetries: 1 });
    const err = await busy.render('<p>', CARD_SIZES.og).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).message).toContain('Rate limit exceeded (2001)');
  });

  it('rejects errors and non-JPEG bodies', async () => {
    const binding = fakeBinding(
      new Response(JSON.stringify({ success: false, errors: [{ message: 'Navigation timeout' }] }), { status: 422 }),
      new Response('not an image', { headers: { 'Content-Type': 'text/plain' } }),
    );
    const renderer = new BrowserRunRenderer(binding);
    await expect(renderer.render('<p>', CARD_SIZES.og)).rejects.toThrow('HTTP 422: Navigation timeout');
    await expect(renderer.render('<p>', CARD_SIZES.og)).rejects.toThrow('expected a JPEG, got text/plain');
  });
});

/** Width and height from the first JPEG start-of-frame marker. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2;
  while (i + 9 < bytes.length) {
    const marker = bytes[i + 1] ?? 0;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0), width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0) };
    }
    i += 2 + length;
  }
  throw new Error('no SOF marker');
}

const chromePath = process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH;

describe.skipIf(!existsSync(chromePath))('LocalChromeRenderer', () => {
  const renderer = new LocalChromeRenderer();
  afterAll(() => renderer.close());

  it.each(['landscape', 'portrait', 'story'] as const)('renders an update card %s as a JPEG of the exact size', async (size) => {
    const bytes = await renderer.render(renderCardHtml('update', size, UP), CARD_SIZES[size]);
    expect(jpegSize(bytes)).toEqual(CARD_SIZES[size]);
  });

  it('renders the og card', async () => {
    const bytes = await renderer.render(renderCardHtml('og', 'og', UP), CARD_SIZES.og);
    expect(jpegSize(bytes)).toEqual({ width: 1200, height: 630 });
  });
});
