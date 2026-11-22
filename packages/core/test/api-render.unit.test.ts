import { describe, expect, it } from 'vitest';
import { goJsonString, isValidJsonpCallback, parseDaysParam, prettyJson, renderCurrency, sliceEvolutionCsv, sliceEvolutionJson, wrapJsonp } from '../src/index.ts';

describe('goJsonString (Go 1.14 encoding/json escaping)', () => {
  it('emits non-ASCII as raw UTF-8', () => {
    expect(goJsonString('Colón Salvadoreño')).toBe('"Colón Salvadoreño"');
    expect(goJsonString('Złoty')).toBe('"Złoty"');
    expect(goJsonString('Paʻanga')).toBe('"Paʻanga"');
    expect(goJsonString('soberano​ Venezolano')).toBe('"soberano​ Venezolano"');
    expect(goJsonString('😀')).toBe('"😀"');
    expect(goJsonString('\u007f')).toBe('"\u007f"');
  });

  it('escapes quotes, backslashes and control characters', () => {
    expect(goJsonString('a"b')).toBe('"a\\"b"');
    expect(goJsonString('a\\b')).toBe('"a\\\\b"');
    expect(goJsonString('a\nb\rc\td')).toBe('"a\\nb\\rc\\td"');
    expect(goJsonString('\u0000\u0008\u000c\u001f')).toBe('"\\u0000\\u0008\\u000c\\u001f"');
  });

  it('escapes HTML-sensitive characters and the JS line separators', () => {
    expect(goJsonString('<b>&</b>')).toBe('"\\u003cb\\u003e\\u0026\\u003c/b\\u003e"');
    expect(goJsonString('a b c')).toBe('"a\\u2028b\\u2029c"');
  });

  it('replaces unpaired surrogates like Go replaces invalid UTF-8', () => {
    expect(goJsonString('a\ud800b')).toBe('"a\\ufffdb"');
    expect(goJsonString('a\udc00b')).toBe('"a\\ufffdb"');
    expect(goJsonString('\ud83d')).toBe('"\\ufffd"');
  });

  it('is applied to currency codes and names', () => {
    expect(renderCurrency([{ code: 'A&B', name: 'Tom "the" <cat>', valueHundredths: 150 }])).toBe(
      '[{"code":"A\\u0026B","name":"Tom \\"the\\" \\u003ccat\\u003e","value":1.50}]\n',
    );
  });
});

describe('parseDaysParam (strconv.Atoi + "< 10000" + LIMIT)', () => {
  const all = { kind: 'all' };
  const none = { kind: 'none' };

  it('limits rows for integers between 1 and 9999', () => {
    expect(parseDaysParam('5')).toEqual({ kind: 'rows', rows: 5 });
    expect(parseDaysParam('+2')).toEqual({ kind: 'rows', rows: 2 });
    expect(parseDaysParam('02')).toEqual({ kind: 'rows', rows: 2 });
    expect(parseDaysParam('0009999')).toEqual({ kind: 'rows', rows: 9999 });
    expect(parseDaysParam('1')).toEqual({ kind: 'rows', rows: 1 });
  });

  it('answers nothing for zero and negatives', () => {
    for (const raw of ['0', '-0', '+0', '000', '-1', '-9999', '-10000', '-9223372036854775808']) {
      expect(parseDaysParam(raw), raw).toEqual(none);
    }
  });

  it('answers everything when absent, empty, not an integer, out of int64 range or >= 10000', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'abc',
      '3.0',
      ' 3',
      '3 ',
      '1_0',
      '0x5',
      '1e3',
      '+',
      '-',
      '--1',
      '٣',
      '10000',
      '99999',
      '9223372036854775807',
      '9223372036854775808',
      '-9223372036854775809',
      '99999999999999999999999',
    ]) {
      expect(parseDaysParam(raw), String(raw)).toEqual(all);
    }
  });
});

describe('slicing', () => {
  it('rejects invalid row counts', () => {
    expect(() => sliceEvolutionJson('[{}]\n', 0)).toThrow(RangeError);
    expect(() => sliceEvolutionCsv('h\n', 1.5)).toThrow(RangeError);
  });
});

describe('JSONP', () => {
  it('wraps with the legacy bytes', () => {
    expect(wrapJsonp('cb', '{"a":1}\n')).toBe('cb({"a":1}\n);');
  });

  it('accepts jQuery/angular style callbacks only', () => {
    for (const good of ['myCb', 'jQuery1124_1690000000000', 'angular.callbacks._0', 'a.b[0]', '$cb', '_', 'x'.repeat(128)]) {
      expect(isValidJsonpCallback(good), good).toBe(true);
    }
    for (const bad of ['', 'a.b[0]<x>', 'alert(1)', 'a b', 'a;b', 'a\n', 'ñ', 'a-b', 'x'.repeat(129)]) {
      expect(isValidJsonpCallback(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('prettyJson (Go json.Indent layout)', () => {
  it('keeps empty containers compact and number text untouched', () => {
    expect(prettyJson('{"a":[],"b":{},"c":[1.50,2.00],"d":null}\n')).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [\n    1.50,\n    2.00\n  ],\n  "d": null\n}\n',
    );
    expect(prettyJson('[]\n')).toBe('[]\n');
    expect(prettyJson('{}\n')).toBe('{}\n');
    expect(prettyJson('null\n')).toBe('null\n');
  });

  it('does not touch punctuation inside strings', () => {
    expect(prettyJson('{"k":"a,b:{c}[d] \\"q\\" \\\\"}\n')).toBe('{\n  "k": "a,b:{c}[d] \\"q\\" \\\\"\n}\n');
    expect(prettyJson('["{","}",","]\n')).toBe('[\n  "{",\n  "}",\n  ","\n]\n');
  });

  it('nests with two spaces per level', () => {
    expect(prettyJson('[[1,[2]],{"a":{"b":true}}]\n')).toBe(
      '[\n  [\n    1,\n    [\n      2\n    ]\n  ],\n  {\n    "a": {\n      "b": true\n    }\n  }\n]\n',
    );
  });

  it('adds the trailing newline when the input has none', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}\n');
  });
});
