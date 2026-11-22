# Buffer API — migration from REST v1 to the current GraphQL API

Sources: developers.buffer.com pages read on 2026-11-22, two read-only live probes with the legacy
token, and the API's own schema. **The schema is the authority for input shapes**: Buffer answers GraphQL
introspection without a key, and the full result is saved next to this file as `buffer-schema.graphql`
(394 types, fetched 2026-11-22). Refresh it with an introspection query against `https://api.buffer.com`
if a mutation starts failing validation. Items marked **[unverified]** are behaviours the schema cannot
settle (they need a call with a valid key).

## Live probes (2026-11-22)

- Legacy REST v1 is still up: `GET https://api.bufferapp.com/1/profiles.json?access_token=…` → 200.
  The account has two connected profiles: `instagram` and `twitter` (no Facebook, no LinkedIn).
- The legacy v1 access token is **rejected** by the new API: `POST https://api.buffer.com` with
  `Authorization: Bearer <v1 token>` → HTTP 200, body
  `{"errors":[{"message":"Actor does not have permission to make a call to this edge.","extensions":{"code":"FORBIDDEN"}}]}`.
  A new API key must be created (Buffer → Settings → API, `https://publish.buffer.com/settings/api`).
- Not determined: whether old 24-hex profile ids equal new `Channel.id` values (needs a valid key;
  `pnpm buffer:channels` prints the channels).

## Basics

