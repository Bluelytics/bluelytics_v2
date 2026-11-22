import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CARD_KIND_SIZES, type Renderer, type Viewport } from '@bluelytics/social';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_SCENARIOS, renderPreviews } from '../src/cards-preview.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cards-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

class FakeRenderer implements Renderer {
  readonly calls: { html: string; viewport: Viewport }[] = [];
  readonly bytes: Uint8Array;
  constructor(bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])) {
    this.bytes = bytes;
  }
  render(html: string, viewport: Viewport): Promise<Uint8Array> {
    this.calls.push({ html, viewport });
    return Promise.resolve(this.bytes);
  }
}

describe('cards:preview', () => {
  it('renders every kind, size and scenario to <kind>-<size>-<scenario>.jpg', async () => {
    const renderer = new FakeRenderer();
    const files = await renderPreviews(renderer, dir);
    const expected = Object.entries(CARD_KIND_SIZES).flatMap(([kind, sizes]) =>
      sizes.flatMap((size) => Object.keys(CARD_SCENARIOS[kind as keyof typeof CARD_SCENARIOS]).map((scenario) => `${kind}-${size}-${scenario}.jpg`)),
    );
    expect(files.map((file) => basename(file))).toEqual(expected);
    expect(readdirSync(dir).sort()).toEqual([...expected].sort());
    expect(renderer.calls.find((call) => call.viewport.width === 1080 && call.viewport.height === 1350)?.html).toContain('<html');
    expect(renderer.calls.map((call) => `${call.viewport.width}x${call.viewport.height}`)).toEqual(expect.arrayContaining(['1600x900', '1080x1350', '1080x1920', '1200x630']));
  });

  it('refuses output that is not a JPEG', async () => {
    await expect(renderPreviews(new FakeRenderer(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), dir)).rejects.toThrow(/did not return a JPEG/);
  });
});
