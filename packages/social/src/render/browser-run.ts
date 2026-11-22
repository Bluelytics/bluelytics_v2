import type { Viewport } from '../cards/types.ts';
import { parseRetryAfter } from '../retry-after.ts';
import { isJpeg, RenderError, type Renderer } from './types.ts';

/** The Quick Action request this renderer sends (a subset of workers-types' `BrowserRunScreenshotOptions`). */
export interface ScreenshotQuickAction {
  html: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  screenshotOptions: { type: 'jpeg'; quality: number; fullPage: false };
  gotoOptions: { waitUntil: 'networkidle0'; timeout: number };
  cacheTTL: number;
}

/**
 * The part of the Workers Browser Run binding (`"browser": { "binding": "BROWSER" }`, typed
 * `BrowserRun`) used here, declared structurally so this package does not need workers-types at
 * runtime. Requires `compatibility_date` >= 2026-03-24.
 */
export interface BrowserRunBinding {
  quickAction(action: 'screenshot', options: ScreenshotQuickAction): Promise<Response>;
}

export interface BrowserRunRendererOptions {
  /** JPEG quality. Default 90. */
  quality?: number;
  /** Page load timeout in ms (max 60 000). Default 30 000. */
  timeoutMs?: number;
  /**
   * Retries after HTTP 429. Free plan Quick Actions allow one request per 10 s, so a run rendering
   * two sizes hits it. Default 2.
   */
  maxRetries?: number;
  /** Longest `Retry-After` worth waiting for; longer (e.g. the daily quota) fails at once. Default 20 s. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Renders with a Browser Run Quick Action screenshot (`env.BROWSER.quickAction('screenshot', …)`). */
export class BrowserRunRenderer implements Renderer {
  readonly #binding: BrowserRunBinding;
  readonly #quality: number;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxWaitMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;

  constructor(binding: BrowserRunBinding, options: BrowserRunRendererOptions = {}) {
    this.#binding = binding;
    this.#quality = options.quality ?? 90;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#maxWaitMs = options.maxWaitMs ?? 20_000;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
  }

  async render(html: string, viewport: Viewport): Promise<Uint8Array> {
    const request: ScreenshotQuickAction = {
      html,
      viewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: 1 },
      screenshotOptions: { type: 'jpeg', quality: this.#quality, fullPage: false },
      // The card embeds its fonts as data: URIs; networkidle0 also waits for those font loads.
      gotoOptions: { waitUntil: 'networkidle0', timeout: this.#timeoutMs },
      // Every card HTML is unique; a cached screenshot would only ever be stale.
      cacheTTL: 0,
    };
    for (let attempt = 0; ; attempt++) {
      const res = await this.#binding.quickAction('screenshot', request);
      if (res.ok) return this.#readJpeg(res);
      const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'), this.#now());
      const message = await errorMessage(res);
      if (res.status === 429 && attempt < this.#maxRetries && (retryAfterMs ?? 10_000) <= this.#maxWaitMs) {
        await this.#sleep(retryAfterMs ?? 10_000);
        continue;
      }
      const details = retryAfterMs === undefined ? { status: res.status } : { status: res.status, retryAfterMs };
      throw new RenderError(`Browser Run screenshot: HTTP ${res.status}: ${message}`, details);
    }
  }

  async #readJpeg(res: Response): Promise<Uint8Array> {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!isJpeg(bytes)) {
      throw new RenderError(`Browser Run screenshot: expected a JPEG, got ${res.headers.get('Content-Type') ?? 'no content type'}`);
    }
    return bytes;
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { errors?: { message?: string; code?: number }[] };
    const messages = (body.errors ?? []).map((e) => (e.code === undefined ? `${e.message}` : `${e.message} (${e.code})`));
    if (messages.length) return messages.join('; ');
  } catch {
    // not JSON: fall through to the raw text
  }
  return text.slice(0, 200) || res.statusText;
}
