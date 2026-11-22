import { describe, expect, it } from 'vitest';
import {
  ParseError,
  parseAmbitoVariacion,
  parseBna,
  parseCriptoya,
  parseCronista,
  parseDolarhoy,
  parseInfobae,
  parseInfodolar,
  parseLanacion,
  type ParseErrorCode,
  type Quote,
} from '../src/index.ts';
import { fixture, mutate, mutateAll } from './fixtures.ts';

function expectParseError(run: () => Quote, code: ParseErrorCode): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ParseError);
  expect((thrown as ParseError).code).toBe(code);
}

describe('ambito (blue) and ambito_oficial', () => {
  const blue = fixture('ambito_informal.json');
  const oficial = fixture('ambito_oficial.json');

  it('parses the documented values', () => {
    expect(parseAmbitoVariacion(blue)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: '2026-11-20T21:55:00.000Z' });
    expect(parseAmbitoVariacion(oficial)).toEqual({ buyCents: 154841, sellCents: 160132, sourceTs: '2026-11-20T19:46:00.000Z' });
  });

  it('accepts a thousands separator and a missing or unknown fecha', () => {
    const text = mutate(mutate(blue, '"1655,00"', '"1.655,00"'), '"20\\/11\\/2026 - 18:55"', '"20-11-2026"');
    expect(parseAmbitoVariacion(text)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: null });
  });

  it('throws on the 404 JSON body, non-JSON, swapped labels and English-format numbers', () => {
    expectParseError(() => parseAmbitoVariacion('{"error":"404","trace":"…"}'), 'anchor');
    expectParseError(() => parseAmbitoVariacion('<html>blocked</html>'), 'json');
    expectParseError(() => parseAmbitoVariacion('[{"compra":"1655,00","venta":"1675,00"}]'), 'json');
    expectParseError(() => parseAmbitoVariacion(mutate(mutate(blue, '"compra"', '"x"'), '"venta"', '"compra"').replace('"x"', '"venta"')), 'inverted');
    expectParseError(() => parseAmbitoVariacion(mutate(blue, '"1655,00"', '"1655.00"')), 'number');
    expectParseError(() => parseAmbitoVariacion(mutate(blue, '"1655,00"', '"N\\/D"')), 'number');
    expectParseError(() => parseAmbitoVariacion(mutate(blue, '"1655,00"', '1655')), 'anchor');
  });

  it('throws on an impossible fecha instead of guessing a time', () => {
    expectParseError(() => parseAmbitoVariacion(mutate(blue, '20\\/11\\/2026 - 18:55', '31\\/11\\/2026 - 18:55')), 'timestamp');
  });
});

describe('dolarhoy', () => {
  const html = fixture('dolarhoy_blue.html');

  it('parses the "Dólar Libre" tile without a source timestamp', () => {
    expect(parseDolarhoy(html)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: null });
  });

  it('throws on a missing tile, another instrument first, swapped labels and a wrong number format', () => {
    expectParseError(() => parseDolarhoy(mutate(html, '<div class="tile cotizacion_value">', '<div class="tile">')), 'anchor');
    expectParseError(() => parseDolarhoy(mutate(html, '>Dólar Libre<', '>Dólar Oficial<')), 'anchor');
    const swapped = mutate(mutate(html, '>Compra<', '>@@<'), '>Venta<', '>Compra<').replace('>@@<', '>Venta<');
    expectParseError(() => parseDolarhoy(swapped), 'anchor');
    expectParseError(() => parseDolarhoy(mutate(html, '$1.655,00', '$1655.00')), 'number');
    expectParseError(() => parseDolarhoy(mutate(html, '$1.675,00', '$1.675,00 / 1.680,00')), 'number');
  });

  it('throws when the values are swapped (sell below buy)', () => {
    const swapped = mutate(mutate(html, '$1.655,00', '@@'), '$1.675,00', '$1.655,00').replace('@@', '$1.675,00');
    expectParseError(() => parseDolarhoy(swapped), 'inverted');
  });
});

