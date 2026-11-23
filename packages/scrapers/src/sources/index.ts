import { ambito, ambitoOficial } from './ambito.ts';
import { bna } from './bna.ts';
import { criptoya } from './criptoya.ts';
import { cronista } from './cronista.ts';
import { dolarhoy } from './dolarhoy.ts';
import { infodolar } from './infodolar.ts';
import { lanacion } from './lanacion.ts';
import type { Source } from '../types.ts';

export { ambito, ambitoOficial, parseAmbitoItem, parseAmbitoVariacion } from './ambito.ts';
export { ambitoExtras, parseAmbitoCcl, parseAmbitoMonedas } from './ambito-extras.ts';
export type { ExtraQuote, ExtrasRequest, ExtrasSource } from './ambito-extras.ts';
export { bna, parseBna } from './bna.ts';
export { criptoya, parseCriptoya } from './criptoya.ts';
export { cronista, parseCronista } from './cronista.ts';
export { dolarhoy, parseDolarhoy } from './dolarhoy.ts';
export { infobae, parseInfobae } from './infobae.ts';
export { infodolar, parseInfodolar } from './infodolar.ts';
export { lanacion, parseLanacion } from './lanacion.ts';

/** Every source fetched on each tick (ARCHITECTURE §7 step 1); `ambito_extras` runs daily instead. */
// infobae is off since 2026-11-23: Akamai answers 403 to Cloudflare's network (AWS works), and its quote is the
// same Refinitiv ARSB= feed Cronista reprints, so it adds no independent price. The parser and its role as
// Cronista's substitute stay; add it back here to re-enable.
export const TICK_SOURCES: readonly Source[] = [ambito, ambitoOficial, dolarhoy, cronista, infodolar, lanacion, bna, criptoya];
