import { describe, expect, it } from 'vitest';
import {
  BODY,
  CONTENT_TYPE,
  etag,
  limitEvolutionCsv,
  limitEvolutionJson,
  prettyJson,
  renderAlerts,
  renderCurrency,
  renderEvolutionCsv,
  renderEvolutionJson,
  renderHistorical,
  renderLastPrice,
  renderLatest,
  RENDERED_CONTENT_TYPE,
  sha256Hex,
  sliceEvolutionCsv,
  sliceEvolutionJson,
  wrapJsonp,
} from '../src/index.ts';
import type { RatePair } from '../src/index.ts';
import {
  expectBytes,
  goldenBytes,
  goldenText,
  livePrettyBytes,
  parseAlerts,
  parseCurrency,
  parseEvolution,
  parseLatest,
} from './helpers.ts';

const evolutionRows = parseEvolution(goldenText('evolution_full'));
const evolutionJson = renderEvolutionJson(evolutionRows);
const evolutionCsv = renderEvolutionCsv(evolutionRows);
const latest = parseLatest(goldenText('v2_latest'));

function dayPair(day: string): { oficial: RatePair | null; blue: RatePair | null } {
  const find = (tipo: string): RatePair | null => evolutionRows.find((row) => row.day === day && row.tipo === tipo) ?? null;
  return { oficial: find('Oficial'), blue: find('Blue') };
}

describe('evolution bodies', () => {
  it('parses the whole golden history', () => {
    expect(evolutionRows).toHaveLength(9365);
    expect(evolutionRows.filter((row) => row.tipo === 'Blue')).toHaveLength(4683);
    expect(evolutionRows.at(0)?.day).toBe('2026-11-20');
    expect(evolutionRows.at(-1)?.day).toBe('2011-01-03');
  });

  it('renders evolution_full byte for byte (721,233 bytes)', () => {
    expect(Buffer.byteLength(evolutionJson)).toBe(721_233);
    expectBytes(evolutionJson, goldenBytes('evolution_full'));
  });

  it('renders evolution_csv_full byte for byte from the same rows', () => {
    expect(Buffer.byteLength(evolutionCsv)).toBe(281_106);
    expectBytes(evolutionCsv, goldenBytes('evolution_csv_full'));
  });

  it('slices ?days=5 out of the pre-rendered JSON', () => {
    expectBytes(limitEvolutionJson(evolutionJson, '5'), goldenBytes('evolution_days5'));
    expectBytes(sliceEvolutionJson(evolutionJson, 5), goldenBytes('evolution_days5'));
    expectBytes(renderEvolutionJson(evolutionRows.slice(0, 5)), goldenBytes('evolution_days5'));
  });

  it('slices ?days=3 out of the pre-rendered CSV', () => {
    expectBytes(limitEvolutionCsv(evolutionCsv, '3'), goldenBytes('evolution_csv_days3'));
    expectBytes(sliceEvolutionCsv(evolutionCsv, 3), goldenBytes('evolution_csv_days3'));
  });

  it('answers null for ?days=0 and negative values', () => {
    expectBytes(limitEvolutionJson(evolutionJson, '0'), goldenBytes('evolution_days0'));
    expectBytes(limitEvolutionJson(evolutionJson, '-1'), goldenBytes('evolution_daysneg'));
    expectBytes(renderEvolutionJson([]), goldenBytes('evolution_days0'));
    expect(limitEvolutionCsv(evolutionCsv, '0')).toBe('day,type,value_buy,value_sell\n');
    expect(limitEvolutionCsv(evolutionCsv, '-7')).toBe('day,type,value_buy,value_sell\n');
  });

  it('ignores non-integer and >= 10000 values of ?days', () => {
    for (const raw of ['abc', '3.0', ' 3', '1_0', '0x5', '1e3', '', '99999999999999999999']) {
      expectBytes(limitEvolutionJson(evolutionJson, raw), goldenBytes('evolution_days_bad'));
    }
    for (const raw of ['10000', '10001', '123456', '+10000']) {
      expectBytes(limitEvolutionJson(evolutionJson, raw), goldenBytes('evolution_days_big'));
    }
    expectBytes(limitEvolutionJson(evolutionJson, null), goldenBytes('evolution_full'));
    expectBytes(limitEvolutionCsv(evolutionCsv, 'abc'), goldenBytes('evolution_csv_full'));
    expectBytes(limitEvolutionCsv(evolutionCsv, undefined), goldenBytes('evolution_csv_full'));
  });

  it('returns everything when the limit reaches the number of rows', () => {
    expect(limitEvolutionJson(evolutionJson, '9365')).toBe(evolutionJson);
    expect(limitEvolutionJson(evolutionJson, '9999')).toBe(evolutionJson);
    expect(limitEvolutionCsv(evolutionCsv, '9365')).toBe(evolutionCsv);
    expect(limitEvolutionCsv(evolutionCsv, '9999')).toBe(evolutionCsv);
    expect(limitEvolutionJson(evolutionJson, '9364')).toBe(renderEvolutionJson(evolutionRows.slice(0, 9364)));
    expect(limitEvolutionCsv(evolutionCsv, '9364')).toBe(renderEvolutionCsv(evolutionRows.slice(0, 9364)));
  });

  it('slices every prefix consistently with rendering that prefix', () => {
    for (const rows of [1, 2, 3, 4, 7, 100, 1001]) {
      expect(sliceEvolutionJson(evolutionJson, rows)).toBe(renderEvolutionJson(evolutionRows.slice(0, rows)));
      expect(sliceEvolutionCsv(evolutionCsv, rows)).toBe(renderEvolutionCsv(evolutionRows.slice(0, rows)));
    }
    expect(sliceEvolutionJson(BODY.null, 5)).toBe(BODY.null);
    expect(sliceEvolutionCsv(BODY.csvHeader, 5)).toBe(BODY.csvHeader);
  });
});

