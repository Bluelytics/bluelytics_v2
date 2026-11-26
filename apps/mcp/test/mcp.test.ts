// The Worker in Node on a real local D1 seeded with the legacy goldens, driven by the official MCP
// client over Streamable HTTP, plus raw requests for the stateless transport rules.
import type { D1DatabaseLike } from '@bluelytics/db';
import { createLocalD1, seedFromGoldens } from '@bluelytics/db/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index.ts';
import { createHandler } from '../src/http.ts';
import { createServer } from '../src/protocol.ts';
import { TOOLS, type ToolContext } from '../src/tools.ts';

let db: D1DatabaseLike;
let dispose: () => Promise<void>;
// The goldens end on Friday 2026-11-20.
const NOW = '2026-11-20T18:00:00.000Z';

const handler = createHandler<ToolContext>({ server: createServer({ info: { name: 'bluelytics', title: 'Bluelytics', version: 'test', websiteUrl: 'https://bluelytics.com.ar/mcp' }, instructions: 'test', tools: TOOLS }), about: { name: 'test' } });
const send = (request: Request) => handler.fetch(request, { db, now: () => NOW });
const fetchLike = (input: string | URL | Request, init?: RequestInit) => send(new Request(input, init));

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return send(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) }));
}

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), { fetch: fetchLike }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result as { isError?: boolean; structuredContent?: Record<string, any>; content: { type: string; text: string }[] };
}

beforeAll(async () => {
  const local = await createLocalD1();
  db = local.db;
  dispose = local.dispose;
  await seedFromGoldens(db);
});
afterAll(() => dispose());

describe('with the official MCP client', () => {
  it('initializes, lists four read-only tools and gets no session id', async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe('bluelytics');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['get_current_rates', 'get_rates_on_date', 'get_rate_history', 'convert_currency']);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect((client.transport as StreamableHTTPClientTransport).sessionId).toBeUndefined();
    await client.close();
  });

  it('get_current_rates', async () => {
    const client = await connect();
    const result = await call(client, 'get_current_rates');
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent!;
    expect(data['blue'].sell).toBeGreaterThan(data['blue'].buy);
    expect(data['blue'].average).toBe((data['blue'].buy + data['blue'].sell) / 2);
    expect(data['updated_at']).toMatch(/-03:00$/);
    expect(data['previous_close_day']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof data['gap_percent']).toBe('number');
    expect(data['license']).toBe('CC BY 4.0');
    expect(JSON.parse(result.content[0]!.text)).toEqual(data);
  });

  it('get_rates_on_date, with weekends mapped to Friday', async () => {
    const client = await connect();
    const friday = (await call(client, 'get_rates_on_date', { date: '2026-11-13' })).structuredContent!;
    const sunday = (await call(client, 'get_rates_on_date', { date: '2026-11-15' })).structuredContent!;
    expect(sunday['date']).toBe('2026-11-13');
    expect(sunday['blue']).toEqual(friday['blue']);
    const old = (await call(client, 'get_rates_on_date', { date: '2011-01-03' })).structuredContent!;
    expect(old['blue'].sell).toBeLessThan(10);
  });

  it('get_rates_on_date refuses bad and out-of-range dates with a readable error', async () => {
    const client = await connect();
    for (const date of ['20/11/2026', '2010-12-31', '2026-11-21x', '2027-01-01']) {
      const result = await call(client, 'get_rates_on_date', { date });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text.length).toBeGreaterThan(10);
    }
  });

  it('get_rate_history: daily for a month, monthly for years, summary in both', async () => {
    const client = await connect();
    const month = (await call(client, 'get_rate_history', { from: '2026-10-21', to: '2026-11-20' })).structuredContent!;
    expect(month['granularity']).toBe('daily');
    expect(month['rows'].length).toBeGreaterThan(15);
    expect(month['summary'].blue_sell_last.date).toBe('2026-11-20');
    const years = (await call(client, 'get_rate_history', { from: '2020-01-01', to: '2025-12-31' })).structuredContent!;
    expect(years['granularity']).toBe('monthly');
    expect(years['rows']).toHaveLength(72);
    expect(years['summary'].blue_sell_high.value).toBeGreaterThan(years['summary'].blue_sell_low.value);
    const tooLong = await call(client, 'get_rate_history', { from: '2020-01-01', granularity: 'daily' });
    expect(tooLong.isError).toBe(true);
  });

  it('convert_currency: dollars, euros, other currencies and back', async () => {
    const client = await connect();
    const latest = (await call(client, 'get_current_rates')).structuredContent!;
    const usd = (await call(client, 'convert_currency', { amount: 100 })).structuredContent!;
    expect(usd['blue'].if_you_buy).toBe(100 * latest['blue'].sell);
    expect(usd['blue'].if_you_sell).toBe(100 * latest['blue'].buy);
    const back = (await call(client, 'convert_currency', { amount: latest['blue'].sell * 10, direction: 'from_ars' })).structuredContent!;
    expect(back['blue'].if_you_buy).toBe(10);
    const eur = (await call(client, 'convert_currency', { amount: 1, currency: 'eur' })).structuredContent!;
    expect(eur['blue'].rate_sell).toBe(latest['blue_euro'].sell);
    const brl = (await call(client, 'convert_currency', { amount: 100, currency: 'BRL' })).structuredContent!;
    expect(brl['via_dollar']).toBe(true);
    expect(brl['blue'].if_you_buy).toBeLessThan(usd['blue'].if_you_buy);
    const unknown = await call(client, 'convert_currency', { amount: 1, currency: 'XYZ' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toContain('BRL');
  });
});

