import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { goldenText } from '@bluelytics/contract/golden';
import type { GoldenName } from '@bluelytics/contract';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/cli.ts';
import { main } from '../src/backfill/main.ts';
import { runBackfill } from '../src/backfill/run.ts';
import { wranglerTarget, type D1Target } from '../src/backfill/target.ts';
import { startGoldenServer, type GoldenServer } from './golden-server.ts';

const NOW = () => new Date('2026-11-22T15:00:00.000Z');
const WRANGLER = join(REPO_ROOT, 'apps/api/node_modules/.bin/wrangler');
const MIGRATIONS = fileURLToPath(new URL('../../packages/db/migrations', import.meta.url));

let server: GoldenServer;
let dir: string;
const quiet = () => undefined;

beforeAll(async () => {
  server = await startGoldenServer();
  dir = mkdtempSync(join(tmpdir(), 'backfill-'));
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('backfill --dry-run', () => {
  it('downloads the four bodies cache-busted, writes the SQL files and renders the goldens', async () => {
    const report = await runBackfill({ from: new URL(server.url), since: null, target: null, outDir: join(dir, 'dry'), legacyBlueBug: true, now: NOW, log: quiet });
    expect(server.requests.sort()).toEqual(
      ['/data/json/currency.json', '/v2/alerts', '/v2/evolution.json', '/v2/latest'].map((path) => `GET ${path}?ts=${NOW().getTime()}`),
    );
    expect(report.plan.write.daily).toHaveLength(9365);
    expect(report.plan.write.alerts.map((alert) => alert.id)).toEqual([1884, 1885]);
    expect(report.plan.write.currencies).toHaveLength(169);
    expect(report.written).toHaveLength(6);
    expect(existsSync(report.dataFile)).toBe(true);
    expect(readFileSync(report.renderedFile ?? '', 'utf8')).toContain('INSERT INTO rendered');
    const body = (key: string) => report.rendered.find((row) => row.key === key)?.body;
    expect(body('evolution_json')).toBe(goldenText('evolution_full'));
    expect(body('evolution_csv')).toBe(goldenText('evolution_csv_full'));
    expect(body('currency')).toBe(goldenText('currency'));
    expect(body('alerts')).toBe(goldenText('v2_alerts'));
    expect(body('latest')).toBe(goldenText('v2_latest'));
    expect(body('last_price')).toBe(goldenText('v1_last_price'));
  });

  it('with --since lists only daily_rates, alerts and their bodies', async () => {
    const lines: string[] = [];
    const report = await runBackfill({ from: new URL(server.url), since: '2026-11-16', target: null, outDir: join(dir, 'dry'), legacyBlueBug: false, now: NOW, log: (line) => lines.push(line) });
    expect(report.plan.write.daily.map((row) => row.day)).toEqual(expect.arrayContaining(['2026-11-16', '2026-11-20']));
    expect(report.plan.write.daily.every((row) => row.day >= '2026-11-16')).toBe(true);
    expect(report.plan.write.currencies).toBeUndefined();
    expect(report.written).toEqual(['alerts', 'evolution_json', 'evolution_csv']);
    const out = lines.join('\n');
    expect(out).not.toMatch(/latest_rates|currencies/);
    // The evolution body still covers every day: the target keeps the days before --since.
    expect(report.rendered.find((row) => row.key === 'evolution_json')?.body).toBe(goldenText('evolution_full'));
  });

  it('validates its flags', async () => {
    await expect(main([])).rejects.toThrow(/--from is required/);
    await expect(main(['--from', 'ftp://x'])).rejects.toThrow(/http\(s\)/);
    await expect(main(['--from', server.url, '--since', '2026-02-30'])).rejects.toThrow(/YYYY-MM-DD/);
    await expect(main(['--from', server.url, '--bogus'])).rejects.toThrow(/Unknown option/);
    await expect(main(['--from', server.url, '--remote', '--persist-to', 'x'])).rejects.toThrow(/local database/);
  });

  it('refuses a legacy API that does not answer JSON', async () => {
    const broken = await startGoldenServer((capture, served) => (capture.name === 'v2_alerts' ? { ...served, status: 500 } : served));
    try {
      await expect(runBackfill({ from: new URL(broken.url), since: null, target: null, outDir: join(dir, 'dry'), legacyBlueBug: false, now: NOW, log: quiet })).rejects.toThrow(
        /\/v2\/alerts\?ts=\d+ answered HTTP 500/,
      );
    } finally {
      await broken.close();
    }
  });
});

describe('backfill through wrangler d1 execute --local', () => {
  let target: D1Target;
  let cwd: string;

  beforeAll(() => {
    cwd = join(dir, 'worker');
    execFileSync('mkdir', ['-p', cwd]);
    writeFileSync(
      join(cwd, 'wrangler.jsonc'),
      JSON.stringify({
        name: 'backfill-test',
        compatibility_date: '2026-11-22',
        d1_databases: [{ binding: 'DB', database_name: 'bluelytics', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: MIGRATIONS }],
      }),
    );
    const persistTo = join(dir, 'state');
    execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'bluelytics', '--local', '--persist-to', persistTo], { cwd, stdio: 'ignore' });
    target = wranglerTarget({ remote: false, persistTo, cwd });
  }, 60_000);

  const stored = async (key: string) => (await target.query(`SELECT body FROM rendered WHERE key = '${key}'`))[0]?.[0]?.['body'];
  const golden = (name: GoldenName) => goldenText(name);

  it('loads everything, renders the goldens byte for byte, and a second run changes nothing', async () => {
    const options = { from: new URL(server.url), since: null, target, outDir: join(dir, 'real'), legacyBlueBug: true, now: NOW, log: quiet };
    const first = await runBackfill(options);
    expect(first.written).toHaveLength(6);
    expect(await stored('evolution_json')).toBe(golden('evolution_full'));
    expect(await stored('evolution_csv')).toBe(golden('evolution_csv_full'));
    expect(await stored('currency')).toBe(golden('currency'));
    expect(await stored('latest')).toBe(golden('v2_latest'));
    expect(await stored('last_price')).toBe(golden('v1_last_price'));
    expect(await stored('alerts')).toBe(golden('v2_alerts'));

    const second = await runBackfill(options);
    expect(second.written).toEqual([]);
    expect(second.renderedFile).toBeNull();
  }, 120_000);

  it('--since replaces shadow rows and alerts, keeps latest_rates, and re-renders from what D1 holds', async () => {
    await target.query(
      "INSERT INTO daily_rates VALUES ('2026-11-21', 'Blue', 1, 2, NULL, 'live'); UPDATE daily_rates SET sell = 9999, origin = 'live' WHERE day = '2026-11-20' AND tipo = 'Blue'; " +
        "UPDATE daily_rates SET sell = 1 WHERE day = '2011-01-03' AND tipo = 'Blue'; " +
        "INSERT INTO alerts (alert_at, buy, sell, push_status) VALUES ('2026-11-21T00:00:00.000Z', 1, 1, 'disabled'); " +
        "UPDATE latest_rates SET buy = 1 WHERE tipo = 'blue'",
    );
    const report = await runBackfill({ from: new URL(server.url), since: '2026-11-16', target, outDir: join(dir, 'real'), legacyBlueBug: true, now: NOW, log: quiet });
    expect(report.written).toEqual(['alerts', 'evolution_json', 'evolution_csv']);
    const [weekend, friday, old, alerts, latest] = await target.query(
      "SELECT * FROM daily_rates WHERE day = '2026-11-21'; SELECT sell, origin FROM daily_rates WHERE day = '2026-11-20' AND tipo = 'Blue'; " +
        "SELECT sell FROM daily_rates WHERE day = '2011-01-03' AND tipo = 'Blue'; SELECT id FROM alerts ORDER BY id; SELECT buy FROM latest_rates WHERE tipo = 'blue'",
    );
    expect(weekend).toEqual([]);
    expect(friday).toEqual([{ sell: 1665, origin: 'backfill_api' }]);
    expect(old).toEqual([{ sell: 1 }]);
    // The shadow alert (id 1886) stays: MIGRATION.md 4.5 deletes every alert first.
    expect(alerts).toEqual([{ id: 1884 }, { id: 1885 }, { id: 1886 }]);
    expect(latest).toEqual([{ buy: 1 }]);
    const evolution = String(await stored('evolution_json'));
    expect(evolution).not.toBe(golden('evolution_full'));
    expect(evolution.endsWith('{"date":"2011-01-03","source":"Blue","value_sell":1.00,"value_buy":4.00}]\n')).toBe(true);
  }, 120_000);
});