describe('currency body', () => {
  const rows = parseCurrency(goldenText('currency'));

  it('renders currency byte for byte, including U+02BB and the zero-width space', () => {
    expect(rows).toHaveLength(169);
    expect(rows.find((row) => row.code === 'TOP')?.name).toBe('Paʻanga');
    expect(rows.find((row) => row.code === 'VES')?.name).toBe('Bolívar soberano​ Venezolano');
    expectBytes(renderCurrency(rows), goldenBytes('currency'));
  });

  it('skips currencies without a value and renders null for none', () => {
    const [first, second] = rows;
    expect(renderCurrency([{ ...first!, valueHundredths: null }, second!])).toBe('[{"code":"BTC","name":"Bitcoin","value":0.00}]\n');
    expect(renderCurrency([])).toBe('null\n');
    expect(renderCurrency([{ ...first!, valueHundredths: null }])).toBe('null\n');
  });
});

describe('historical bodies', () => {
  it('renders the weekday body and the weekend bodies from the Friday rows', () => {
    const friday = renderHistorical(dayPair('2024-01-05'));
    expect(friday.status).toBe(200);
    expectBytes(friday.body, goldenBytes('historical_weekday'));
    expectBytes(friday.body, goldenBytes('historical_sat'));
    expectBytes(friday.body, goldenBytes('historical_sun'));
  });

  it('answers 404 "day not found" for days without a blue row', () => {
    for (const [day, name] of [['2011-01-02', 'historical_old'], ['2030-01-01', 'historical_future']] as const) {
      const response = renderHistorical(dayPair(day));
      expect(response.status).toBe(404);
      expectBytes(response.body, goldenBytes(name));
    }
    expect(renderHistorical({ oficial: { buy: 5, sell: 6 }, blue: { buy: 5, sell: 0 } }).status).toBe(404);
  });

  it('has the fixed "bad day" body', () => {
    expectBytes(BODY.badDay, goldenBytes('historical_missing'));
    expectBytes(BODY.badDay, goldenBytes('historical_bad'));
  });

  it('answers 200 with oficial zeros on the blue-only day 2013-04-05', () => {
    expect(renderHistorical(dayPair('2013-04-05'))).toEqual({
      status: 200,
      body: '{"oficial":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},"blue":{"value_avg":8.00,"value_sell":8.00,"value_buy":8.00}}\n',
    });
  });
});