describe('stateless transport', () => {
  it('answers tools/call without initialize, and initialize issues no session', async () => {
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_current_rates', arguments: {} } }, { 'MCP-Protocol-Version': '2025-06-18' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(((await response.json()) as any).result.structuredContent.blue).toBeTruthy();
    const init = await post({ jsonrpc: '2.0', id: 'a', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    expect(init.headers.get('Mcp-Session-Id')).toBeNull();
    expect(((await init.json()) as any).result.protocolVersion).toBe('2025-03-26');
  });

  it('negotiates the newest revision for an unknown one, and rejects an unknown version header', async () => {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    expect(((await init.json()) as any).result.protocolVersion).toBe('2025-11-25');
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })).status).toBe(400);
  });

  it('accepts notifications with 202, batches, and ignores a stray session id', async () => {
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const batch = await post([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], { 'Mcp-Session-Id': 'whatever' });
    const answers = (await batch.json()) as any[];
    expect(answers.map((a) => a.id)).toEqual([1, 2]);
  });

  it('maps protocol errors to JSON-RPC errors', async () => {
    expect(((await (await post({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).json()) as any).error.code).toBe(-32601);
    expect(((await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } })).json()) as any).error.code).toBe(-32602);
    const parse = await send(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
    expect(parse.status).toBe(400);
  });

  it('refuses GET and DELETE on /mcp, wrong content types and huge bodies; serves CORS', async () => {
    expect((await send(new Request('https://mcp.test/mcp'))).status).toBe(405);
    expect((await send(new Request('https://mcp.test/mcp', { method: 'DELETE' }))).status).toBe(405);
    expect((await send(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }))).status).toBe(415);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Accept: 'text/html' })).status).toBe(406);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } })).status).toBe(413);
    const preflight = await send(new Request('https://mcp.test/mcp', { method: 'OPTIONS' }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('MCP-Protocol-Version');
    expect((await send(new Request('https://mcp.test/elsewhere', { method: 'POST' }))).status).toBe(404);
    expect(((await (await worker.fetch(new Request('https://mcp.test/'), { DB: db })).json()) as any).endpoint).toBe('https://mcp.bluelytics.com.ar/mcp');
  });

  it('the deployed entry point wires the database binding', async () => {
    const response = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), { DB: db });
    expect(((await response.json()) as any).result.tools).toHaveLength(4);
  });
});
