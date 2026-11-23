import { buildAltText, buildCaption, type PostCardKind } from './captions.ts';
import { CARD_SIZES, type CardData, type CardSize, type Viewport } from './cards/types.ts';
import { POSTING_SERVICES, type BufferPostKind, type CreateImagePostInput, type PostingService } from './buffer/types.ts';

export interface ChannelConfig {
  /** Buffer channel id (`Channel.id`, not `serviceId`). */
  channelId: string;
  /** Also post the card as a story (Instagram, Facebook). */
  story: boolean;
}

/** Parsed `BUFFER_CHANNELS`: only the listed networks are posted to. */
export type BufferChannels = Partial<Record<PostingService, ChannelConfig>>;

const STORY_SERVICES: ReadonlySet<PostingService> = new Set(['instagram', 'facebook']);
const FEED_SIZE: Readonly<Record<PostingService, CardSize>> = {
  twitter: 'landscape',
  instagram: 'portrait',
  facebook: 'portrait',
  // LinkedIn shows feed images best near 1.91:1; the 16:9 landscape card is the closest size.
  linkedin: 'landscape',
};

const isPostingService = (key: string): key is PostingService => (POSTING_SERVICES as readonly string[]).includes(key);

/**
 * Parses the `BUFFER_CHANNELS` var: `{"twitter":"<id>","instagram":"<id>"}`, where a value may
 * also be `{"channelId":"<id>","story":true}`. Throws on anything else, so a typo fails loudly
 * instead of silently skipping a network.
 */
export function parseBufferChannels(json: string): BufferChannels {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new TypeError('BUFFER_CHANNELS is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('BUFFER_CHANNELS must be a JSON object of network → channel id');
  }
  const channels: BufferChannels = {};
  for (const [network, value] of Object.entries(raw)) {
    if (!isPostingService(network)) {
      throw new TypeError(`BUFFER_CHANNELS: unsupported network "${network}" (expected ${POSTING_SERVICES.join(', ')})`);
    }
    const config: unknown = typeof value === 'string' ? { channelId: value } : value;
    if (typeof config !== 'object' || config === null) throw new TypeError(`BUFFER_CHANNELS.${network}: expected a channel id`);
    const { channelId, story = false } = config as { channelId?: unknown; story?: unknown };
    if (typeof channelId !== 'string' || channelId.trim() === '') {
      throw new TypeError(`BUFFER_CHANNELS.${network}: missing channel id`);
    }
    if (typeof story !== 'boolean') throw new TypeError(`BUFFER_CHANNELS.${network}.story must be a boolean`);
    if (story && !STORY_SERVICES.has(network)) throw new TypeError(`BUFFER_CHANNELS.${network}: stories are not supported`);
    channels[network] = { channelId: channelId.trim(), story };
  }
  return channels;
}

/** What to post on one network for one decision. */
export interface PostFacts {
  kind: PostCardKind;
  data: CardData;
}

/** One image post: which card to render, where to send it and with which text. */
export interface PostSpec {
  network: PostingService;
  channelId: string;
  postKind: BufferPostKind;
  cardKind: PostCardKind;
  size: CardSize;
  viewport: Viewport;
  /** Empty for stories (no caption). */
  text: string;
  /** Empty for stories (Instagram does not take alt text on stories). */
  altText: string;
}

/**
 * Maps the configured channels to the posts to make, in `POSTING_SERVICES` order: X gets the
 * landscape card, Instagram and Facebook the portrait card plus, when enabled, a story.
 */
export function planPosts(channels: BufferChannels, facts: PostFacts): PostSpec[] {
  const specs: PostSpec[] = [];
  for (const network of POSTING_SERVICES) {
    const config = channels[network];
    if (!config) continue;
    const size = FEED_SIZE[network];
    specs.push({
      network,
      channelId: config.channelId,
      postKind: 'post',
      cardKind: facts.kind,
      size,
      viewport: CARD_SIZES[size],
      text: buildCaption(network, facts.kind, facts.data),
      altText: buildAltText(facts.kind, facts.data),
    });
    if (config.story) {
      specs.push({
        network,
        channelId: config.channelId,
        postKind: 'story',
        cardKind: facts.kind,
        size: 'story',
        viewport: CARD_SIZES.story,
        text: '',
        altText: '',
      });
    }
  }
  return specs;
}

/** The Buffer request for a planned post once its image is on a public URL. */
export function toCreateImagePostInput(spec: PostSpec, imageUrl: string, options: { draft?: boolean } = {}): CreateImagePostInput {
  return {
    channelId: spec.channelId,
    service: spec.network,
    text: spec.text,
    imageUrl,
    altText: spec.altText,
    kind: spec.postKind,
    draft: options.draft ?? false,
  };
}
