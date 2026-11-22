import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, type ParseError } from 'jsonc-parser';
import { CliError } from '../cli.ts';

/** The jobs Worker renders the bodies, so its flag wins; apps/api mirrors it until apps/jobs exists. */
const FLAG_SOURCES = ['apps/jobs/wrangler.jsonc', 'apps/api/wrangler.jsonc'] as const;

/** `LEGACY_V1_BLUE_BUG` as the deployed Workers see it: on only for the exact string `"true"`. */
export function readLegacyBlueBug(root: string): { value: boolean; file: string | null } {
  for (const file of FLAG_SOURCES) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const errors: ParseError[] = [];
    const config: unknown = parse(readFileSync(path, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length > 0) throw new CliError(`${file}: invalid JSONC`);
    const vars = (config as { vars?: Record<string, unknown> } | null)?.vars;
    if (vars !== undefined && 'LEGACY_V1_BLUE_BUG' in vars) return { value: vars['LEGACY_V1_BLUE_BUG'] === 'true', file };
  }
  return { value: false, file: null };
}
