/**
 * Line charts as HTML + SVG, rendered on the server and redrawn by the client enhancer with the
 * same code. Lines live in a stretched SVG (`preserveAspectRatio="none"`, 1000×1000 user units,
 * non-scaling strokes); tick labels are HTML positioned in percent, so text stays crisp and the
 * chart fills any width at a fixed CSS height (no layout shift).
 */
import type { Locale } from '../i18n/routes.ts';
import { formatDay, formatDayNumeric, formatInteger, formatMonthShort, formatPercent, formatPesos } from './format.ts';

/** Daily sell closes, oldest first; `null` = no row that day. */
export interface SeriesData {
  days: string[];
  blue: (number | null)[];
  oficial: (number | null)[];
}

export type ChartMode = 'rates' | 'gap';
export type LineKey = 'blue' | 'oficial' | 'gap';

export interface PlotLine {
  key: LineKey;
  values: (number | null)[];
}

export interface Tick {
  /** 0 = left/top, 1 = right/bottom. */
  pos: number;
  label: string;
}

export interface ChartModel {
  days: string[];
  lines: PlotLine[];
  unit: 'pesos' | 'percent';
  yMin: number;
  yMax: number;
  yTicks: Tick[];
  xTicks: Tick[];
}

const SIZE = 1000;
/** Fraction of the height kept free above and below the data. */
const PAD = 0.06;
/** At most this many vertices per drawn line; hover still reads every day. */
const MAX_VERTICES = 480;

export const RANGE_PRESETS = ['1m', '3m', '6m', '1y', '5y', 'max'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const RANGE_DAYS: Record<Exclude<RangePreset, 'max'>, number> = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '5y': 1827 };

/** First day (inclusive) of a preset window ending on `lastDay`; `null` for the whole series. */
export function rangeStart(lastDay: string, preset: RangePreset): string | null {
  if (preset === 'max') return null;
  const [y, m, d] = lastDay.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - (RANGE_DAYS[preset] - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The part of `data` with `day >= from`. */
export function sliceSeries(data: SeriesData, from: string | null): SeriesData {
  if (from === null) return data;
  let start = data.days.findIndex((day) => day >= from);
  if (start < 0) start = data.days.length;
  return { days: data.days.slice(start), blue: data.blue.slice(start), oficial: data.oficial.slice(start) };
}

/** Blue/oficial sell, or the gap in percent `(blue / oficial − 1) × 100`. */
export function linesFor(mode: ChartMode, data: SeriesData): PlotLine[] {
  if (mode === 'rates') return [{ key: 'oficial', values: data.oficial }, { key: 'blue', values: data.blue }];
  const gap = data.days.map((_, i) => {
    const blue = data.blue[i];
    const oficial = data.oficial[i];
    return blue != null && oficial != null && oficial > 0 ? (blue / oficial - 1) * 100 : null;
  });
  return [{ key: 'gap', values: gap }];
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Round axis bounds and a step that gives about `count` intervals. */
export function niceScale(min: number, max: number, count = 4): { min: number; max: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1 };
  if (min === max) {
    const spread = Math.abs(min) * 0.05 || 1;
    min -= spread;
    max += spread;
  }
  const step = niceStep((max - min) / count);
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

function yLabel(value: number, unit: ChartModel['unit'], step: number, locale: Locale): string {
  if (unit === 'pesos') return formatInteger(Math.round(value), locale);
  const digits = step < 1 ? 1 : 0;
  return formatPercent(value / 100, locale, digits);
}

function xTicks(days: readonly string[], locale: Locale, count: number): Tick[] {
  if (days.length === 0) return [];
  const first = days[0] as string;
  const last = days[days.length - 1] as string;
  const spanDays = (Date.parse(last) - Date.parse(first)) / 86_400_000;
  const label = (day: string): string => {
    if (spanDays <= 100) return formatDayNumeric(day, locale);
    if (spanDays <= 3 * 366) return formatMonthShort(Number(day.slice(0, 4)), Number(day.slice(5, 7)), locale);
    return day.slice(0, 4);
  };
  const ticks: Tick[] = [];
  const n = Math.min(count, days.length);
  for (let i = 0; i < n; i++) {
    const index = n === 1 ? days.length - 1 : Math.round((i * (days.length - 1)) / (n - 1));
    const text = label(days[index] as string);
    if (ticks.at(-1)?.label === text) continue;
    ticks.push({ pos: days.length === 1 ? 0.5 : index / (days.length - 1), label: text });
  }
  return ticks;
}

export function buildChart(days: string[], lines: PlotLine[], unit: ChartModel['unit'], locale: Locale, xTickCount = 5): ChartModel {
  const values = lines.flatMap((line) => line.values.filter((v): v is number => v != null));
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const yTicks: Tick[] = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) {
    yTicks.push({ pos: 1 - PAD - ((v - scale.min) / (scale.max - scale.min)) * (1 - 2 * PAD), label: yLabel(v, unit, scale.step, locale) });
  }
  return { days, lines, unit, yMin: scale.min, yMax: scale.max, yTicks, xTicks: xTicks(days, locale, xTickCount) };
}

/** Horizontal position (0–1) of day `index`. */
export function xPos(model: ChartModel, index: number): number {
  return model.days.length <= 1 ? 0.5 : index / (model.days.length - 1);
}

/** Vertical position (0–1 from the top) of a value. */
export function yPos(model: ChartModel, value: number): number {
  return 1 - PAD - ((value - model.yMin) / (model.yMax - model.yMin)) * (1 - 2 * PAD);
}

/** Evenly spaced indices of a series of `length` items, at most `max`, always keeping both ends. */
export function sampleIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.round((i * (length - 1)) / (max - 1)));
}

