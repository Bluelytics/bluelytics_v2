import { ambito, ambitoOficial } from './ambito.ts';
import { bna } from './bna.ts';
import { criptoya } from './criptoya.ts';
import { cronista } from './cronista.ts';
import { dolarhoy } from './dolarhoy.ts';
import { infobae } from './infobae.ts';
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
export const TICK_SOURCES: readonly Source[] = [ambito, ambitoOficial, dolarhoy, cronista, infodolar, lanacion, infobae, bna, criptoya];
