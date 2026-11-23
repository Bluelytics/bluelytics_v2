import { describe, expect, it } from 'vitest';
import { buildCaption, parseBufferChannels, planPosts, toCreateImagePostInput } from '../src/index.ts';
import { UP } from './fixtures.ts';

describe('parseBufferChannels', () => {
  it('accepts the documented string form', () => {
    expect(parseBufferChannels('{"twitter":"64f0aa11bb22cc33dd44ee55","instagram":"64f0aa11bb22cc33dd44ee66"}')).toEqual({
      twitter: { channelId: '64f0aa11bb22cc33dd44ee55', story: false },
      instagram: { channelId: '64f0aa11bb22cc33dd44ee66', story: false },
    });
  });

  it('accepts the object form with stories', () => {
    expect(parseBufferChannels('{"instagram":{"channelId":"ig1","story":true}}')).toEqual({ instagram: { channelId: 'ig1', story: true } });
    expect(parseBufferChannels('{}')).toEqual({});
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['["ig1"]', 'JSON object'],
    ['{"mastodon":"m1"}', 'unsupported network "mastodon"'],
    ['{"twitter":""}', 'missing channel id'],
    ['{"twitter":42}', 'expected a channel id'],
    ['{"instagram":{"channelId":"ig1","story":"yes"}}', 'must be a boolean'],
    ['{"twitter":{"channelId":"x1","story":true}}', 'stories are not supported'],
  ])('rejects %s', (json, message) => {
    expect(() => parseBufferChannels(json)).toThrow(message);
  });
});

describe('planPosts', () => {
  it('maps each configured network to its card size and caption', () => {
    const specs = planPosts(parseBufferChannels('{"twitter":"x1","instagram":{"channelId":"ig1","story":true}}'), { kind: 'update', data: UP });
    expect(specs.map(({ network, postKind, size, viewport }) => ({ network, postKind, size, viewport }))).toEqual([
      { network: 'instagram', postKind: 'post', size: 'portrait', viewport: { width: 1080, height: 1350 } },
      { network: 'instagram', postKind: 'story', size: 'story', viewport: { width: 1080, height: 1920 } },
      { network: 'twitter', postKind: 'post', size: 'landscape', viewport: { width: 1600, height: 900 } },
    ]);
    expect(specs[0]).toMatchObject({ channelId: 'ig1', cardKind: 'update', text: buildCaption('instagram', 'update', UP) });
    expect(specs[0]?.altText).toMatch(/^Dólar blue: venta \$ 1\.675/);
    expect(specs[1]).toMatchObject({ text: '', altText: '' });
    expect(specs[2]?.text).toBe(buildCaption('twitter', 'update', UP));
  });

  it('plans nothing without channels and portrait for Facebook', () => {
    expect(planPosts({}, { kind: 'weekly', data: UP })).toEqual([]);
    expect(planPosts({ facebook: { channelId: 'fb1', story: false } }, { kind: 'weekly', data: UP })[0]).toMatchObject({
      network: 'facebook',
      size: 'portrait',
      cardKind: 'weekly',
    });
  });

  it('turns a spec into a Buffer request', () => {
    const [spec] = planPosts({ twitter: { channelId: 'x1', story: false } }, { kind: 'update', data: UP });
    if (!spec) throw new Error('no spec');
    expect(toCreateImagePostInput(spec, 'https://media.bluelytics.com.ar/social/2026/11/twitter-a.jpg', { draft: true })).toEqual({
      channelId: 'x1',
      service: 'twitter',
      text: spec.text,
      imageUrl: 'https://media.bluelytics.com.ar/social/2026/11/twitter-a.jpg',
      altText: spec.altText,
      kind: 'post',
      draft: true,
    });
  });
});
