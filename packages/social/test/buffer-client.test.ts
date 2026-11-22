import { describe, expect, it } from 'vitest';
import { BufferClient, BufferError, buildCreatePostInput, type FetchLike } from '../src/index.ts';

const API_KEY = 'test-key-not-real';

interface Call {
  url: string;
  init: RequestInit;
  body: { query: string; variables: Record<string, unknown>; operationName: string };
}

function mockFetch(...responses: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const client = (fetch: FetchLike) => new BufferClient({ apiKey: API_KEY, fetch, now: () => Date.parse('2026-11-20T18:00:00Z') });

const SENT_POST = {
  id: '673e1f0c9a1b2c3d4e5f6a7b',
  status: 'sending',
  text: 'El dólar blue subió a $ 1.675',
  channelId: '64f0aa11bb22cc33dd44ee55',
  channelService: 'instagram',
  dueAt: '2026-11-20T18:45:31.000Z',
  sentAt: null,
  externalLink: null,
  error: null,
};

async function failure(promise: Promise<unknown>): Promise<BufferError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BufferError);
  const bufferError = err as BufferError;
  expect(bufferError.message).not.toContain(API_KEY);
  return bufferError;
}

describe('BufferClient requests', () => {
  it('POSTs a named GraphQL operation with the bearer key', async () => {
    const { fetch, calls } = mockFetch(json({ data: { account: { organizations: [{ id: '5f9a8b7c6d5e4f3a2b1c0d9e', name: 'bluelytics' }] } } }));
    expect(await client(fetch).listOrganizations()).toEqual([{ id: '5f9a8b7c6d5e4f3a2b1c0d9e', name: 'bluelytics' }]);
    const [call] = calls;
    expect(call?.url).toBe('https://api.buffer.com');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' });
    expect(call?.body.operationName).toBe('ListOrganizations');
    expect(call?.body.query).toContain('account { organizations { id name } }');
  });

  it('lists the channels of an organization', async () => {
    const channel = {
      id: '64f0aa11bb22cc33dd44ee55',
      name: 'bluelytics',
      displayName: 'Bluelytics',
      service: 'instagram',
      serviceId: '17841400000000000',
      descriptor: 'Instagram Business',
      isDisconnected: false,
      isLocked: false,
      isQueuePaused: false,
    };
    const { fetch, calls } = mockFetch(json({ data: { channels: [channel] } }));
    expect(await client(fetch).listChannels('5f9a8b7c6d5e4f3a2b1c0d9e')).toEqual([channel]);
    expect(calls[0]?.body.variables).toEqual({ organizationId: '5f9a8b7c6d5e4f3a2b1c0d9e' });
  });

  it('creates an Instagram feed post that publishes now', async () => {
    const { fetch, calls } = mockFetch(json({ data: { createPost: { __typename: 'PostActionSuccess', post: SENT_POST } } }));
    const post = await client(fetch).createImagePost({
      channelId: SENT_POST.channelId,
      service: 'instagram',
      text: SENT_POST.text,
      imageUrl: 'https://media.bluelytics.com.ar/social/2026/11/instagram-update-2026-11-20-1675.jpg',
      altText: 'Dólar blue: venta $ 1.675.',
      kind: 'post',
    });
    expect(post).toEqual(SENT_POST);
    expect(calls[0]?.body.variables).toEqual({
      input: {
        channelId: SENT_POST.channelId,
        schedulingType: 'automatic',
        mode: 'shareNow',
        text: SENT_POST.text,
        assets: [
          {
            image: {
              url: 'https://media.bluelytics.com.ar/social/2026/11/instagram-update-2026-11-20-1675.jpg',
              metadata: { altText: 'Dólar blue: venta $ 1.675.' },
            },
          },
        ],
        metadata: { instagram: { type: 'post', shouldShareToFeed: true } },
      },
    });
  });

  it('reads and deletes a post', async () => {
    const failed = { ...SENT_POST, status: 'error', error: { message: 'Instagram rejected the image', supportUrl: null } };
    const { fetch, calls } = mockFetch(
      json({ data: { post: failed } }),
      json({ data: { deletePost: { __typename: 'DeletePostSuccess', id: SENT_POST.id } } }),
    );
    const c = client(fetch);
    expect(await c.getPost(SENT_POST.id)).toEqual(failed);
    expect(await c.deletePost(SENT_POST.id)).toBe(SENT_POST.id);
    expect(calls.map((x) => x.body.variables)).toEqual([{ id: SENT_POST.id }, { id: SENT_POST.id }]);
  });
});

