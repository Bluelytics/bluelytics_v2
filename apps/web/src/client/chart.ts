/**
 * Progressive enhancement for the server-rendered charts: hover/touch readout and range presets.
 * The full daily series is fetched once, only when a range button is used.
 */
import type { Locale } from '../i18n/routes.ts';
import {
  buildChart,
  defaultIndex,
  linesFor,
  rangeStart,
  readoutItems,
  renderChart,
  sliceSeries,
  xPos,
  yPos,
  type ChartMode,
  type ChartModel,
  type RangePreset,
  type SeriesData,
} from '../lib/chart.ts';

interface Payload extends SeriesData {
  names: Record<string, string>;
}

let fullSeries: Promise<SeriesData> | undefined;

function loadFull(src: string): Promise<SeriesData> {
  fullSeries ??= fetch(src).then((response) => {
    if (!response.ok) throw new Error(`${src}: HTTP ${response.status}`);
    return response.json() as Promise<SeriesData>;
  });
  return fullSeries;
}

const percent = (fraction: number): string => `${fraction * 100}%`;

function span(className: string, text: string, child?: Node): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  // appendChild, not append: the Workers types in scope redeclare Element.append (HTMLRewriter).
  element.textContent = text;
  if (child) {
    element.appendChild(document.createTextNode(' '));
    element.appendChild(child);
  }
  return element;
}

/** Replaces the plot with markup produced by `renderChart` (our own escaped output). */
function drawPlot(box: HTMLElement, model: ChartModel): void {
  const parsed = new DOMParser().parseFromString(`<body>${renderChart(model)}</body>`, 'text/html');
  box.replaceChildren(...parsed.body.childNodes);
}

function enhance(figure: HTMLElement): void {
  figure.dataset['ready'] = '';
  const box = figure.querySelector<HTMLElement>('.plot-box');
  const readout = figure.querySelector<HTMLElement>('[data-readout]');
  const payloadText = figure.querySelector('[data-series]')?.textContent;
  if (!box || !readout || !payloadText) return;
  const payload = JSON.parse(payloadText) as Payload;
  const locale = (figure.dataset['locale'] ?? 'es') as Locale;
  const mode = (figure.dataset['mode'] ?? 'rates') as ChartMode;
  const small = figure.dataset['small'] !== undefined;
  const build = (data: SeriesData): ChartModel => buildChart(data.days, linesFor(mode, data), mode === 'gap' ? 'percent' : 'pesos', locale, small ? 3 : 5);
  let model = build(payload);

  const showReadout = (index: number): void => {
    const items = readoutItems(model, index, locale);
    readout.replaceChildren(
      span('readout-day', items.day),
      ...items.values.map((v) => span(`key key-${v.key}`, payload.names[v.key] ?? v.key, span('', v.text))),
    );
  };

  const showCursor = (index: number | null): void => {
    const cursor = box.querySelector<HTMLElement>('.cursor');
    if (!cursor) return;
    cursor.hidden = index === null;
    if (index === null) return;
    const x = percent(xPos(model, index));
    cursor.querySelector<HTMLElement>('.cursor-line')?.style.setProperty('left', x);
    const dots = cursor.querySelectorAll<HTMLElement>('.dot');
    model.lines.forEach((line, i) => {
      const dot = dots[i];
      const value = line.values[index];
      if (!dot) return;
      dot.hidden = value == null;
      if (value != null) {
        dot.style.left = x;
        dot.style.top = percent(yPos(model, value));
      }
    });
  };

  box.addEventListener('pointermove', (event) => {
    if (model.days.length === 0) return;
    const rect = box.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(fraction * (model.days.length - 1));
    showCursor(index);
    showReadout(index);
  });
  box.addEventListener('pointerleave', () => {
    showCursor(null);
    showReadout(defaultIndex(model, figure.dataset['focus']));
  });

  const buttons = [...figure.querySelectorAll<HTMLButtonElement>('.ranges button')];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const preset = button.dataset['range'] as RangePreset;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      figure.setAttribute('aria-busy', 'true');
      loadFull(figure.dataset['src'] ?? '/data/series.json')
        .then((all) => {
          const last = all.days.at(-1);
          model = build(last === undefined ? all : sliceSeries(all, rangeStart(last, preset)));
          drawPlot(box, model);
          showReadout(defaultIndex(model, figure.dataset['focus']));
        })
        .catch(() => button.setAttribute('aria-pressed', 'false'))
        .finally(() => figure.removeAttribute('aria-busy'));
    });
  }
}

export function enhanceCharts(): void {
  for (const figure of document.querySelectorAll<HTMLElement>('[data-chart]:not([data-ready])')) enhance(figure);
}
