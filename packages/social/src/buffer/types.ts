/** Buffer's `Service` enum (X is `twitter`). */
export type BufferService =
  | 'bluesky'
  | 'facebook'
  | 'googlebusiness'
  | 'instagram'
  | 'linkedin'
  | 'mastodon'
  | 'pinterest'
  | 'startPage'
  | 'substack'
  | 'threads'
  | 'tiktok'
  | 'twitter'
  | 'whatsapp'
  | 'youtube';

/** The services this client can build an image post for. */
export const POSTING_SERVICES = ['instagram', 'twitter', 'facebook', 'linkedin'] as const;
export type PostingService = (typeof POSTING_SERVICES)[number];

/** Feed post or story (`PostType` / `PostTypeFacebook` member). X has no stories. */
export type BufferPostKind = 'post' | 'story';

export type BufferPostStatus = 'draft' | 'error' | 'needs_approval' | 'scheduled' | 'sending' | 'sent';

export interface BufferOrganization {
  id: string;
  name: string;
}

export interface BufferChannel {
  /** Buffer's channel id: the value `createPost` and `BUFFER_CHANNELS` need. */
  id: string;
  name: string;
  displayName: string | null;
  service: BufferService;
  /** The account's id on the network (not usable as `channelId`). */
  serviceId: string;
  descriptor: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
}

export interface BufferPost {
  id: string;
  status: BufferPostStatus;
  text: string;
  channelId: string;
  channelService: BufferService;
  dueAt: string | null;
  sentAt: string | null;
  externalLink: string | null;
  /** Set when the network refused the post (`status: 'error'`). */
  error: { message: string; supportUrl: string | null } | null;
}

export interface CreateImagePostInput {
  channelId: string;
  service: PostingService;
  /** Caption. Omitted from the request when empty (stories carry no caption). */
  text?: string;
  /** Public JPEG URL; Buffer downloads it. */
  imageUrl: string;
  /** Omitted when empty; stories do not support alt text on Instagram. */
  altText?: string;
  kind: BufferPostKind;
  /** Save as a Buffer draft instead of publishing now (never published). */
  draft?: boolean;
}