- GraphQL only. Endpoint `https://api.buffer.com`, always `POST`, JSON body `{"query": "...", "variables": {...}}`.
- Headers: `Content-Type: application/json`, `Authorization: Bearer YOUR_API_KEY`.
- Personal API keys act for the whole account (all organizations and channels); no documented expiry.
  Free plan: 1 key. (https://developers.buffer.com/guides/authentication.html, api-limits.html)
- Auth check:
  `{"query":"query { account { organizations { id name } } }"}`

## Old → new mapping (https://developers.buffer.com/guides/rest-migration.html)

| REST v1 | GraphQL |
|---|---|
| `GET /user.json` | `account { id email name organizations { id name } }` |
| `GET /profiles.json` | `channels(input: { organizationId }) { id name service avatar isQueuePaused }` |
| `GET /profiles/:id.json` | `channel(input: { id }) { … }` |
| `POST /updates/create.json` | `mutation createPost(input: {...})` — one mutation per channel |
| pending / sent updates | `posts(first, input: { organizationId, filter: { status: [scheduled|sent], channelIds }, sort })` |
| `/updates/:id/share.json` | `mode: shareNow` on `createPost` |

Parameter mapping for `updates/create.json`: `access_token` → header; `text` → `text`;
`profile_ids[]` → `channelId`; `now=true` → `mode: shareNow`; `scheduled_at` → `dueAt` + `mode: customScheduled`;
`media[photo]` → `assets: [{ image: { url } }]`; `media[thumbnail]` → `image.thumbnailUrl`;
`top`, `shorten` → no equivalent.

## Listing channels

```graphql
query { account { organizations { id name } } }
query { channels(input: { organizationId: "ORG_ID" }) {
  id name service serviceId displayName descriptor isDisconnected isLocked isQueuePaused externalLink } }
```
`Service` enum (schema): `bluesky`, `facebook`, `googlebusiness`, `instagram`, `linkedin`, `mastodon`,
`pinterest`, `startPage`, `substack`, `threads`, `tiktok`, `twitter`, `whatsapp`, `youtube`. X is `twitter`.
`Channel.serviceId` is the account's id on the network; `Channel.id` is Buffer's own id (the value
`createPost.channelId` needs).

## Creating an image post that publishes immediately

```graphql
mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id text status dueAt channelId } }
    ... on MutationError { message }
  }
}
```
```json
{ "input": { "text": "Caption", "channelId": "CHANNEL_ID", "schedulingType": "automatic",
  "mode": "shareNow", "assets": [ { "image": { "url": "https://media.example/photo.jpg" } } ] } }
```
- `CreatePostInput` (schema): `channelId: ChannelId!`, `mode: ShareMode!`, `schedulingType: SchedulingType!`
  are the only fields a caller must send. `assets: [AssetInput!]! = []` and `needsApproval: Boolean! = false`
  have defaults, so they may be omitted. Optional: `text: String`, `dueAt: DateTime`,
  `metadata: PostInputMetaData`, `saveToDraft: Boolean`, `tagIds`, `draftId`, `ideaId`, `source`, `aiAssisted`.
- `AssetInput` takes exactly one of `image`, `video`, `document`.
  `ImageAssetInput { url: String!, thumbnailUrl: String, metadata: ImageMetadataInput }`;
  `ImageMetadataInput { altText: String!, animatedThumbnail: String, userTags: [UserTagInput!] }` — if
  `metadata` is sent, `altText` is required.
- `createPost` returns `PostActionPayload` = `PostActionSuccess | NotFoundError | UnauthorizedError |
  UnexpectedError | RestProxyError | LimitReachedError | InvalidInputError`; every error member implements
  `MutationError { message: String! }`.
- `ShareMode`: `addToQueue`, `customScheduled`, `shareNext`, `shareNow`.
  `SchedulingType`: `automatic` (Buffer publishes) or `notification` (reminder to publish by hand).
- Images: there is no upload endpoint; the image must be a public URL. A bad URL fails the mutation,
  e.g. `Failed to create post: Failed to fetch image dimensions: Not Found`. Format/size limits are not
  documented. Alt text: `image.metadata.altText`.
- Draft (safe for testing): `saveToDraft: true` with `mode: addToQueue` → status `draft`.
- Delete: `deletePost(input: { id })` → `DeletePostSuccess { id } | VoidMutationError`.
- `publishPostNow(input: { id })` sends an existing draft/scheduled/needs-approval/error post immediately and
  returns once it is queued (status usually `sending`); a post already sending or sent returns
  `UnauthorizedError`. Read the post again to learn the outcome.
- Outcome of a post: `post(input: { id }) { id status sentAt externalLink error { message supportUrl } }`.
  When the network refuses a post its `status` is `error` and `error.message` says why.

## Channel metadata (`PostInputMetaData`: only the key for the channel's network)

Keys: `bluesky`, `facebook`, `google`, `instagram`, `linkedin`, `mastodon`, `pinterest`, `substack`,
`threads`, `tiktok`, `twitter`, `youtube`.

Instagram (`InstagramPostMetadataInput`): `type: PostType!` and `shouldShareToFeed: Boolean!` are both
required; optional `firstComment`, `link`, `geolocation`, `isAiGenerated`, `stickerFields`.
`PostType` enum: `carousel`, `event`, `ghost_post`, `offer`, `post`, `reel`, `short`, `story`, `thread`,
`whats_new`. Feed image: `metadata: { instagram: { type: post, shouldShareToFeed: true } }`; story:
`type: story`. Text limit 2,196 characters.
X (`TwitterPostMetadataInput`): all fields optional (`thread`, `retweet`, `isAiGenerated`) — a single image
post needs no `metadata` at all.
Facebook (`FacebookPostMetadataInput`): `type: PostTypeFacebook!` (`post` | `reel` | `story`) is required
when the key is sent. `metadata.{service}.linkAttachment` and a non-empty `assets` array are mutually
exclusive (the input is rejected).
Character limits: X 280 (free accounts), Facebook 5,000, LinkedIn 3,000, Threads 500, Bluesky 300.

## Limits and errors

- Rate limits (Free / Essentials / Team): 150 / 450 / 1,500 per 15 min; 600 / 1,800 / 6,000 per 24 h.
  Headers `RateLimit` and `RateLimit-Policy` on every response; on limit: HTTP 429 with
  `extensions.code = RATE_LIMIT_EXCEEDED` and a `Retry-After` header.
- Posting limits per channel: `dailyPostingLimits(input: { channelIds: [...] }) { channelId isAtLimit limit sent scheduled }`.
  For X the window is a rolling 24 hours.
- Typed mutation errors arrive in `data` with HTTP 200 (`NotFoundError`, `UnauthorizedError`,
  `UnexpectedError`, `LimitReachedError`, `InvalidInputError`, `RestProxyError` — all expose `message`).
  System errors arrive in top-level `errors[]` with `extensions.code` in `UNAUTHORIZED`, `FORBIDDEN`,
  `NOT_FOUND`, `UNEXPECTED`, `RATE_LIMIT_EXCEEDED`. The docs disagree on whether an invalid key gives
  HTTP 401 or 200 + `UNAUTHORIZED`; handle both.
- No idempotency keys and no webhooks: before retrying a failed `createPost`, check `posts` for the
  channel; confirm delivery with `post(input: { id }) { id status sentAt externalLink error { message } }`.
  `PostStatus`: `draft`, `error`, `needs_approval`, `scheduled`, `sending`, `sent`.

## Deprecation

The migration guide gives no shutdown date for `api.bufferapp.com/1/`; the changelog read on
2026-11-22 has none either. v1 answered normally that day.
