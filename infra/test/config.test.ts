import { describe, expect, it } from 'vitest';
import { InfraConfigError, readInfraConfig } from '../src/config.ts';

const BASE: Record<string, string> = {
  accountId: '0123456789abcdef0123456789abcdef',
  zoneId: 'fedcba9876543210fedcba9876543210',
  zoneName: 'bluelytics.com.ar',
};

const read = (overrides: Record<string, string | undefined> = {}) => {
  const values = { ...BASE, ...overrides };
  return readInfraConfig((key) => values[key]);
};

describe('readInfraConfig', () => {
  it('defaults the hostnames, worker mode and unmanaged rulesets', () => {
    expect(read()).toEqual({
      ...BASE,
      webHostname: 'bluelytics.com.ar',
      apiHostname: 'api.bluelytics.com.ar',
      mediaHostname: 'media.bluelytics.com.ar',
      apiMode: 'worker',
      manageRulesets: false,
      adopt: {},
    });
  });

  it('reads every key as the MIGRATION runbook sets it', () => {
    const config = read({
      webHostname: 'v2.bluelytics.com.ar',
      apiHostname: 'api-v2.bluelytics.com.ar',
      mediaHostname: 'img.bluelytics.com.ar',
      apiMode: 'static-first',
      manageRulesets: 'true',
    });
    expect(config).toMatchObject({
      webHostname: 'v2.bluelytics.com.ar',
      apiHostname: 'api-v2.bluelytics.com.ar',
      mediaHostname: 'img.bluelytics.com.ar',
      apiMode: 'static-first',
      manageRulesets: true,
    });
  });

  it.each([
    [{ accountId: undefined }, /accountId is required/],
    [{ zoneId: 'not-an-id' }, /zoneId must be 32 lowercase hex/],
    [{ zoneName: 'Bluelytics.com.ar' }, /zoneName is not a lowercase domain/],
    [{ apiHostname: 'api.example.com' }, /must be inside the zone/],
    [{ apiHostname: 'evilbluelytics.com.ar' }, /must be inside the zone/],
    [{ mediaHostname: 'bluelytics.com.ar' }, /mediaHostname must be its own subdomain/],
    [{ mediaHostname: 'api.bluelytics.com.ar' }, /mediaHostname must be its own subdomain/],
    [{ apiMode: 'static' }, /apiMode must be one of worker, static-first/],
    [{ manageRulesets: 'yes' }, /manageRulesets must be "true" or "false"/],
    [{ apiMode: 'static-first' }, /static-first needs bluelytics:manageRulesets=true/],
    [{ adopt: '[]' }, /adopt must be an object/],
    [{ adopt: '{"cache_rules":"zones/z/r"}' }, /adopt.cache_rules is not adoptable/],
    [{ adopt: '{"db":""}' }, /adopt.db must be a non-empty import ID/],
  ])('rejects %o', (overrides, message) => {
    expect(() => read(overrides)).toThrow(InfraConfigError);
    expect(() => read(overrides)).toThrow(message);
  });

  it('reads adoption import IDs', () => {
    const adopt = JSON.stringify({ db: `${BASE['accountId']}/0f0e0d0c-0000-4000-8000-000000000000`, 'cache-rules': 'zones/z/r' });
    expect(read({ adopt }).adopt).toEqual(JSON.parse(adopt));
  });
});
