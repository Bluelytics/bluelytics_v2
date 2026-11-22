import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStackOutputs, setD1DatabaseId, SyncIdsError, syncD1Ids, WRANGLER_CONFIGS } from '../src/sync-ids.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures/sync-ids');
const SCRIPT = join(HERE, '../src/sync-ids.ts');
const ID = '9f3c2b1a-0d4e-4f5a-8b6c-7d8e9f0a1b2c';
const IDS = { d1DatabaseId: ID, d1DatabaseName: 'bluelytics' };
const OUTPUTS = JSON.stringify({ ...IDS, r2BucketName: 'bluelytics-public', mediaHostname: 'media.bluelytics.com.ar' });

let root: string;
const read = (file: string) => readFileSync(join(root, file), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sync-ids-'));
  cpSync(FIXTURES, root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('syncD1Ids', () => {
  it('rewrites every matching database_id and keeps comments, trailing commas and layout', () => {
    const before = read('apps/api/wrangler.jsonc');
    expect(syncD1Ids(root, IDS)).toEqual(WRANGLER_CONFIGS.map((file) => ({ file, changed: true })));

    const api = read('apps/api/wrangler.jsonc');
    expect(api).toBe(
      before
        .replace('"00000000-0000-0000-0000-000000000000"', `"${ID}"`)
        .replace('"<d1DatabaseId>"', `"${ID}"`),
    );
    expect(read('apps/jobs/wrangler.jsonc')).toContain(`"database_name": "bluelytics", "database_id": "${ID}" }`);
    expect(read('apps/jobs/wrangler.jsonc')).toContain('/* bindings */');
  });

  it('inserts a missing database_id with the file indentation', () => {
    syncD1Ids(root, IDS);
    expect(read('apps/web/wrangler.jsonc')).toBe(
      `{\n\t"name": "bluelytics-web",\n\t"d1_databases": [\n\t\t{\n\t\t\t"binding": "DB",\n\t\t\t"database_name": "bluelytics",\n\t\t\t"database_id": "${ID}"\n\t\t}\n\t]\n}\n`,
    );
  });

  it('is idempotent', () => {
    syncD1Ids(root, IDS);
    const after = WRANGLER_CONFIGS.map(read);
    expect(syncD1Ids(root, IDS).every((result) => !result.changed)).toBe(true);
    expect(WRANGLER_CONFIGS.map(read)).toEqual(after);
  });

  it('fails before writing anything when a file is missing', () => {
    rmSync(join(root, 'apps/web/wrangler.jsonc'));
    const api = read('apps/api/wrangler.jsonc');
    expect(() => syncD1Ids(root, IDS)).toThrow(/apps\/web\/wrangler.jsonc: cannot read/);
    expect(read('apps/api/wrangler.jsonc')).toBe(api);
  });

  it('fails when the D1 binding is missing', () => {
    writeFileSync(join(root, 'apps/jobs/wrangler.jsonc'), '{ "name": "bluelytics-jobs", "d1_databases": [{ "binding": "DB", "database_name": "other" }] }');
    expect(() => syncD1Ids(root, IDS)).toThrow(SyncIdsError);
    expect(() => syncD1Ids(root, IDS)).toThrow('apps/jobs/wrangler.jsonc: no d1_databases entry with "database_name": "bluelytics"');
  });
});

describe('setD1DatabaseId', () => {
  it('rejects invalid JSONC', () => {
    expect(() => setD1DatabaseId('{ "d1_databases": [ }', IDS, 'x.jsonc')).toThrow(/x.jsonc: invalid JSONC at offset/);
  });
});

describe('parseStackOutputs', () => {
  it('reads the D1 outputs', () => {
    expect(parseStackOutputs(OUTPUTS)).toEqual(IDS);
  });

  it.each([
    ['not json', /not JSON/],
    ['{}', /d1DatabaseId must be a D1 UUID/],
    [JSON.stringify({ d1DatabaseId: '[unknown]', d1DatabaseName: 'bluelytics' }), /d1DatabaseId must be a D1 UUID/],
    [JSON.stringify({ d1DatabaseId: ID }), /d1DatabaseName is missing/],
  ])('rejects %s', (json, message) => {
    expect(() => parseStackOutputs(json)).toThrow(message);
  });
});

describe('CLI', () => {
  it('syncs from a --from-json file and reports each file', () => {
    const outputs = join(root, 'outputs.json');
    writeFileSync(outputs, OUTPUTS);
    const stdout = execFileSync(process.execPath, [SCRIPT, '--', '--from-json', outputs, '--root', root], { encoding: 'utf8' });
    expect(stdout.trim().split('\n')).toEqual(WRANGLER_CONFIGS.map((file) => `updated   ${file} (bluelytics = ${ID})`));
    expect(read('apps/jobs/wrangler.jsonc')).toContain(ID);
  });

  it('exits 1 with a message when a binding is missing', () => {
    writeFileSync(join(root, 'outputs.json'), OUTPUTS);
    rmSync(join(root, 'apps/api/wrangler.jsonc'));
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [SCRIPT, '--from-json', join(root, 'outputs.json'), '--root', root], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      ({ status, stderr } = error as { status: number; stderr: string });
    }
    expect(status).toBe(1);
    expect(stderr).toContain('infra:sync-ids: apps/api/wrangler.jsonc: cannot read');
  });
});
