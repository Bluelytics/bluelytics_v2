// Compile-time only (checked by `pnpm typecheck`): the real Workers binding fits D1DatabaseLike.
import type { D1Database } from '@cloudflare/workers-types/experimental';
import type { Miniflare } from 'miniflare';
import type { D1DatabaseLike } from '../src/index.ts';

export function fromWorkersBinding(binding: D1Database): D1DatabaseLike {
  return binding;
}

export async function fromMiniflare(miniflare: Miniflare): Promise<D1DatabaseLike> {
  return miniflare.getD1Database('DB');
}

// @ts-expect-error guards against the import above silently resolving to `any`
export const notABinding: D1Database = 42;
