import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import { readInfraConfig, type Adoptable } from './config.ts';
import { PRESERVED_RULES } from './preserved-rules.ts';
import { buildZoneRules, ZONE_PHASES, type ZonePhase } from './zone-rules.ts';

const stackConfig = new pulumi.Config('bluelytics');
const config = readInfraConfig((key) => stackConfig.get(key));
const { accountId, zoneId } = config;

const options = (name: Adoptable, extra: pulumi.CustomResourceOptions = {}): pulumi.CustomResourceOptions => {
  const importId = config.adopt[name];
  return importId === undefined ? extra : { ...extra, import: importId };
};

// ---------------------------------------------------------------- storage (never renamed: replacement loses data)
// No primaryLocationHint / location: the D1 GET response has no hint, so adopting or refreshing with one
// set plans a replacement. Cloudflare places both close to where `pulumi up` runs.
const db = new cloudflare.D1Database('db', {
  accountId,
  name: 'bluelytics',
  readReplication: { mode: 'disabled' },
}, options('db', { protect: true }));

const bucket = new cloudflare.R2Bucket('media-bucket', {
  accountId,
  name: 'bluelytics-public',
}, options('media-bucket', { protect: true }));

// Creates and owns its DNS record: never declare a DnsRecord for this hostname.
new cloudflare.R2CustomDomain('media-domain', {
  accountId,
  bucketName: bucket.name,
  domain: config.mediaHostname,
  zoneId,
  enabled: true,
  minTls: '1.2',
});

new cloudflare.R2BucketLifecycle('media-lifecycle', {
  accountId,
  bucketName: bucket.name,
  rules: [
    {
      id: 'expire-social-cards',
      enabled: true,
      conditions: { prefix: 'social/' },
      deleteObjectsTransition: { condition: { type: 'Age', maxAge: 90 * 24 * 3600 } },
    },
    // Setting a rule list replaces the bucket's default 7-day multipart abort rule, so restate it.
    {
      id: 'abort-stale-multipart',
      enabled: true,
      conditions: { prefix: '' },
      abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 7 * 24 * 3600 } },
    },
  ],
});

new cloudflare.R2BucketCors('media-cors', {
  accountId,
  bucketName: bucket.name,
  rules: [{ id: 'public-read', allowed: { methods: ['GET', 'HEAD'], origins: ['*'], headers: ['*'] }, maxAgeSeconds: 86400 }],
});

// ---------------------------------------------------------------- zone rules (only once adopted: README)
if (config.manageRulesets) {
  const rules = buildZoneRules(config, PRESERVED_RULES);
  const resourceNames: Record<ZonePhase, Adoptable> = {
    redirect: 'redirect-rules',
    cache: 'cache-rules',
    transform: 'transform-rules',
    responseHeaders: 'response-header-rules',
  };
  for (const phase of Object.keys(ZONE_PHASES) as ZonePhase[]) {
    if (rules.rulesets[phase].length === 0) continue;
    const name = resourceNames[phase];
    new cloudflare.Ruleset(name, {
      zoneId,
      name: 'default',
      kind: 'zone',
      phase: ZONE_PHASES[phase],
      rules: rules.rulesets[phase],
    }, options(name));
  }
  if (rules.cloudConnector.length > 0) {
    new cloudflare.CloudConnectorRules('cloud-connector-rules', { zoneId, rules: rules.cloudConnector }, options('cloud-connector-rules'));
  }
}

// ---------------------------------------------------------------- outputs (read by `pnpm infra:sync-ids`)
export const d1DatabaseId = db.uuid;
export const d1DatabaseName = db.name;
export const r2BucketName = bucket.name;
export const mediaHostname = config.mediaHostname;