const coord = (value: number): string => String(Math.round(value * SIZE * 10) / 10);

/** SVG path data of one line; missing days split it. */
export function linePath(model: ChartModel, line: PlotLine): string {
  let d = '';
  let pen = false;
  for (const i of sampleIndices(line.values.length, MAX_VERTICES)) {
    const value = line.values[i];
    if (value == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${coord(xPos(model, i))} ${coord(yPos(model, value))}`;
    pen = true;
  }
  return d;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (fraction: number): string => `${Math.round(fraction * 10000) / 100}%`;

/** Inner HTML of a chart plot: grid, lines, tick labels and the (hidden) hover marker. */
export function renderChart(model: ChartModel): string {
  const grid = model.yTicks.map((t) => `<line x1="0" x2="${SIZE}" y1="${coord(t.pos)}" y2="${coord(t.pos)}"/>`).join('');
  const paths = model.lines.map((line) => `<path class="ln ln-${line.key}" d="${linePath(model, line)}"/>`).join('');
  const yLabels = model.yTicks.map((t) => `<span class="yt" style="top:${pct(t.pos)}">${escapeHtml(t.label)}</span>`).join('');
  const xLabels = model.xTicks
    .map((t, i, all) => {
      const align = i === 0 && all.length > 1 ? ' xt-start' : i === all.length - 1 && all.length > 1 ? ' xt-end' : '';
      return `<span class="xt${align}" style="left:${pct(t.pos)}">${escapeHtml(t.label)}</span>`;
    })
    .join('');
  const dots = model.lines.map((line) => `<i class="dot dot-${line.key}"></i>`).join('');
  return (
    `<svg class="plot" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<g class="grid">${grid}</g>${paths}</svg>${yLabels}<div class="xaxis">${xLabels}</div>` +
    `<div class="cursor" hidden><i class="cursor-line"></i>${dots}</div>`
  );
}

/** The readout for day `index`: date plus each line's value. */
export function readoutItems(model: ChartModel, index: number, locale: Locale): { day: string; values: { key: LineKey; text: string }[] } {
  const day = model.days[index] ?? '';
  return {
    day: day === '' ? '' : formatDay(day, locale, 'short'),
    values: model.lines.map((line) => {
      const value = line.values[index];
      const text = value == null ? '–' : model.unit === 'pesos' ? formatPesos(Math.round(value), locale) : formatPercent(value / 100, locale);
      return { key: line.key, text };
    }),
  };
}

/** The readout shown when the pointer is not on the chart: `focus` when drawn, else the last day with data. */
export function defaultIndex(model: ChartModel, focus?: string | null): number {
  const index = focus ? model.days.indexOf(focus) : -1;
  return index >= 0 ? index : lastIndexWithData(model);
}

/** Index of the last day on which at least one line has a value. */
export function lastIndexWithData(model: ChartModel): number {
  for (let i = model.days.length - 1; i >= 0; i--) {
    if (model.lines.some((line) => line.values[i] != null)) return i;
  }
  return model.days.length - 1;
}
