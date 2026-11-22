# @bluelytics/social

Social post images and Buffer posting (ARCHITECTURE §9). Consumed as TypeScript source.

| Entry | Runs in | Contents |
|---|---|---|
| `@bluelytics/social` | Workers and Node | cards, Browser Run renderer, Buffer client, captions, `planPosts` |
| `@bluelytics/social/local` | Node only | `LocalChromeRenderer` (playwright-core + local Chrome) |

Worker bundles must import only the main entry; it has no `node:` imports and no Playwright.

## Cards (`src/cards/`)

```ts
renderCardHtml(kind: CardKind, size: CardSize, data: CardData): string  // self-contained HTML, exact canvas
computeCardFacts(data: CardData): CardFacts                             // delta, percent, direction, gap, min/max…
cardAltText(kind: CardKind, data: CardData): string                     // Spanish, ≤ 420 chars, plain ASCII signs
formatPesos, formatSignedPesos, formatPercent, formatGap, formatTimestamp, formatDateRange, formatNumber, plainText
CARD_SIZES: Record<CardSize, Viewport>      // landscape 1600×900, portrait 1080×1350, story 1080×1920, og 1200×630
CARD_KIND_SIZES: Record<CardKind, CardSize[]>  // update/weekly: landscape, portrait, story; og: og
```

`CardData` (whole pesos): `{ blue: {buy, sell}, oficial: {buy, sell}, prevSell, updatedAt, series: [{day, sell}] }`,
documented in `src/cards/types.ts` and matching `design/harness/CONTRACT.md`.

`src/cards/card.mjs` is currently a **placeholder** design that satisfies the contract. The final design
replaces `card.mjs` and adds `fonts.mjs`; it must keep the exports declared in `src/cards/card.d.mts`.
`test/cards.test.ts` checks the contract (no scripts, no external URLs, `lang="es"`, determinism,
formatter output) and must keep passing after the swap.

## Renderers (`src/render/`)

```ts
interface Renderer { render(html: string, viewport: Viewport): Promise<Uint8Array /* JPEG */> }
new BrowserRunRenderer(env.BROWSER, { quality?, timeoutMs?, maxRetries?, maxWaitMs? })
new LocalChromeRenderer({ executablePath?, quality? })   // from '@bluelytics/social/local'; call close()
```

`BrowserRunRenderer` uses a Quick Action screenshot (`env.BROWSER.quickAction('screenshot', …)`,
`compatibility_date` ≥ 2026-03-24, binding `"browser": { "binding": "BROWSER" }`): JPEG at the exact
viewport, `deviceScaleFactor: 1`, `cacheTTL: 0`. The Free plan allows one Quick Action per 10 s, so a 429
with a short `Retry-After` is waited out (default 2 retries, at most 20 s each); longer waits throw
`RenderError` with `status` and `retryAfterMs`. `LocalChromeRenderer` uses `/usr/bin/google-chrome-stable`
(or `$CHROME_PATH`) and blocks every network request.

## Buffer (`src/buffer/`)

```ts
const buffer = new BufferClient({ apiKey: env.BUFFER_API_KEY, fetch?, endpoint?, timeoutMs? });
buffer.listOrganizations(): Promise<BufferOrganization[]>
buffer.listChannels(organizationId): Promise<BufferChannel[]>      // use channel.id, not serviceId
buffer.createImagePost({ channelId, service, text?, imageUrl, altText?, kind: 'post' | 'story', draft? }): Promise<BufferPost>
buffer.getPost(id): Promise<BufferPost>
buffer.deletePost(id): Promise<string>
```

- `createImagePost` publishes at once (`mode: shareNow`, `schedulingType: automatic`); `draft: true` saves a
  Buffer draft instead (`saveToDraft`, `addToQueue`). Metadata per service: Instagram
  `{ instagram: { type, shouldShareToFeed } }` (`true` for posts, `false` for stories), Facebook `{ facebook: { type } }`, X none (X stories throw).
- Every failure is a `BufferError` with `code` (Buffer's `extensions.code` such as `UNAUTHORIZED`,
  `FORBIDDEN`, `RATE_LIMIT_EXCEEDED`, or `MUTATION_ERROR` with `typename`, `HTTP_ERROR`, `NETWORK`,
  `INVALID_RESPONSE`), `status` and `retryAfterMs`. HTTP 200 with `errors[]` is an error.
- The client never retries: Buffer has no idempotency keys. `error.retryable` tells the caller whether a
  later attempt may succeed; after `NETWORK`/`UNEXPECTED` on `createPost`, check whether the post exists first.
- The GraphQL documents (`OPERATIONS`) are validated against `docs/research/buffer-schema.graphql` in
  `test/buffer-schema.test.ts`.

## Captions and planning

```ts
buildCaption(network: 'twitter' | 'instagram' | 'facebook', kind: 'update' | 'weekly', data): string
buildAltText(kind, data): string
parseBufferChannels(env.BUFFER_CHANNELS): BufferChannels   // throws on unknown networks / bad values
planPosts(channels, { kind, data }): PostSpec[]
toCreateImagePostInput(spec, imageUrl, { draft? }): CreateImagePostInput
```

- X: no URL or domain in the text (posts with a URL cost more; the domain is on the card), `#DólarBlue`,
  ≤ 280 weighted characters (optional lines are dropped to fit). Instagram: details, "link en la bio",
  hashtags. Facebook: details and the site URL.
- `BUFFER_CHANNELS` is `{"twitter":"<channelId>","instagram":"<channelId>"}`; a value may also be
  `{"channelId":"<id>","story":true}` to add a story (Instagram, Facebook). X gets the landscape card,
  Instagram/Facebook the portrait card; stories use the story card with no caption or alt text.

## Scripts

```sh
pnpm --filter @bluelytics/social typecheck   # src under workers-types, then src + tests under Node types
pnpm --filter @bluelytics/social test        # includes local Chrome renders (needs google-chrome-stable)
```
