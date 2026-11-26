import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cacheableRequest, finalizeResponse, isMcpRequest, legacyResponse } from '../src/lib/gateway.ts';

// sha256 of legacy/bluelytics_frontend/privacy.html: tests never read legacy/ (ARCHITECTURE D10).
const LEGACY_POLICY_SHA256 = 'afe012bdca471faf087ba0b562a90a06b4f8db17ec764f64803f05e76085034b';

describe('gateway', () => {
  it('moves the retired evolution pages to the history hub with a 301', () => {
    for (const [from, to] of [['/evolucion', '/historico'], ['/en/evolution', '/en/history'], ['/evolucion/', '/historico']]) {
      const response = legacyResponse(new Request(`https://bluelytics.com.ar${from}`));
      expect(response?.status).toBe(301);
      expect(response?.headers.get('Location')).toBe(to);
    }
    expect(legacyResponse(new Request('https://bluelytics.com.ar/historico'))).toBeNull();
  });

  it('marks every non-production host noindex', () => {
    const page = () => new Response('ok', { headers: { 'Content-Type': 'text/html' } });
    const shadow = finalizeResponse(new Request('https://v2.bluelytics.com.ar/'), page(), 'bluelytics.com.ar');
    const production = finalizeResponse(new Request('https://bluelytics.com.ar/'), page(), 'bluelytics.com.ar');
    expect(shadow.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(production.headers.get('X-Robots-Tag')).toBeNull();
    expect(production.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('drops tracking parameters before the cached entrypoint', () => {
    expect(cacheableRequest(new Request('https://bluelytics.com.ar/?utm_source=x&fbclid=1')).url).toBe('https://bluelytics.com.ar/');
    expect(cacheableRequest(new Request('https://bluelytics.com.ar/widget?lang=en&gclid=2')).url).toBe('https://bluelytics.com.ar/widget?lang=en');
    const post = new Request('https://bluelytics.com.ar/?utm_source=x', { method: 'POST' });
    expect(cacheableRequest(post)).toBe(post);
  });

  it('serves /privacy.html byte for byte from the legacy frontend', async () => {
    const response = legacyResponse(new Request('https://bluelytics.com.ar/privacy.html'));
    expect(response?.status).toBe(200);
    const body = new Uint8Array(await (response as Response).arrayBuffer());
    expect(createHash('sha256').update(body).digest('hex')).toBe(LEGACY_POLICY_SHA256);
  });

  it('redirects /index.html home and leaves other paths to Astro', () => {
    const response = legacyResponse(new Request('https://bluelytics.com.ar/index.html'));
    expect(response?.status).toBe(301);
    expect(response?.headers.get('Location')).toBe('/');
    expect(legacyResponse(new Request('https://bluelytics.com.ar/'))).toBeNull();
  });
});

describe('MCP on /mcp', () => {
  const req = (method: string, path = '/mcp', headers: Record<string, string> = {}) => new Request(`https://bluelytics.com.ar${path}`, { method, headers });

  it('sends client traffic to the MCP server', () => {
    expect(isMcpRequest(req('POST'))).toBe(true);
    expect(isMcpRequest(req('OPTIONS'))).toBe(true);
    expect(isMcpRequest(req('DELETE'))).toBe(true);
    expect(isMcpRequest(req('GET', '/mcp', { Accept: 'text/event-stream' }))).toBe(true);
  });

  it('leaves the documentation page and every other path to the site', () => {
    expect(isMcpRequest(req('GET', '/mcp', { Accept: 'text/html,application/xhtml+xml' }))).toBe(false);
    expect(isMcpRequest(req('HEAD'))).toBe(false);
    expect(isMcpRequest(req('POST', '/en/mcp'))).toBe(false);
    expect(isMcpRequest(req('POST', '/mcp/'))).toBe(false);
    expect(isMcpRequest(req('POST', '/api'))).toBe(false);
  });
});
