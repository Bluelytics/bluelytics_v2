import { describe, expect, it } from 'vitest';
import { legacyHashTarget } from '../src/lib/legacy-hash.ts';

describe('legacy hash-route shim', () => {
  it.each([
    ['#!/calculator', '/calculadora'],
    ['#/calculator', '/calculadora'],
    ['#!/evolution', '/historico'],
    ['#/gap', '/brecha'],
    ['#!/api', '/api'],
    ['#/about', '/acerca'],
    ['#!/analysis', '/historico'],
    ['#/forecast', '/historico'],
    ['#/wordcloud', '/'],
    ['#/dolar/ambito', '/'],
    ['#!/', '/'],
    ['#/', '/'],
    ['#!/unknown', '/'],
    ['#!/gap?x=1', '/brecha'],
  ])('%s → %s', (hash, target) => {
    expect(legacyHashTarget(hash, null)).toBe(target);
  });

  it('ignores fragments that are not legacy routes', () => {
    expect(legacyHashTarget('', null)).toBeNull();
    expect(legacyHashTarget('#main', null)).toBeNull();
  });

  it('honours the old English language preference', () => {
    expect(legacyHashTarget('#!/calculator', '"en_US"')).toBe('/en/calculator');
    expect(legacyHashTarget('#!/calculator', '"es_AR"')).toBe('/calculadora');
  });
});
