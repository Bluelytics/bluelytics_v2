import { epochMs } from '@bluelytics/core';
import { getState, setState } from '@bluelytics/db';
import { CARD_SIZES } from '@bluelytics/social';
import type { Published } from './card-data.ts';
import { updateCardData } from './card-data.ts';
import type { Deps } from './deps.ts';
import { storeCard } from './social.ts';

/** R2 key the website's `og:image` points at (`${MEDIA_ORIGIN}/og/latest.jpg?v=…`, apps/web README). */
export const OG_IMAGE_KEY = 'og/latest.jpg';
const OG_STATE_KEY = 'og_image';
/** At most one Browser Run render per 15 minutes for the link preview; a later run catches up. */
const OG_MIN_INTERVAL_MS = 15 * 60_000;

interface OgState {
  buy: number;
  sell: number;
  oficialSell: number;
  at: string;
}

/** Step 6 of ARCHITECTURE §7: re-render `og/latest.jpg` when the published values differ from the image's. */
export async function refreshOgImage(deps: Deps, now: string, state: Published): Promise<boolean> {
  const stored = await getState(deps.db, OG_STATE_KEY);
  const last = stored ? (JSON.parse(stored.value) as OgState) : null;
  const current: OgState = { buy: state.blue.buy, sell: state.blue.sell, oficialSell: state.oficial.sell, at: now };
  if (last && last.buy === current.buy && last.sell === current.sell && last.oficialSell === current.oficialSell) return false;
  if (last && epochMs(now) - epochMs(last.at) < OG_MIN_INTERVAL_MS) return false;
  const data = await updateCardData(deps.db, state, now);
  await storeCard(deps, { cardKind: 'og', size: 'og', viewport: CARD_SIZES.og }, data, OG_IMAGE_KEY);
  await setState(deps.db, OG_STATE_KEY, JSON.stringify(current), now);
  return true;
}
