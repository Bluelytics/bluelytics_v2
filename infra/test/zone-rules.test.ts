import { describe, expect, it } from 'vitest';
import type { InfraConfig } from '../src/config.ts';
import { PRESERVED_RULES } from '../src/preserved-rules.ts';
import { buildZoneRules, STATIC_API_PATHS, type RulesetRule, type ZoneRules } from '../src/zone-rules.ts';

const CONFIG: InfraConfig = {
  accountId: '0123456789abcdef0123456789abcdef',
  zoneId: 'fedcba9876543210fedcba9876543210',
  zoneName: 'bluelytics.com.ar',
  webHostname: 'bluelytics.com.ar',
  apiHostname: 'api.bluelytics.com.ar',
  mediaHostname: 'media.bluelytics.com.ar',
  apiMode: 'worker',
  manageRulesets: true,
  adopt: {},
};
const STATIC_FIRST: InfraConfig = { ...CONFIG, apiMode: 'static-first' };
const EMPTY: ZoneRules = { rulesets: { redirect: [], cache: [], transform: [], responseHeaders: [] }, cloudConnector: [] };

const refs = (rules: RulesetRule[]) => rules.map((rule) => rule.ref);

describe('buildZoneRules', () => {
  it('ships with no preserved rules', () => {
    expect(PRESERVED_RULES).toEqual(EMPTY);
  });

  it('worker mode: only the www redirect and the media cache rules', () => {
    const { rulesets, cloudConnector } = buildZoneRules(CONFIG, EMPTY);
    expect(refs(rulesets.redirect)).toEqual(['www_to_apex']);
    expect(refs(rulesets.cache)).toEqual(['media_cache_default', 'media_cache_social']);
    expect(rulesets.transform).toEqual([]);
    expect(rulesets.responseHeaders).toEqual([]);
    expect(cloudConnector).toEqual([]);
  });

  it('redirects www to the site hostname keeping path and query', () => {
    const [rule] = buildZoneRules({ ...CONFIG, webHostname: 'v2.bluelytics.com.ar' }, EMPTY).rulesets.redirect;
    expect(rule).toMatchObject({
      expression: '(http.host eq "www.bluelytics.com.ar")',
      action: 'redirect',
      actionParameters: {
        fromValue: {
          statusCode: 301,
          preserveQueryString: true,
          targetUrl: { expression: 'concat("https://v2.bluelytics.com.ar", http.request.uri.path)' },
        },
      },
    });
  });

  it('caches the media hostname, social cards longest', () => {
    const [base, social] = buildZoneRules(CONFIG, EMPTY).rulesets.cache;
    expect(base?.expression).toBe('(http.host eq "media.bluelytics.com.ar")');
    expect(social?.expression).toBe('(http.host eq "media.bluelytics.com.ar" and starts_with(http.request.uri.path, "/social/"))');
    expect(social?.actionParameters).toMatchObject({ cache: true, edgeTtl: { mode: 'override_origin', default: 30 * 86400 } });
  });

  it('static-first: rewrite to the R2 key, cache, CORS and Cloud Connector to the media bucket', () => {
    const { rulesets, cloudConnector } = buildZoneRules(STATIC_FIRST, EMPTY);
    const paths = Object.keys(STATIC_API_PATHS);
    const pathSet = `{${paths.map((p) => `"${p}"`).join(' ')}}`;

    expect(rulesets.transform).toEqual([
      expect.objectContaining({
        ref: 'api_static_r2_key',
        expression: `(http.host eq "api.bluelytics.com.ar" and http.request.uri.query eq "" and http.request.uri.path in ${pathSet})`,
        actionParameters: { uri: { path: { expression: 'concat("/api", http.request.uri.path)' } } },
      }),
    ]);

    expect(refs(rulesets.cache)).toEqual(['media_cache_default', 'media_cache_social', 'api_static_browser_30s', 'api_static_browser_300s']);
    const hot = rulesets.cache[2];
    expect(hot?.expression).toBe(
      '(http.host eq "api.bluelytics.com.ar" and http.request.uri.query eq "" and ' +
        '(http.request.uri.path in {"/v2/latest" "/v2/alerts" "/json/last_price"} or ' +
        'http.request.uri.path in {"/api/v2/latest" "/api/v2/alerts" "/api/json/last_price"}))',
    );
    expect(hot?.actionParameters).toMatchObject({ edgeTtl: { default: 7200 }, browserTtl: { mode: 'override_origin', default: 30 } });
    expect(rulesets.cache[3]?.expression).toContain('"/v2/evolution.json" "/v2/evolution.csv" "/data/json/currency.json"');

    expect(rulesets.responseHeaders[0]?.actionParameters).toEqual({
      headers: { 'Access-Control-Allow-Origin': { operation: 'set', value: '*' }, Vary: { operation: 'set', value: 'Origin' } },
    });

    expect(cloudConnector).toEqual([
      expect.objectContaining({ cloudConnectorRulesProvider: 'cloudflare_r2', enabled: true, parameters: { host: 'media.bluelytics.com.ar' } }),
    ]);
    expect(cloudConnector[0]?.expression).toContain('"/api/data/json/currency.json"');
  });

  it('keeps preserved rules first in their phase', () => {
    const kept: RulesetRule = { ref: 'legacy_rule', expression: '(http.host eq "old.bluelytics.com.ar")', action: 'set_cache_settings' };
    const { rulesets } = buildZoneRules(CONFIG, { ...EMPTY, rulesets: { ...EMPTY.rulesets, cache: [kept] } });
    expect(refs(rulesets.cache)).toEqual(['legacy_rule', 'media_cache_default', 'media_cache_social']);
  });
});
