import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repository root (tools/src/../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A path given on the command line, resolved against the caller's directory (`pnpm --filter` runs scripts inside tools/). */
export const callerPath = (path: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), path);

/** An operator mistake or a failed precondition: printed without a stack trace. */
export class CliError extends Error {
  override name = 'CliError';
}

/** `pnpm <script> -- --flag` forwards the `--` separator; drop it. */
export const cliArgs = (argv: readonly string[]): string[] => (argv[0] === '--' ? argv.slice(1) : [...argv]);

/** True when `moduleUrl` is the script node/tsx was started with. */
export const isMain = (moduleUrl: string): boolean => process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;

/** Runs a CLI entry: its return value is the exit code; errors print as `<name>: <message>` and exit 1. */
export function runCli(name: string, main: (argv: string[]) => Promise<number>): void {
  main(cliArgs(process.argv.slice(2))).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${name}: ${message}`);
      if (!(error instanceof CliError) && error instanceof Error && error.cause !== undefined) {
        console.error(`  cause: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`);
      }
      process.exitCode = 1;
    },
  );
}

/** `node:util` parseArgs errors (unknown flag, missing value) become CliErrors with the usage hint. */
export function usageError(error: unknown, usage: string): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new CliError(`${message}\n\n${usage}`);
}

/** Left-aligned text table with a header row. */
export function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