describe('buildCreatePostInput', () => {
  const base = { channelId: 'c1', text: 'hola', imageUrl: 'https://media.example/x.jpg', altText: 'alt' } as const;

  it('sends no metadata for X', () => {
    const input = buildCreatePostInput({ ...base, service: 'twitter', kind: 'post' });
    expect(input).not.toHaveProperty('metadata');
  });

  it('rejects X stories', () => {
    expect(() => buildCreatePostInput({ ...base, service: 'twitter', kind: 'story' })).toThrow(RangeError);
  });

  it('builds Instagram stories and Facebook posts', () => {
    expect(buildCreatePostInput({ ...base, service: 'instagram', kind: 'story' }).metadata).toEqual({
      instagram: { type: 'story', shouldShareToFeed: false },
    });
    expect(buildCreatePostInput({ ...base, service: 'facebook', kind: 'post' }).metadata).toEqual({ facebook: { type: 'post' } });
  });

  it('saves drafts instead of publishing', () => {
    expect(buildCreatePostInput({ ...base, service: 'instagram', kind: 'post', draft: true })).toMatchObject({
      mode: 'addToQueue',
      saveToDraft: true,
    });
  });

  it('omits empty text and alt text', () => {
    const input = buildCreatePostInput({ channelId: 'c1', service: 'instagram', kind: 'story', imageUrl: 'https://m/x.jpg', text: '', altText: '' });
    expect(input).not.toHaveProperty('text');
    expect(input.assets).toEqual([{ image: { url: 'https://m/x.jpg' } }]);
  });
});

describe('BufferClient errors', () => {
  const post = { channelId: 'c1', service: 'twitter', text: 'x', imageUrl: 'https://m/x.jpg', altText: 'a', kind: 'post' } as const;

  it('surfaces typed mutation errors by __typename', async () => {
    const { fetch } = mockFetch(
      json({
        data: {
          createPost: {
            __typename: 'InvalidInputError',
            message: 'Failed to create post: Failed to fetch image dimensions: Not Found',
          },
        },
      }),
    );
    const err = await failure(client(fetch).createImagePost(post));
    expect(err).toMatchObject({ code: 'MUTATION_ERROR', typename: 'InvalidInputError', retryable: false });
    expect(err.message).toContain('Failed to fetch image dimensions');
  });

  it('surfaces a LimitReachedError and a VoidMutationError on delete', async () => {
    const { fetch } = mockFetch(
      json({ data: { createPost: { __typename: 'LimitReachedError', message: 'Daily posting limit reached' } } }),
      json({ data: { deletePost: { __typename: 'VoidMutationError', message: 'Post not found' } } }),
    );
    const c = client(fetch);
    expect(await failure(c.createImagePost(post))).toMatchObject({ code: 'MUTATION_ERROR', typename: 'LimitReachedError' });
    expect(await failure(c.deletePost('p1'))).toMatchObject({ code: 'MUTATION_ERROR', typename: 'VoidMutationError' });
  });

  it('maps HTTP 200 with errors[] to the extension code (legacy v1 token)', async () => {
    const { fetch } = mockFetch(
      json({ errors: [{ message: 'Actor does not have permission to make a call to this edge.', extensions: { code: 'FORBIDDEN' } }] }),
    );
    const err = await failure(client(fetch).listOrganizations());
    expect(err).toMatchObject({ code: 'FORBIDDEN', status: 200, retryable: false });
    expect(err.message).toContain('Actor does not have permission');
  });

  it('treats both HTTP 401 and 200 + UNAUTHORIZED as unauthorized', async () => {
    const { fetch } = mockFetch(
      json({ errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHORIZED' } }] }, 401),
      json({ errors: [{ message: 'Invalid API key', extensions: { code: 'UNAUTHORIZED' } }] }),
      new Response('Unauthorized', { status: 401 }),
    );
    const c = client(fetch);
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'UNAUTHORIZED', status: 200 });
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('reports 429 with Retry-After in seconds or as an HTTP date', async () => {
    const body = { errors: [{ message: 'Too many requests, please try again later.', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] };
    const { fetch } = mockFetch(
      json(body, 429, { 'Retry-After': '120' }),
      json(body, 429, { 'Retry-After': 'Fri, 20 Nov 2026 18:01:30 GMT' }),
      json(body, 429),
    );
    const c = client(fetch);
    expect(await failure(c.createImagePost(post))).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429, retryAfterMs: 120_000, retryable: true });
    expect(await failure(c.createImagePost(post))).toMatchObject({ retryAfterMs: 90_000 });
    expect((await failure(c.createImagePost(post))).retryAfterMs).toBeUndefined();
  });

  it('classifies unknown codes, server errors, network failures and malformed bodies', async () => {
    const { fetch } = mockFetch(
      json({ errors: [{ message: 'Cannot query field "foo" on type "Query".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }, 400),
      new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      new TypeError('fetch failed'),
      new Response('<html>maintenance</html>', { status: 200 }),
      json({ data: { createPost: null } }),
      json({ errors: [{ message: 'Something went wrong', extensions: { code: 'UNEXPECTED' } }] }),
    );
    const c = client(fetch);
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'GRAPHQL_ERROR', status: 400 });
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'HTTP_ERROR', status: 502, retryable: true });
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'NETWORK', retryable: true });
    expect(await failure(c.listOrganizations())).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(await failure(c.createImagePost(post))).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(await failure(c.getPost('p1'))).toMatchObject({ code: 'UNEXPECTED', retryable: true });
  });

  it('requires an API key', () => {
    expect(() => new BufferClient({ apiKey: '' })).toThrow(TypeError);
  });
});
