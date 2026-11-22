import type { types } from '@pulumi/cloudflare';
import type { InfraConfig } from './config.ts';

export type RulesetRule = types.input.RulesetRule;
export type CloudConnectorRule = types.input.CloudConnectorRulesRule;

/** The zone entry-point phases this program manages: one `Ruleset` per phase, never two. */
export const ZONE_PHASES = {
  redirect: 'http_request_dynamic_redirect',
  cache: 'http_request_cache_settings',
  transform: 'http_request_transform',
  responseHeaders: 'http_response_headers_transform',
} as const;
export type ZonePhase = keyof typeof ZONE_PHASES;

export interface ZoneRules {
  rulesets: Record<ZonePhase, RulesetRule[]>;
  cloudConnector: CloudConnectorRule[];
}

/**
 * Fixed API paths the jobs Worker also writes to R2 as `api/<path>` (ARCHITECTURE §6), with the
 * browser TTL that matches the Worker's own `Cache-Control` for that path.
 */
export const STATIC_API_PATHS: Readonly<Record<string, number>> = {
  '/v2/latest': 30,
  '/v2/alerts': 30,
  '/json/last_price': 30,
  '/v2/evolution.json': 300,
  '/v2/evolution.csv': 300,
  '/data/json/currency.json': 300,
};
export const STATIC_API_R2_PREFIX = '/api';

const HOUR = 3600;
const DAY = 24 * HOUR;
/** Free-plan minimum edge TTL; static-first bodies stay fresh through purge-on-write by the jobs Worker. */
const STATIC_API_EDGE_TTL = 2 * HOUR;
const ERROR_EDGE_TTL = 60;

const quote = (value: string): string => JSON.stringify(value);
const set = (values: readonly string[]): string => `{${values.map(quote).join(' ')}}`;

/**
 * Matches a static-first request in every phase. Later phases may see the path after the URL rewrite
 * (`/api/v2/latest`) or before it (`/v2/latest`); the docs do not say which, so both forms match.
 * Requests with a query string (`?days`, `?callback`, `?pretty`, cache-busters) stay on the Worker.
 */
function staticApiExpression(config: InfraConfig, paths: readonly string[]): string {
  const rewritten = paths.map((path) => `${STATIC_API_R2_PREFIX}${path}`);
  return (
    `(http.host eq ${quote(config.apiHostname)} and http.request.uri.query eq "" and ` +
    `(http.request.uri.path in ${set(paths)} or http.request.uri.path in ${set(rewritten)}))`
  );
}

function wwwRedirect(config: InfraConfig): RulesetRule {
  return {
    ref: 'www_to_apex',
    description: 'www -> site hostname, path and query kept',
    expression: `(http.host eq ${quote(`www.${config.zoneName}`)})`,
    action: 'redirect',
    actionParameters: {
      fromValue: {
        statusCode: 301,
        preserveQueryString: true,
        targetUrl: { expression: `concat(${quote(`https://${config.webHostname}`)}, http.request.uri.path)` },
      },
    },
  };
}

function cacheRule(ref: string, description: string, expression: string, edgeTtl: number, browserTtl: number): RulesetRule {
  return {
    ref,
    description,
    expression,
    action: 'set_cache_settings',
    actionParameters: {
      cache: true,
      edgeTtl: {
        mode: 'override_origin',
        default: edgeTtl,
        statusCodeTtls: [{ statusCodeRange: { from: 400, to: 599 }, value: ERROR_EDGE_TTL }],
      },
      browserTtl: { mode: 'override_origin', default: browserTtl },
    },
  };
}

// Cache rules are not terminating: a later matching rule overrides an earlier one.
function mediaCacheRules(config: InfraConfig): RulesetRule[] {
  const host = `http.host eq ${quote(config.mediaHostname)}`;
  return [
    cacheRule('media_cache_default', 'Cache every object on the R2 media hostname (og images are rewritten in place)', `(${host})`, 2 * HOUR, HOUR),
    cacheRule('media_cache_social', 'Social card images have unique keys and never change', `(${host} and starts_with(http.request.uri.path, "/social/"))`, 30 * DAY, DAY),
  ];
}

function staticApiPathsByTtl(): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const [path, ttl] of Object.entries(STATIC_API_PATHS)) groups.set(ttl, [...(groups.get(ttl) ?? []), path]);
  return groups;
}

function staticApiCacheRules(config: InfraConfig): RulesetRule[] {
  return [...staticApiPathsByTtl()].map(([browserTtl, paths]) =>
    cacheRule(
      `api_static_browser_${browserTtl}s`,
      `static-first: cache pre-rendered API bodies from R2 (browser ${browserTtl}s)`,
      staticApiExpression(config, paths),
      STATIC_API_EDGE_TTL,
      browserTtl,
    ),
  );
}

function staticApiRewrite(config: InfraConfig): RulesetRule {
  const paths = Object.keys(STATIC_API_PATHS);
  return {
    ref: 'api_static_r2_key',
    description: 'static-first: map fixed API paths onto their R2 keys (api/<path>)',
    expression: `(http.host eq ${quote(config.apiHostname)} and http.request.uri.query eq "" and http.request.uri.path in ${set(paths)})`,
    action: 'rewrite',
    actionParameters: { uri: { path: { expression: `concat(${quote(STATIC_API_R2_PREFIX)}, http.request.uri.path)` } } },
  };
}

/** Legacy CORS headers on R2-served bodies, also for requests without `Origin` (R2 CORS needs one). */
function staticApiCors(config: InfraConfig): RulesetRule {
  return {
    ref: 'api_static_cors',
    description: 'static-first: legacy CORS headers on R2-served API bodies',
    expression: staticApiExpression(config, Object.keys(STATIC_API_PATHS)),
    action: 'rewrite',
    actionParameters: {
      headers: {
        'Access-Control-Allow-Origin': { operation: 'set', value: '*' },
        Vary: { operation: 'set', value: 'Origin' },
      },
    },
  };
}

function staticApiCloudConnector(config: InfraConfig): CloudConnectorRule {
  return {
    description: 'static-first: serve fixed API paths from the R2 bucket',
    enabled: true,
    expression: staticApiExpression(config, Object.keys(STATIC_API_PATHS)),
    cloudConnectorRulesProvider: 'cloudflare_r2',
    parameters: { host: config.mediaHostname },
  };
}

/**
 * Every rule the program owns, per phase, after the operator's preserved rules (copied from the zone
 * before adoption, see `preserved-rules.ts`). A phase with no rules gets no `Ruleset`.
 */
export function buildZoneRules(config: InfraConfig, preserved: ZoneRules): ZoneRules {
  const staticFirst = config.apiMode === 'static-first';
  const own: ZoneRules = {
    rulesets: {
      redirect: [wwwRedirect(config)],
      cache: [...mediaCacheRules(config), ...(staticFirst ? staticApiCacheRules(config) : [])],
      transform: staticFirst ? [staticApiRewrite(config)] : [],
      responseHeaders: staticFirst ? [staticApiCors(config)] : [],
    },
    cloudConnector: staticFirst ? [staticApiCloudConnector(config)] : [],
  };
  return {
    rulesets: {
      redirect: [...preserved.rulesets.redirect, ...own.rulesets.redirect],
      cache: [...preserved.rulesets.cache, ...own.rulesets.cache],
      transform: [...preserved.rulesets.transform, ...own.rulesets.transform],
      responseHeaders: [...preserved.rulesets.responseHeaders, ...own.rulesets.responseHeaders],
    },
    cloudConnector: [...preserved.cloudConnector, ...own.cloudConnector],
  };
}
