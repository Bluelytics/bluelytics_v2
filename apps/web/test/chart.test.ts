import { describe, expect, it } from 'vitest';
import { buildChart, defaultIndex, linePath, linesFor, niceScale, rangeStart, renderChart, sampleIndices, sliceSeries, type SeriesData } from '../src/lib/chart.ts';

const data: SeriesData = {
  days: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'],
  blue: [1600, 1610, null, 1640, 1665],
  oficial: [1500, 1505, 1510, 1580, 1595],
};

describe('server-rendered charts', () => {
  it('picks round axis bounds', () => {
    expect(niceScale(1503, 1667)).toEqual({ min: 1500, max: 1700, step: 50 });
    expect(niceScale(5, 5).min).toBeLessThan(5);
  });

  it('computes preset windows and slices', () => {
    expect(rangeStart('2026-11-20', '1m')).toBe('2026-10-21');
    expect(rangeStart('2026-11-20', 'max')).toBeNull();
    expect(sliceSeries(data, '2026-11-19').days).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('derives the gap line in percent', () => {
    const [gap] = linesFor('gap', data);
    expect(gap?.values[0]).toBeCloseTo(6.6667, 3);
    expect(gap?.values[2]).toBeNull();
  });

  it('breaks a line on missing days', () => {
    const model = buildChart(data.days, linesFor('rates', data), 'pesos', 'es');
    const blue = model.lines.find((l) => l.key === 'blue');
    expect(blue && linePath(model, blue).match(/M/g)).toHaveLength(2);
  });

  it('renders labels in the page locale and escapes nothing unsafe', () => {
    const html = renderChart(buildChart(data.days, linesFor('rates', data), 'pesos', 'es'));
    expect(html).toContain('>1.600<');
    expect(html).toContain('preserveAspectRatio="none"');
  });

  it('caps vertices and keeps both ends', () => {
    const indices = sampleIndices(5000, 480);
    expect(indices).toHaveLength(480);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(4999);
  });

  it('reads out the focus day, else the last day with data', () => {
    const model = buildChart(data.days, linesFor('rates', data), 'pesos', 'es');
    expect(defaultIndex(model, '2026-11-17')).toBe(1);
    expect(defaultIndex(model, '2020-01-01')).toBe(4);
    expect(defaultIndex(model)).toBe(4);
  });
});