describe('fixed bodies and content types', () => {
  it('matches the captured error bodies', () => {
    expectBytes(BODY.notFound, goldenBytes('notfound'));
    expectBytes(BODY.notFound, goldenBytes('latest_slash'));
    expectBytes(BODY.methodNotAllowed, goldenBytes('post'));
    expectBytes(BODY.root, goldenBytes('root'));
    expectBytes(BODY.null, goldenBytes('evolution_days0'));
    expect(goldenBytes('options')).toHaveLength(0);
    expect(BODY.internalServerError).toBe('{"message":"Internal Server Error"}\n');
    expect(BODY.badRequest).toBe('{"message":"Bad Request"}\n');
  });

  it('uses the legacy content types', () => {
    expect(CONTENT_TYPE).toEqual({
      json: 'application/json; charset=UTF-8',
      javascript: 'application/javascript; charset=UTF-8',
      csv: 'text/csv',
      text: 'text/plain; charset=UTF-8',
    });
    expect(RENDERED_CONTENT_TYPE.evolution_csv).toBe('text/csv');
    expect(RENDERED_CONTENT_TYPE.latest).toBe('application/json; charset=UTF-8');
  });
});

describe('latest and last_price bodies', () => {
  it('round-trips the microsecond timestamp through storage form', () => {
    expect(latest.blue?.updatedAt).toBe('2026-11-20T22:45:51.758024Z');
  });

  it('renders v2_latest byte for byte', () => {
    expectBytes(renderLatest(latest), goldenBytes('v2_latest'));
    expectBytes(renderLatest(latest), goldenBytes('origin'));
  });

  it('renders v2_latest_jsonp byte for byte', () => {
    expectBytes(wrapJsonp('myCb', renderLatest(latest)), goldenBytes('v2_latest_jsonp'));
  });

  it('renders v1_last_price (+ JSONP) byte for byte with legacyBlueBug', () => {
    const body = renderLastPrice(latest, { legacyBlueBug: true });
    expectBytes(body, goldenBytes('v1_last_price'));
    expectBytes(wrapJsonp('myCb', body), goldenBytes('v1_last_price_jsonp'));
  });

  it('carries the blue values in the fixed variant', () => {
    expect(renderLastPrice(latest, { legacyBlueBug: false })).toBe(
      '[{"date":"2026-11-20T19:45:51.758024-03:00","source":"oficial","value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},' +
        '{"date":"2026-11-20T19:45:51.758024-03:00","source":"blue","value_avg":1652.50,"value_sell":1670.00,"value_buy":1635.00}]\n',
    );
  });

  it('renders zeros and the Go zero time for missing rows', () => {
    expect(renderLatest({ oficial: null, blue: null })).toBe(
      '{"oficial":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},"blue":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},' +
        '"oficial_euro":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},"blue_euro":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},' +
        '"last_update":"0001-01-01T00:00:00Z"}\n',
    );
    expect(renderLastPrice({ oficial: latest.oficial, blue: null }, { legacyBlueBug: false })).toBe(
      '[{"date":"0001-01-01T00:00:00Z","source":"oficial","value_avg":1574.50,"value_sell":1601.00,"value_buy":1548.00},' +
        '{"date":"0001-01-01T00:00:00Z","source":"blue","value_avg":0.00,"value_sell":0.00,"value_buy":0.00}]\n',
    );
  });

  it('emits millisecond timestamps Go-style', () => {
    const at = (updatedAt: string): string => renderLatest({ oficial: null, blue: { ...latest.blue!, updatedAt } });
    expect(at('2026-11-23T13:05:00.000Z')).toContain('"last_update":"2026-11-23T10:05:00-03:00"}');
    expect(at('2026-11-23T13:05:00.120Z')).toContain('"last_update":"2026-11-23T10:05:00.12-03:00"}');
    expect(at('2026-11-23T02:05:00.007Z')).toContain('"last_update":"2026-11-22T23:05:00.007-03:00"}');
  });
});

