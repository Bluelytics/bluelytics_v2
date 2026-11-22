import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR, goldenBody, goldenCapture, goldenHeaders, goldenManifest, goldenRequest, goldenText } from '../src/golden.ts';
import { GOLDEN_NAMES } from '../src/index.ts';

describe('golden-manifest.json', () => {
  const manifest = goldenManifest();

  it('lists every capture file exactly once, in GOLDEN_NAMES order; golden/ holds nothing else', () => {
    expect(manifest.map((capture) => capture.name)).toEqual([...GOLDEN_NAMES]);
    const files = readdirSync(GOLDEN_DIR);
    const expected = GOLDEN_NAMES.flatMap((name) => [`${name}.body`, `${name}.headers`]);
    expect(files.sort()).toEqual(expected.sort());
  });

  it('matches the size, hash, status and content type of each capture', () => {
    for (const capture of manifest) {
      const body = goldenBody(capture.name);
      expect(body.length, capture.name).toBe(capture.bytes);
      expect(createHash('sha256').update(body).digest('hex'), capture.name).toBe(capture.sha256);
      const { status, headers } = goldenHeaders(capture.name);
      expect(status, capture.name).toBe(capture.status);
      expect(headers.find(([name]) => name === 'content-type')?.[1] ?? null, capture.name).toBe(capture.contentType);
      expect(capture.body === 'empty', capture.name).toBe(capture.bytes === 0);
    }
  });

  it('marks exactly the scrape-dependent captures as time-varying', () => {
    expect(manifest.filter((capture) => capture.body === 'time-varying').map((capture) => capture.name)).toEqual([
      'v2_latest',
      'origin',
      'v2_latest_jsonp',
      'v2_alerts',
      'v1_last_price',
      'v1_last_price_jsonp',
    ]);
  });

  it('records the CORS headers of every capture', () => {
    for (const capture of manifest) {
      const { headers } = goldenHeaders(capture.name);
      expect(headers.filter(([name]) => name === 'access-control-allow-origin'), capture.name).toEqual([['access-control-allow-origin', '*']]);
      const vary = headers.filter(([name]) => name === 'vary').map(([, value]) => value);
      expect(vary, capture.name).toEqual(
        capture.method === 'OPTIONS' ? ['Origin', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'] : ['Origin'],
      );
    }
  });
});

describe('golden helpers', () => {
  it('decodes bodies as UTF-8', () => {
    expect(goldenText('root')).toBe('OK');
    expect(goldenText('currency')).toContain('"name":"Paʻanga"');
  });

  it('builds a replay request', () => {
    const request = goldenRequest('v2_latest_jsonp', 'http://localhost:8787');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('http://localhost:8787/v2/latest?callback=myCb');
    expect(goldenRequest('origin', 'http://x').headers.get('origin')).toBe('https://bluelytics.com.ar');
    expect(goldenRequest('post', 'http://x').method).toBe('POST');
    expect(goldenRequest('latest_slash', 'http://x').url).toBe('http://x/v2/latest/');
  });

  it('rejects names missing from the manifest', () => {
    expect(() => goldenCapture('nope' as 'root')).toThrow(/not in golden-manifest.json/);
  });
});
