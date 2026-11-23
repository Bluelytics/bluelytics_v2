import type { BufferPostKind, CreateImagePostInput, PostingService } from './types.ts';

/** The subset of Buffer's `CreatePostInput` this client sends. */
export interface CreatePostInputJson {
  channelId: string;
  schedulingType: 'automatic';
  mode: 'shareNow' | 'addToQueue';
  saveToDraft?: true;
  text?: string;
  assets: { image: { url: string; metadata?: { altText: string } } }[];
  metadata?: PostMetadataJson;
}

export type PostMetadataJson =
  | { instagram: { type: BufferPostKind; shouldShareToFeed: boolean } }
  | { facebook: { type: BufferPostKind } };

function metadataFor(service: PostingService, kind: BufferPostKind): PostMetadataJson | undefined {
  switch (service) {
    case 'instagram':
      // Required by the schema; a story is not also shared to the feed (the feed gets its own post).
      return { instagram: { type: kind, shouldShareToFeed: kind === 'post' } };
    case 'facebook':
      return { facebook: { type: kind } };
    case 'twitter':
      if (kind !== 'post') throw new RangeError('X (twitter) has no stories');
      return undefined;
    case 'linkedin':
      // LinkedInPostMetadataInput has only optional fields; an image post needs none.
      if (kind !== 'post') throw new RangeError('LinkedIn has no stories');
      return undefined;
  }
}

/**
 * `CreatePostInput` for one image post: published at once by Buffer (`shareNow`, `automatic`), or a
 * draft (`saveToDraft` + `addToQueue`). Only the channel's own metadata key is sent; X and LinkedIn need none.
 */
export function buildCreatePostInput(post: CreateImagePostInput): CreatePostInputJson {
  const image: CreatePostInputJson['assets'][number]['image'] = { url: post.imageUrl };
  if (post.altText) image.metadata = { altText: post.altText };
  const input: CreatePostInputJson = {
    channelId: post.channelId,
    schedulingType: 'automatic',
    mode: post.draft ? 'addToQueue' : 'shareNow',
    assets: [{ image }],
  };
  if (post.draft) input.saveToDraft = true;
  if (post.text) input.text = post.text;
  const metadata = metadataFor(post.service, post.kind);
  if (metadata) input.metadata = metadata;
  return input;
}