describe('cronista', () => {
  const html = fixture('cronista.html');
  const withoutJson = mutateAll(html, '"Ric":"ARSB=","UltimaActualizacion"', '"Ric":"X","UltimaActualizacion"');

  it('parses the embedded JSON of the ARSB= entry, not the ARS (BNA) entry before it', () => {
    expect(html.indexOf('"Ric":"ARS=BNAR"')).toBeLessThan(html.indexOf('"Ric":"ARSB="'));
    expect(parseCronista(html)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: '2026-11-20T21:25:13.970Z' });
  });

  it('falls back to the rendered "Dólar Blue" table when the embedded JSON is gone', () => {
    expect(parseCronista(withoutJson)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: null });
  });

  it('keeps the JSON when the markup was redesigned', () => {
    expect(parseCronista(mutate(html, 'Valor de compra', 'Compra'))).toMatchObject({ buyCents: 165500, sellCents: 167500 });
  });

  it('throws when the JSON and the markup disagree by more than 1 %', () => {
    expectParseError(() => parseCronista(mutate(html, '<!-- -->1.675</div>', '<!-- -->1.700</div>')), 'mismatch');
    expect(parseCronista(mutate(html, '<!-- -->1.675</div>', '<!-- -->1.690</div>')).sellCents).toBe(167500);
  });

  it('throws without JSON when the table is another instrument, the labels are missing or the number format is wrong', () => {
    expectParseError(() => parseCronista(mutate(withoutJson, '__table__name">Dólar Blue<', '__table__name">Dólar BNA<')), 'anchor');
    expectParseError(() => parseCronista(mutate(withoutJson, 'Valor de venta', 'Venta')), 'anchor');
    expectParseError(() => parseCronista(mutate(withoutJson, '<!-- -->1.655</div>', '<!-- -->1655.5</div>')), 'number');
    const swapped = mutate(mutate(withoutJson, 'Valor de venta', '@@'), 'Valor de compra', 'Valor de venta').replace('@@', 'Valor de compra');
    expectParseError(() => parseCronista(swapped), 'inverted');
  });

  it('ignores historico rows (no "Ultimo" after "Venta") and throws when nothing else is left', () => {
    const onlyHistory = mutate(withoutJson, 'markets-online__table__name', 'markets-online__name');
    expect(onlyHistory).toContain('"Venta":1495,"Ric":"ARSB="');
    expectParseError(() => parseCronista(onlyHistory), 'anchor');
  });
});

describe('infodolar', () => {
  const html = fixture('infodolar_blue.html');

  it('parses the "Dólar Blue" row with its datetime', () => {
    expect(parseInfodolar(html)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: '2026-11-20T21:00:00.000Z' });
  });

  it('never borrows cells from the next entity row (Nexo)', () => {
    const oneCell = mutate(html, 'class="colCompraVenta" data-order="$ 1.675,00"', 'class="colX" data-order="$ 1.675,00"');
    expectParseError(() => parseInfodolar(oneCell), 'anchor');
  });

  it('throws on a missing table, a renamed row, swapped values and a wrong number format', () => {
    expectParseError(() => parseInfodolar(mutate(html, 'id="CompraVenta"', 'id="Otra"')), 'anchor');
    expectParseError(() => parseInfodolar(mutate(html, '"/cotizacion-dolar-blue.aspx">Dólar Blue<', '"/cotizacion-dolar-oficial.aspx">Dólar Oficial<')), 'anchor');
    const swapped = mutate(mutate(html, 'data-order="$ 1.655,00"', '@@'), 'data-order="$ 1.675,00"', 'data-order="$ 1.655,00"').replace('@@', 'data-order="$ 1.675,00"');
    expectParseError(() => parseInfodolar(swapped), 'inverted');
    expectParseError(() => parseInfodolar(mutate(html, 'data-order="$ 1.655,00"', 'data-order="$ 1,655.00"')), 'number');
    expectParseError(() => parseInfodolar(mutateAll(html, 'datetime="2026-11-20T18:00:00-03:00"', 'datetime="viernes"')), 'timestamp');
  });
});

