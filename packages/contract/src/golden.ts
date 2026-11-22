import { readFileSync } from 'node:fs';
import type { GoldenCapture, GoldenName } from './manifest.ts';

/** Directory of the byte-exact captures (`<name>.body`, `<name>.headers`) and nothing else. Read-only. */
export const GOLDEN_DIR = new URL('../golden/', import.meta.url);

/** Description of every capture; kept outside `golden/` so that directory holds only capture files. */
export const GOLDEN_MANIFEST = new URL('../golden-manifest.json', import.meta.url);

interface ManifestFile {
  captures: GoldenCapture[];
}

let manifestCache: readonly GoldenCapture[] | undefined;

/** Every capture described in `golden-manifest.json`, in manifest order. */
export function goldenManifest(): readonly GoldenCapture[] {
  manifestCache ??= (JSON.parse(readFileSync(GOLDEN_MANIFEST, 'utf8')) as ManifestFile).captures;
  return manifestCache;
}

/** The manifest entry of one capture. */
export function goldenCapture(name: GoldenName): GoldenCapture {
  const capture = goldenManifest().find((entry) => entry.name === name);
  if (!capture) throw new Error(`golden: ${name} is not in golden-manifest.json`);
  return capture;
}

/** Raw response bytes of a capture. */
export function goldenBody(name: GoldenName): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`${name}.body`, GOLDEN_DIR)));
}

/** Response body of a capture decoded as UTF-8 (every capture is valid UTF-8). */
export function goldenText(name: GoldenName): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(goldenBody(name));
}

export interface GoldenHeaders {
  status: number;
  /** In capture order, names lower-cased; repeated headers (e.g. `vary` on OPTIONS) stay separate. */
  headers: [string, string][];
}

/** Status and response headers of a capture, parsed from `<name>.headers` (HTTP/2 status line + headers). */
export function goldenHeaders(name: GoldenName): GoldenHeaders {
  const lines = readFileSync(new URL(`${name}.headers`, GOLDEN_DIR), 'utf8').split(/\r?\n/);
  const status = Number(lines[0]?.split(' ')[1]);
  if (!Number.isInteger(status)) throw new Error(`golden: ${name}.headers has no status line`);
  const headers: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.push([line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { status, headers };
}

/** A `Request` that replays a capture against `baseUrl` (e.g. a local Worker). */
export function goldenRequest(name: GoldenName, baseUrl: string): Request {
  const capture = goldenCapture(name);
  const url = new URL(capture.path, baseUrl);
  if (capture.query !== null) url.search = capture.query;
  return new Request(url, { method: capture.method, headers: capture.requestHeaders });
}
