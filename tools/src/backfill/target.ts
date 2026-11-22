import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { D1Value } from '@bluelytics/db';
import { CliError, REPO_ROOT } from '../cli.ts';

/** Where the backfill writes: a D1 database reached through some executor. */
export interface D1Target {
  /** For messages, e.g. `remote D1 bluelytics`. */
  readonly label: string;
  /** Runs a SQL script file. */
  executeFile(file: string): Promise<void>;
  /** Runs `;`-separated queries; one result row list per statement. */
  query(sql: string): Promise<Record<string, D1Value>[][]>;
}

export interface WranglerTargetOptions {
  remote: boolean;
  /** Local only: Miniflare state directory (`wrangler --persist-to`). */
  persistTo?: string;
  /** Directory whose wrangler config has the `bluelytics` D1 binding. Default apps/api, like `wr_api` in MIGRATION.md. */
  cwd?: string;
  /** Wrangler executable. Default apps/api's own. */
  wrangler?: string;
  database?: string;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
  });
}

interface WranglerResult {
  results?: unknown;
  success?: unknown;
}

const tail = (text: string): string => (text.length > 2_000 ? `…${text.slice(-2_000)}` : text).trim();

function parseResults(stdout: string, what: string): WranglerResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new CliError(`${what}: wrangler did not print JSON:\n${tail(stdout)}`);
  }
  if (!Array.isArray(parsed)) throw new CliError(`${what}: unexpected wrangler output:\n${tail(stdout)}`);
  return parsed as WranglerResult[];
}

/** `wrangler d1 execute bluelytics --local|--remote --json …`, run where the D1 binding is configured. */
export function wranglerTarget(options: WranglerTargetOptions): D1Target {
  const cwd = options.cwd ?? join(REPO_ROOT, 'apps/api');
  const wrangler = options.wrangler ?? join(REPO_ROOT, 'apps/api/node_modules/.bin/wrangler');
  const database = options.database ?? 'bluelytics';
  const where = options.remote ? ['--remote'] : ['--local', ...(options.persistTo === undefined ? [] : ['--persist-to', options.persistTo])];

  async function execute(extra: readonly string[], what: string): Promise<WranglerResult[]> {
    if (!existsSync(wrangler)) throw new CliError(`wrangler not found at ${wrangler} (run pnpm install)`);
    const result = await run(wrangler, ['d1', 'execute', database, ...where, '--json', '--yes', ...extra], cwd);
    if (result.code !== 0) throw new CliError(`${what}: wrangler exited with ${result.code}:\n${tail(`${result.stderr}\n${result.stdout}`)}`);
    const results = parseResults(result.stdout, what);
    if (results.some((entry) => entry.success === false)) throw new CliError(`${what}: a statement failed:\n${tail(result.stdout)}`);
    return results;
  }

  return {
    label: `${options.remote ? 'remote' : 'local'} D1 ${database}`,
    async executeFile(file) {
      await execute(['--file', file], `executing ${file}`);
    },
    async query(sql) {
      const results = await execute(['--command', sql], 'query');
      return results.map((entry) => {
        if (!Array.isArray(entry.results)) throw new CliError(`query: wrangler returned no result rows for ${sql.slice(0, 80)}`);
        return entry.results as Record<string, D1Value>[];
      });
    },
  };
}
