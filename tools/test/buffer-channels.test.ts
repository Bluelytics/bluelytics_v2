import { describe, expect, it } from 'vitest';
import type { BufferChannel, BufferService } from '@bluelytics/social';
import { main, suggestChannels } from '../src/buffer-channels.ts';

const KEY = 'buffer-test-key-0123456789abcdef';

const channel = (id: string, service: BufferService, extra: Partial<Record<'isDisconnected' | 'isLocked' | 'isQueuePaused', boolean>> = {}): BufferChannel => ({
  id,
  name: `bluelytics-${service}`,
  displayName: null,
  service,
  serviceId: `svc-${id}`,
  descriptor: service,
  isDisconnected: false,
  isLocked: false,
  isQueuePaused: false,
  ...extra,
});

/** Answers Buffer's GraphQL operations by name and records the requests. */
function mockBuffer(channels: BufferChannel[], errors?: unknown[]) {
  const auth: string[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    auth.push(new Headers(init.headers).get('authorization') ?? '');
    if (errors) return Response.json({ errors });
    const { operationName } = JSON.parse(String(init.body)) as { operationName: string };
    if (operationName === 'ListOrganizations') return Response.json({ data: { account: { organizations: [{ id: 'org1', name: 'bluelytics' }] } } });
    if (operationName === 'ListChannels') return Response.json({ data: { channels } });
    return Response.json({ errors: [{ message: `unexpected ${operationName}` }] });
  };
  return { fetch, auth };
}

async function run(channels: BufferChannel[], errors?: unknown[]) {
  const lines: string[] = [];
  const buffer = mockBuffer(channels, errors);
  const code = await main([], { env: { BUFFER_API_KEY: KEY }, fetch: buffer.fetch, out: (line) => lines.push(line) });
  return { code, output: lines.join('\n'), auth: buffer.auth };
}

describe('buffer:channels', () => {
  it('lists the channels and prints BUFFER_CHANNELS with Buffer channel ids', async () => {
    const { code, output, auth } = await run([
      channel('ig1', 'instagram'),
      channel('tw1', 'twitter', { isQueuePaused: true }),
      channel('li1', 'linkedin'),
      channel('fb1', 'facebook', { isDisconnected: true }),
    ]);
    expect(code).toBe(0);
    expect(auth).toEqual([`Bearer ${KEY}`, `Bearer ${KEY}`]);
    expect(output).toMatch(/bluelytics\s+ig1\s+instagram\s+bluelytics-instagram\s+ok/);
    expect(output).toMatch(/fb1\s+facebook\s+bluelytics-facebook\s+disconnected/);
    expect(output).toContain('warning: twitter: the queue of tw1 is paused in Buffer');
    expect(output).toContain('warning: facebook: every channel is disconnected or locked');
    expect(output).toContain('BUFFER_CHANNELS={"instagram":"ig1","twitter":"tw1"}');
    expect(output).not.toContain('svc-ig1');
    expect(output).not.toContain(KEY);
  });

  it('chooses the first of several usable channels and says so', () => {
    expect(suggestChannels([channel('a', 'twitter'), channel('b', 'twitter')])).toEqual({
      json: '{"twitter":"a"}',
      warnings: ['twitter: 2 usable channels, chose a (bluelytics-twitter); others: b'],
    });
  });

  it('fails without a usable channel', async () => {
    const { code, output } = await run([channel('li1', 'linkedin')]);
    expect(code).toBe(1);
    expect(output).toContain('No usable channel');
  });

  it('needs BUFFER_API_KEY and never prints it in errors', async () => {
    await expect(main([], { env: {} })).rejects.toThrow(/BUFFER_API_KEY is not set/);
    const buffer = mockBuffer([], [{ message: `Invalid API key ${KEY}`, extensions: { code: 'UNAUTHORIZED' } }]);
    const failure = main([], { env: { BUFFER_API_KEY: KEY }, fetch: buffer.fetch, out: () => undefined });
    await expect(failure).rejects.toThrow(/^UNAUTHORIZED: .*Invalid API key \[BUFFER_API_KEY\].*Settings → API/);
    await expect(failure).rejects.not.toThrow(KEY);
  });

  it('prints its help', async () => {
    const lines: string[] = [];
    expect(await main(['--help'], { out: (line) => lines.push(line) })).toBe(0);
    expect(lines.join('\n')).toContain('Usage: pnpm buffer:channels');
  });
});
