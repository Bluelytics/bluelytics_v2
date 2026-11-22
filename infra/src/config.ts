export const API_MODES = ['worker', 'static-first'] as const;
export type ApiMode = (typeof API_MODES)[number];

/** Program resource names that can adopt an existing Cloudflare object through `bluelytics:adopt`. */
export const ADOPTABLE = [
  'db',
  'media-bucket',
  'redirect-rules',
  'cache-rules',
  'transform-rules',
  'response-header-rules',
  'cloud-connector-rules',
] as const;
export type Adoptable = (typeof ADOPTABLE)[number];

export interface InfraConfig {
  accountId: string;
  zoneId: string;
  zoneName: string;
  webHostname: string;
  apiHostname: string;
  mediaHostname: string;
  apiMode: ApiMode;
  manageRulesets: boolean;
  /** Import IDs for one-time adoption of objects that already exist (README "Adopting existing objects"). */
  adopt: Partial<Record<Adoptable, string>>;
}

/** Reads a `bluelytics:<key>` value; `undefined` when unset. */
export type ConfigGetter = (key: string) => string | undefined;

const CLOUDFLARE_ID = /^[0-9a-f]{32}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class InfraConfigError extends Error {
  override name = 'InfraConfigError';
}

function required(get: ConfigGetter, key: string): string {
  const value = get(key);
  if (value === undefined || value === '') throw new InfraConfigError(`bluelytics:${key} is required`);
  return value;
}

function cloudflareId(get: ConfigGetter, key: string): string {
  const value = required(get, key);
  if (!CLOUDFLARE_ID.test(value)) throw new InfraConfigError(`bluelytics:${key} must be 32 lowercase hex characters, got "${value}"`);
  return value;
}

function hostnameInZone(get: ConfigGetter, key: string, zoneName: string, fallback: string): string {
  const value = get(key) ?? fallback;
  if (!HOSTNAME.test(value)) throw new InfraConfigError(`bluelytics:${key} is not a lowercase hostname: "${value}"`);
  if (value !== zoneName && !value.endsWith(`.${zoneName}`)) {
    throw new InfraConfigError(`bluelytics:${key} (${value}) must be inside the zone ${zoneName}`);
  }
  return value;
}

function boolean(get: ConfigGetter, key: string, fallback: boolean): boolean {
  const value = get(key);
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new InfraConfigError(`bluelytics:${key} must be "true" or "false", got "${value}"`);
}

function apiMode(get: ConfigGetter): ApiMode {
  const value = get('apiMode') ?? 'worker';
  const mode = API_MODES.find((m) => m === value);
  if (!mode) throw new InfraConfigError(`bluelytics:apiMode must be one of ${API_MODES.join(', ')}, got "${value}"`);
  return mode;
}

function adopt(get: ConfigGetter): InfraConfig['adopt'] {
  const raw = get('adopt');
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InfraConfigError('bluelytics:adopt must be an object (set it with pulumi config set --path)');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InfraConfigError('bluelytics:adopt must be an object of resource name -> import ID');
  }
  const result: InfraConfig['adopt'] = {};
  for (const [name, id] of Object.entries(parsed)) {
    const key = ADOPTABLE.find((a) => a === name);
    if (!key) throw new InfraConfigError(`bluelytics:adopt.${name} is not adoptable; use one of ${ADOPTABLE.join(', ')}`);
    if (typeof id !== 'string' || id === '') throw new InfraConfigError(`bluelytics:adopt.${name} must be a non-empty import ID`);
    result[key] = id;
  }
  return result;
}

export function readInfraConfig(get: ConfigGetter): InfraConfig {
  const zoneName = required(get, 'zoneName');
  if (!HOSTNAME.test(zoneName)) throw new InfraConfigError(`bluelytics:zoneName is not a lowercase domain: "${zoneName}"`);
  const config: InfraConfig = {
    accountId: cloudflareId(get, 'accountId'),
    zoneId: cloudflareId(get, 'zoneId'),
    zoneName,
    webHostname: hostnameInZone(get, 'webHostname', zoneName, zoneName),
    apiHostname: hostnameInZone(get, 'apiHostname', zoneName, `api.${zoneName}`),
    mediaHostname: hostnameInZone(get, 'mediaHostname', zoneName, `media.${zoneName}`),
    apiMode: apiMode(get),
    manageRulesets: boolean(get, 'manageRulesets', false),
    adopt: adopt(get),
  };
  if (config.mediaHostname === zoneName || config.mediaHostname === config.webHostname || config.mediaHostname === config.apiHostname) {
    throw new InfraConfigError('bluelytics:mediaHostname must be its own subdomain (the R2 custom domain owns its DNS record)');
  }
  if (config.apiMode === 'static-first' && !config.manageRulesets) {
    throw new InfraConfigError('bluelytics:apiMode=static-first needs bluelytics:manageRulesets=true (its rules live in the zone rulesets)');
  }
  return config;
}
