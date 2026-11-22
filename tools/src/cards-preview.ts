import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { CARD_KIND_SIZES, CARD_SIZES, isJpeg, renderCardHtml, type CardData, type CardKind, type CardSeriesPoint, type Renderer } from '@bluelytics/social';
import { LocalChromeRenderer } from '@bluelytics/social/local';
import { callerPath, CliError, isMain, REPO_ROOT, runCli, usageError } from './cli.ts';

export const CARDS_PREVIEW_USAGE = `Usage: pnpm cards:preview [-- --out <dir>] [--chrome <path>]

Renders every card kind and size of @bluelytics/social with scenario data through a local Chrome
(the same HTML the jobs Worker sends to Browser Run) and writes <kind>-<size>-<scenario>.jpg.

  --out <dir>      output directory (default: out/cards)
  --chrome <path>  Chrome executable (default: $CHROME_PATH, else /usr/bin/google-chrome-stable)
  -h, --help       this text`;

/** Mon–Fri days ending at `endDay`, oldest first, paired with `sells`. */
function tradingSeries(endDay: string, sells: readonly number[]): CardSeriesPoint[] {
  const days: string[] = [];
  const date = new Date(`${endDay}T12:00:00Z`);
  while (days.length < sells.length) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.unshift(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return days.map((day, index) => ({ day, sell: sells[index] ?? 0 }));
}

const MONTH = [1590, 1600, 1595, 1610, 1620, 1615, 1630, 1625, 1640, 1650, 1645, 1660, 1655, 1650, 1665, 1660, 1670, 1665, 1660, 1675];

const UP: CardData = {
  blue: { buy: 1655, sell: 1675 },
  oficial: { buy: 1548, sell: 1601 },
  prevSell: 1660,
  updatedAt: '2026-11-20T18:45:12.000Z',
  series: tradingSeries('2026-11-20', MONTH),
};

/** What each kind is previewed with: the usual cases plus the edges a design tends to break on. */
export const CARD_SCENARIOS: Readonly<Record<CardKind, Readonly<Record<string, CardData>>>> = {
  update: {
    up: UP,
    down: {
      blue: { buy: 1630, sell: 1650 },
      oficial: { buy: 1550, sell: 1603 },
      prevSell: 1675,
      updatedAt: '2026-11-23T14:05:40.000Z',
      series: tradingSeries('2026-11-23', [...MONTH.slice(1), 1650]),
    },
    flat: { ...UP, prevSell: 1675 },
    'no-reference': { ...UP, prevSell: null },
    'five-digits': {
      blue: { buy: 12350, sell: 12480 },
      oficial: { buy: 9870, sell: 10250 },
      prevSell: 11890,
      updatedAt: '2027-09-08T22:35:00.000Z',
      series: tradingSeries('2027-09-08', [11800, 11850, 11890, 12480]),
    },
  },
  weekly: {
    'week-up': { ...UP, prevSell: 1645, updatedAt: '2026-11-20T21:00:05.000Z', series: tradingSeries('2026-11-20', [1650, 1655, 1660, 1665, 1675]) },
    'week-down': { ...UP, prevSell: 1700, updatedAt: '2026-11-20T21:00:05.000Z', series: tradingSeries('2026-11-20', [1695, 1690, 1685, 1680, 1675]) },
    'one-day-week': { ...UP, prevSell: 1645, updatedAt: '2026-11-20T21:00:05.000Z', series: [{ day: '2026-11-20', sell: 1675 }] },
  },
  og: { up: UP, 'no-reference': { ...UP, prevSell: null } },
};

/** Renders every kind × size × scenario into `outDir`; returns the files written. */
export async function renderPreviews(renderer: Renderer, outDir: string, log: (line: string) => void = () => undefined): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const kind of Object.keys(CARD_KIND_SIZES) as CardKind[]) {
    for (const size of CARD_KIND_SIZES[kind]) {
      for (const [scenario, data] of Object.entries(CARD_SCENARIOS[kind])) {
        const viewport = CARD_SIZES[size];
        const bytes = await renderer.render(renderCardHtml(kind, size, data), viewport);
        if (!isJpeg(bytes)) throw new CliError(`${kind}/${size}/${scenario}: the renderer did not return a JPEG`);
        const file = join(outDir, `${kind}-${size}-${scenario}.jpg`);
        writeFileSync(file, bytes);
        files.push(file);
        log(`${relative(REPO_ROOT, file)}  ${viewport.width}×${viewport.height}  ${Math.ceil(bytes.byteLength / 1024)} KB`);
      }
    }
  }
  return files;
}

export async function main(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { out: { type: 'string' }, chrome: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false } } }));
  } catch (error) {
    usageError(error, CARDS_PREVIEW_USAGE);
  }
  if (values.help) {
    console.log(CARDS_PREVIEW_USAGE);
    return 0;
  }
  const outDir = values.out === undefined ? join(REPO_ROOT, 'out/cards') : callerPath(values.out);
  const renderer = new LocalChromeRenderer(values.chrome === undefined ? {} : { executablePath: callerPath(values.chrome) });
  try {
    const files = await renderPreviews(renderer, outDir, (line) => console.log(line));
    console.log(`${files.length} cards in ${outDir}`);
  } catch (error) {
    if (error instanceof Error && /Executable doesn't exist|ENOENT|Failed to launch/i.test(error.message)) {
      throw new CliError(`cannot start Chrome (${error.message.split('\n')[0]}); install google-chrome-stable or pass --chrome / set CHROME_PATH`);
    }
    throw error;
  } finally {
    // After a failed launch close() rethrows the launch error; the one above is clearer.
    await renderer.close().catch(() => undefined);
  }
  return 0;
}

if (isMain(import.meta.url)) runCli('cards:preview', main);
