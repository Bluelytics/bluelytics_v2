// `pnpm deploy:<app> -- --dry-run` reaches this script as `-- --dry-run`: pnpm 12 forwards the separator, and
// `wrangler deploy -- --dry-run` ignores the flag and deploys for real (MIGRATION.md C1). Drop it.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
const result = spawnSync('wrangler', ['deploy', ...args], { stdio: 'inherit' });
if (result.error) console.error(`wrangler deploy did not start: ${result.error.message}`);
process.exit(result.status ?? 1);
