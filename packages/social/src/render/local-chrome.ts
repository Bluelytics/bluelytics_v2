// Node only (dev previews and tests): exported from '@bluelytics/social/local', never from the
// Worker entry.
import { chromium, type Browser } from 'playwright-core';
import type { Viewport } from '../cards/types.ts';
import { isJpeg, RenderError, type Renderer } from './types.ts';

export const DEFAULT_CHROME_PATH = '/usr/bin/google-chrome-stable';

export interface LocalChromeRendererOptions {
  /** Default: `$CHROME_PATH`, else {@link DEFAULT_CHROME_PATH}. */
  executablePath?: string;
  /** JPEG quality. Default 90. */
  quality?: number;
}

/** Renders with a local Chrome through playwright-core. One browser is started lazily and reused; call `close()`. */
export class LocalChromeRenderer implements Renderer, AsyncDisposable {
  readonly #executablePath: string;
  readonly #quality: number;
  #browser: Promise<Browser> | undefined;

  constructor(options: LocalChromeRendererOptions = {}) {
    this.#executablePath = options.executablePath ?? process.env.CHROME_PATH ?? DEFAULT_CHROME_PATH;
    this.#quality = options.quality ?? 90;
  }

  async render(html: string, viewport: Viewport): Promise<Uint8Array> {
    this.#browser ??= chromium.launch({
      executablePath: this.#executablePath,
      // Grayscale antialiasing, like the headless Chrome behind Browser Run.
      args: ['--font-render-hinting=none', '--disable-lcd-text'],
    });
    const browser = await this.#browser;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    try {
      // Cards must be self-contained: refuse every network request (data: URIs are not routed).
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready.then(() => undefined)');
      const bytes = await page.screenshot({
        type: 'jpeg',
        quality: this.#quality,
        clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      });
      if (!isJpeg(bytes)) throw new RenderError('Local Chrome screenshot is not a JPEG');
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    const browser = this.#browser;
    this.#browser = undefined;
    if (browser) await (await browser).close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