describe('lanacion', () => {
  const html = fixture('lanacion.html');

  it('parses the row labelled "Dólar blue" (the "Dólar oficial" row comes first)', () => {
    expect(html.indexOf('Dólar oficial</h2>')).toBeLessThan(html.indexOf('Dólar blue</h2>'));
    expect(parseLanacion(html)).toEqual({ buyCents: 161505, sellCents: 166500, sourceTs: null });
  });

  it('throws when the label is gone instead of taking a positional row, and on swapped labels or bad numbers', () => {
    expectParseError(() => parseLanacion(mutate(html, 'Dólar blue</h2>', 'Dólar libre</h2>')), 'anchor');
    expectParseError(() => parseLanacion(mutate(html, '<ul class="dolar-subgroup', '<ul class="otra')), 'anchor');
    const blueRow = html.slice(html.indexOf('Dólar blue</h2>'), html.indexOf('</li>', html.indexOf('Dólar blue</h2>')));
    const swappedRow = blueRow.replace('<span>Compra</span>', '@@').replace('<span>Venta</span>', '<span>Compra</span>').replace('@@', '<span>Venta</span>');
    expectParseError(() => parseLanacion(mutate(html, blueRow, swappedRow)), 'anchor');
    expectParseError(() => parseLanacion(mutate(html, '1615,05', '1615.05')), 'number');
  });

  it('does not take Compra/Venta from the next item when the blue row lost them', () => {
    const blueStart = html.indexOf('Dólar blue</h2>');
    const blueRow = html.slice(blueStart, html.indexOf('</li>', blueStart));
    const sellOnly = blueRow.replace(/<span>Compra<\/span><strong[^>]*>[^<]*<!-- -->[^<]*<\/strong>/, '');
    expectParseError(() => parseLanacion(mutate(html, blueRow, sellOnly)), 'anchor');
  });
});

describe('infobae', () => {
  const html = fixture('infobae_dolar_libre.html');

  it('parses the ARSB= series (sell before buy), not the summary item with an empty buy', () => {
    expect(html).toContain('"ric":"ARSB=","title":"Dólar blue","order":3,"buy":""');
    expect(parseInfobae(html)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: '2026-11-20T19:05:16.000Z' });
  });

  it('throws on a missing series, swapped values and a localised number', () => {
    expectParseError(() => parseInfobae(mutateAll(html, '"ric":"ARSB=","sellValue"', '"ric":"ARS=BNAR","sellValue"')), 'anchor');
    expectParseError(() => parseInfobae(mutate(html, '"sellValue":1675,"buyValue":1655,"closeValue":1675', '"sellValue":1655,"buyValue":1675,"closeValue":1675')), 'inverted');
    expectParseError(() => parseInfobae(mutate(html, '"sellValue":1675,"buyValue":1655,"closeValue":1675', '"sellValue":"1.675","buyValue":1655,"closeValue":1675')), 'anchor');
    expectParseError(() => parseInfobae(mutate(html, '"utcDate":"2026-11-20T19:05:16.000Z","series":[{"x":"2026-11-20T14', '"utcDate":"ayer","series":[{"x":"2026-11-20T14')), 'timestamp');
  });
});

describe('bna', () => {
  const html = fixture('bna_personas.html');

  it('parses the billetes "Dolar U.S.A" row with date and update time (ART)', () => {
    expect(parseBna(html)).toEqual({ buyCents: 155000, sellCents: 160000, sourceTs: '2026-11-20T20:03:00.000Z' });
  });

  it('does not read the divisas tab or the Euro row, and throws on bad numbers or an impossible date', () => {
    expectParseError(() => parseBna(mutate(html, 'id="billetes"', 'id="otros"')), 'anchor');
    // String.replace changes the first occurrence only: the billetes tab, which precedes divisas.
    expectParseError(() => parseBna(html.replace('<td class="tit">Dolar U.S.A</td>', '<td class="tit">Dolar Blue</td>')), 'anchor');
    expectParseError(() => parseBna(mutate(html, '<td>1550,00</td>', '<td>1550.00</td>')), 'number');
    expectParseError(() => parseBna(mutate(html, '<td>1600,00</td>', '<td>1500,00</td>')), 'inverted');
    expectParseError(() => parseBna(html.replace('20/11/2026</th>', '31/11/2026</th>')), 'timestamp');
  });
});

describe('criptoya', () => {
  const json = fixture('criptoya_dolar.json');

  it('parses blue bid/ask with the poll timestamp', () => {
    expect(parseCriptoya(json)).toEqual({ buyCents: 165500, sellCents: 167500, sourceTs: '2026-11-22T14:23:59.000Z' });
  });

  it('throws on a missing blue object, string numbers and swapped sides', () => {
    expectParseError(() => parseCriptoya(mutate(json, '"blue":', '"azul":')), 'anchor');
    expectParseError(() => parseCriptoya(mutate(json, '"ask":1675,"bid":1655', '"ask":"1675","bid":1655')), 'number');
    expectParseError(() => parseCriptoya(mutate(json, '"ask":1675,"bid":1655', '"ask":1655,"bid":1675')), 'inverted');
  });
});
