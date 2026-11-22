import type { Viewport } from '../cards/types.ts';

/** Turns a self-contained HTML document into a JPEG of exactly `viewport` pixels. */
export interface Renderer {
  render(html: string, viewport: Viewport): Promise<Uint8Array>;
}

export class RenderError extends Error {
  override readonly name = 'RenderError';
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, details: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
  }
}

/** JPEG files start with the SOI marker followed by another marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