describe('alerts body', () => {
  const { current, previous } = parseAlerts(goldenText('v2_alerts'));

  it('renders v2_alerts byte for byte', () => {
    expect(current.alertAt).toBe('2026-11-20T20:00:54.374497Z');
    expectBytes(renderAlerts(current, previous), goldenBytes('v2_alerts'));
  });

  it('renders zeros when there are no alerts', () => {
    expect(renderAlerts(null, null)).toBe(
      '{"alert_id":0,"alert_at":"0001-01-01T00:00:00Z","current":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00},' +
        '"previous":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00}}\n',
    );
  });

  it('renders previous zeros for the very first alert', () => {
    expect(renderAlerts({ id: 1, alertAt: '2026-11-23T13:05:00.000Z', buy: 1640, sell: 1680 }, null)).toBe(
      '{"alert_id":1,"alert_at":"2026-11-23T13:05:00Z","current":{"value_avg":1660.00,"value_sell":1680.00,"value_buy":1640.00},' +
        '"previous":{"value_avg":0.00,"value_sell":0.00,"value_buy":0.00}}\n',
    );
  });
});

describe('etag', () => {
  it('is the quoted 16-hex-digit SHA-256 prefix of the body', async () => {
    expect(await etag(goldenText('v2_latest'))).toBe('"761c5e8b4122d23e"');
    expect(await etag(evolutionJson)).toBe('"4fee6951c154fcdf"');
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes the UTF-8 bytes', async () => {
    const { createHash } = await import('node:crypto');
    const currency = goldenBytes('currency');
    expect(await sha256Hex(currency.toString('utf8'))).toBe(createHash('sha256').update(currency).digest('hex'));
  });
});

// The fixtures in test/fixtures/live-pretty are responses of the legacy production API to the
// undocumented `?pretty` switch, captured with public GETs on 2026-11-22 (a Sunday: /v2/latest was
// byte-identical to the golden at that moment). File name = endpoint; see each test for the query.
describe('prettyJson against live ?pretty captures', () => {
  const alerts = parseAlerts(goldenText('v2_alerts'));

  it('GET /v2/latest?pretty', () => {
    expectBytes(prettyJson(renderLatest(latest)), livePrettyBytes('latest_pretty'));
  });

  it('GET /v2/latest?pretty&callback=myCb', () => {
    expectBytes(wrapJsonp('myCb', prettyJson(renderLatest(latest))), livePrettyBytes('latest_jsonp_pretty'));
  });

  it('GET /v2/alerts?pretty', () => {
    expectBytes(prettyJson(renderAlerts(alerts.current, alerts.previous)), livePrettyBytes('alerts_pretty'));
  });

  it('GET /json/last_price?pretty', () => {
    expectBytes(prettyJson(renderLastPrice(latest, { legacyBlueBug: true })), livePrettyBytes('last_price_pretty'));
  });

  it('GET /v2/evolution.json?days=3&pretty', () => {
    expectBytes(prettyJson(limitEvolutionJson(evolutionJson, '3')), livePrettyBytes('evolution_days3_pretty'));
  });

  it('GET /v2/evolution.json?days=0&pretty', () => {
    expectBytes(prettyJson(limitEvolutionJson(evolutionJson, '0')), livePrettyBytes('evolution_days0_pretty'));
  });

  it('GET /v2/historical?day=2024-01-05&pretty', () => {
    expectBytes(prettyJson(renderHistorical(dayPair('2024-01-05')).body), livePrettyBytes('historical_pretty'));
  });

  it('GET /data/json/currency.json?pretty', () => {
    expectBytes(prettyJson(goldenText('currency')), livePrettyBytes('currency_pretty'));
  });

  it('GET /nope?pretty (404)', () => {
    expectBytes(prettyJson(BODY.notFound), livePrettyBytes('notfound_pretty'));
  });
});
