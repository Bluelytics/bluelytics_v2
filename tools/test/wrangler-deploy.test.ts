import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/wrangler-deploy.mjs', import.meta.url));
const fakeBin = mkdtempSync(join(tmpdir(), 'fake-wrangler-'));
afterAll(() => rmSync(fakeBin, { recursive: true, force: true }));

/** Runs the deploy wrapper with `PATH` limited to `bin` (plus node's own directory). */
function deploy(args: string[], bin: string) {
  const path = [bin, join(process.execPath, '..')].join(':');
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: path } });
}

describe('scripts/wrangler-deploy.mjs (MIGRATION.md C1)', () => {
  writeFileSync(join(fakeBin, 'wrangler'), '#!/bin/sh\necho "wrangler $*"\nexit 3\n');
  chmodSync(join(fakeBin, 'wrangler'), 0o755);

  it('drops the separator pnpm forwards, so --dry-run reaches wrangler as a flag', () => {
    const result = deploy(['--', '--dry-run', '--outdir', 'out'], fakeBin);
    expect(result.stdout.trim()).toBe('wrangler deploy --dry-run --outdir out');
    expect(result.status).toBe(3);
  });

  it('keeps a later -- and passes plain flags unchanged', () => {
    expect(deploy(['--dry-run', '--', 'x'], fakeBin).stdout.trim()).toBe('wrangler deploy --dry-run -- x');
  });

  it('says why when wrangler cannot be started', () => {
    const empty = mkdtempSync(join(fakeBin, 'empty-'));
    const result = deploy(['--dry-run'], empty);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('wrangler deploy did not start');
  });
});
