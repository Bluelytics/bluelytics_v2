import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree, printParseErrorCode, type JSONPath, type ParseError } from 'jsonc-parser';

/** Wrangler configs whose D1 binding points at the Pulumi-managed database (relative to the repo root). */
export const WRANGLER_CONFIGS = ['apps/api/wrangler.jsonc', 'apps/jobs/wrangler.jsonc', 'apps/web/wrangler.jsonc'] as const;

/** The `pulumi stack output --json` fields this tool consumes (see infra/README.md). */
export interface D1Ids {
  d1DatabaseId: string;
  d1DatabaseName: string;
}

export interface SyncResult {
  file: string;
  changed: boolean;
}

export class SyncIdsError extends Error {
  override name = 'SyncIdsError';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseStackOutputs(json: string): D1Ids {
  let outputs: unknown;
  try {
    outputs = JSON.parse(json);
  } catch {
    throw new SyncIdsError('stack outputs are not JSON (expected `pulumi stack output --json`)');
  }
  if (typeof outputs !== 'object' || outputs === null) throw new SyncIdsError('stack outputs must be a JSON object');
  const { d1DatabaseId, d1DatabaseName } = outputs as Record<string, unknown>;
  if (typeof d1DatabaseId !== 'string' || !UUID.test(d1DatabaseId)) {
    throw new SyncIdsError(`stack output d1DatabaseId must be a D1 UUID, got ${JSON.stringify(d1DatabaseId)} (has \`pnpm infra:up\` run?)`);
  }
  if (typeof d1DatabaseName !== 'string' || d1DatabaseName === '') {
    throw new SyncIdsError(`stack output d1DatabaseName is missing, got ${JSON.stringify(d1DatabaseName)}`);
  }
  return { d1DatabaseId, d1DatabaseName };
}

function parseJsonc(text: string, file: string) {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  const [error] = errors;
  if (error) throw new SyncIdsError(`${file}: invalid JSONC at offset ${error.offset} (${printParseErrorCode(error.error)})`);
  if (tree?.type !== 'object') throw new SyncIdsError(`${file}: top level is not an object`);
  return tree;
}

/** `database_id` paths of every `d1_databases` entry for the database, top level and per `env.<name>`. */
function databaseIdPaths(text: string, databaseName: string, file: string): JSONPath[] {
  const tree = parseJsonc(text, file);
  const envs = findNodeAtLocation(tree, ['env']);
  const envNames = envs?.type === 'object' ? Object.keys(getNodeValue(envs) as object) : [];
  const bases: JSONPath[] = [[], ...envNames.map((name) => ['env', name])];
  const paths: JSONPath[] = [];
  for (const base of bases) {
    const list = findNodeAtLocation(tree, [...base, 'd1_databases']);
    if (list?.type !== 'array') continue;
    (list.children ?? []).forEach((entry, index) => {
      const value: unknown = getNodeValue(entry);
      if (typeof value === 'object' && value !== null && (value as Record<string, unknown>)['database_name'] === databaseName) {
        paths.push([...base, 'd1_databases', index, 'database_id']);
      }
    });
  }
  if (paths.length === 0) throw new SyncIdsError(`${file}: no d1_databases entry with "database_name": "${databaseName}"`);
  return paths;
}

/** Rewrites the D1 `database_id` values in one wrangler.jsonc text, keeping comments and layout. */
export function setD1DatabaseId(text: string, ids: D1Ids, file: string): string {
  // Only used when `database_id` has to be inserted: match the file's own layout.
  const formattingOptions = { insertSpaces: !/^\t/m.test(text), tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' };
  let result = text;
  for (const path of databaseIdPaths(text, ids.d1DatabaseName, file)) {
    const current = findNodeAtLocation(parseJsonc(result, file), path);
    if (current && getNodeValue(current) === ids.d1DatabaseId) continue;
    result = applyEdits(result, modify(result, path, ids.d1DatabaseId, { formattingOptions }));
  }
  return result;
}

/** Reads every config first, so a missing file or binding fails before anything is written. */
export function syncD1Ids(root: string, ids: D1Ids, files: readonly string[] = WRANGLER_CONFIGS): SyncResult[] {
  const planned = files.map((file) => {
    let text: string;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      throw new SyncIdsError(`${file}: cannot read ${join(root, file)}`);
    }
    return { file, text, next: setD1DatabaseId(text, ids, file) };
  });
  return planned.map(({ file, text, next }) => {
    if (next !== text) writeFileSync(join(root, file), next);
    return { file, changed: next !== text };
  });
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// `pnpm --filter` runs the script inside tools/; paths given on the command line are the caller's.
const callerPath = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);

function readStackOutputs(fromJson: string | undefined, stack: string | undefined): string {
  if (fromJson !== undefined) return readFileSync(callerPath(fromJson), 'utf8');
  const args = ['stack', 'output', '--json', ...(stack === undefined ? [] : ['--stack', stack])];
  try {
    return execFileSync('pulumi', args, { cwd: join(REPO_ROOT, 'infra'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (error) {
    throw new SyncIdsError(`\`pulumi ${args.join(' ')}\` failed in infra/: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `pnpm infra:sync-ids [-- --stack <name> | --from-json <file>] [--root <repo root with apps/*>]` */
export function main(argv: readonly string[]): void {
  const { values } = parseArgs({
    args: argv[0] === '--' ? argv.slice(1) : [...argv],
    options: { 'from-json': { type: 'string' }, stack: { type: 'string' }, root: { type: 'string' } },
  });
  const root = values.root === undefined ? REPO_ROOT : callerPath(values.root);
  const ids = parseStackOutputs(readStackOutputs(values['from-json'], values.stack));
  for (const { file, changed } of syncD1Ids(root, ids)) {
    console.log(`${changed ? 'updated  ' : 'unchanged'} ${file} (${ids.d1DatabaseName} = ${ids.d1DatabaseId})`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`infra:sync-ids: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
