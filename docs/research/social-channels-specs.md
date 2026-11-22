# Extra social channels, image specs and dark "rate card" design — research for bluelytics_v2

Research date: **2026-11-22**. Everything below was fetched today unless a different date is given.

Legend used next to every claim:

- **[V]** verified today against a primary source (official docs, official repo source, registry metadata). Source tag in brackets, e.g. `[B2]`; full URLs + dates in section 9.
- **[LIVE]** observed today on the live service (HTTP probe) — real behaviour, but undocumented and may change.
- **[TEST]** reproduced locally today (Node 24.22.3 / workerd 1.20260730.1 / fontkit).
- **[2nd]** secondary source only (press, vendor blog).
- **[U]** unverified / inferred / from memory. Treat as a hypothesis and test before relying on it.

---

## 1. Bottom line

| Channel | Verdict | Auth | Token upkeep | Cost | Image limit |
|---|---|---|---|---|---|
| **Bluesky** | Add (tier 1) | App password -> session JWTs | None for the owner. App password does not expire; code refreshes JWTs | Free | 2,000,000 bytes per image, 4 images |
| **Telegram channel** | Add (tier 1) | Bot token | None. Token valid until regenerated | Free | 10 MB multipart / 5 MB by URL |
| **Mastodon** | Add (tier 2, optional: small AR audience) | User access token | None. Tokens do not expire | Free | 16 MB (mastodon.social) |
| **WhatsApp Channels** | No official publishing API exists. Manual posting or skip | - | - | - | - |
| **LinkedIn company page** | Not realistic. Skip | 3-legged OAuth, vetted app | High: 60-day access token, re-consent at most every 365 days | Free, but requires a registered legal entity + review | - |

Minimal render set that covers every channel (section 5.3): **1600x900** (16:9), **1080x1350** (4:5), **1080x1920** (9:16), **1200x630** (OG).

Three findings that contradict common assumptions / older docs:

1. Bluesky's image blob limit is now **2,000,000 bytes**, not 1,000,000 (lexicon changed 2026-04-08). The docs page still says both numbers. `[B1][B2]`
2. Instagram's **publishing API still rejects 3:4**. The app accepts 3:4 (1080x1440) since May 2025, but the API range is still 4:5 to 1.91:1, JPEG only. Use 1080x1350. `[I1]`
3. `bsky.social` reports a `createSession` budget of **10 per day** per identifier in its live rate-limit header, while the docs say 300/day. Cache the session; never log in per post. `[B3][B8]`

---

## 2. Part A — channel adapters

Shared adapter rules (apply to all channels):

- Dedupe on our side: write `posted:{channel}:{eventId}` to D1/KV before/after publishing. Only Mastodon has a server-side idempotency key.
- Upload bytes directly from the Worker when the API allows it (Bluesky, Telegram, Mastodon). Only Instagram/Threads need a public URL.
- Keep secrets as Worker secrets: `BSKY_IDENTIFIER`, `BSKY_APP_PASSWORD`, `TG_BOT_TOKEN`, `TG_CHAT_ID`, `MASTODON_BASE_URL`, `MASTODON_TOKEN`.

### 2.1 Bluesky (AT Protocol)

**Docs moved.** `docs.bsky.app/*` now 308-redirects to `bsky.network/docs/*` ("Bluesky Protocol Services", footer "2026 - operated by Bluesky PBC"). `[B1]`

**Is app-password auth still allowed?** Yes: "Applications with their own end-user login flow should implement OAuth. Single-purpose applications such as bots or command-line tools may use app password authentication instead." `[V][B5]` The XRPC spec calls it the "legacy authentication scheme" but documents it fully. `[V][B6]`

#### Owner setup (one time)

1. Create the account at bsky.app.
2. Optional but recommended: set the handle to the domain. Add DNS TXT `_atproto.bluelytics.com.ar` with value `did=did:plc:...` (the DID shown in Settings -> Handle), or serve the DID as `text/plain` at `https://bluelytics.com.ar/.well-known/atproto-did`. `[V][B11]` Cloudflare DNS makes the TXT route trivial.
3. Settings -> Privacy and security -> App passwords -> Add. Format is `xxxx-xxxx-xxxx-xxxx`. `[V][B6]` Exact menu path is `[U]`.
4. Store handle (or DID) + app password as Worker secrets.

App passwords are separate from the main password, revocable, and cannot perform destructive account actions. `[V][B6]` No expiry is documented.

#### Hosts

- Use `https://bsky.social` (the "entryway") for everything. "Most requests that can be sent to a PDS on behalf of a user can be sent to the Entryway instead, and it forwards them." `[V][B13]`
- The real PDS host (`https://<name>.<region>.host.bsky.network`) is in `didDoc` of the session response; going direct only saves a hop. `[V][B4][B13]`

#### Calls

```bash
# 1) Log in (rarely — see token strategy)
curl -sS -X POST https://bsky.social/xrpc/com.atproto.server.createSession \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"bluelytics.com.ar","password":"xxxx-xxxx-xxxx-xxxx"}'
# -> {"accessJwt":"...","refreshJwt":"...","handle":"...","did":"did:plc:...","didDoc":{...}}

# 2) Refresh (send the REFRESH jwt as the bearer)
curl -sS -X POST https://bsky.social/xrpc/com.atproto.server.refreshSession \
  -H "Authorization: Bearer $REFRESH_JWT"
# -> new accessJwt + refreshJwt  (store both)

# 3) Upload the image: raw bytes, real Content-Type
curl -sS -X POST https://bsky.social/xrpc/com.atproto.repo.uploadBlob \
  -H "Authorization: Bearer $ACCESS_JWT" \
  -H 'Content-Type: image/png' \
  --data-binary @card-1600x900.png
# -> {"blob":{"$type":"blob","ref":{"$link":"bafkrei..."},"mimeType":"image/png","size":123456}}

# 4) Create the post
curl -sS -X POST https://bsky.social/xrpc/com.atproto.repo.createRecord \
  -H "Authorization: Bearer $ACCESS_JWT" -H 'Content-Type: application/json' \
  -d @post.json
# -> {"uri":"at://did:plc:.../app.bsky.feed.post/3k...","cid":"bafyrei..."}
```

Endpoints, bearer usage and response shapes: `[V][B1][B6]`. That `refreshSession` rotates the refresh token is `[U]`; always persist whatever comes back.

`post.json`:

```json
{
  "repo": "did:plc:REPLACE",
  "collection": "app.bsky.feed.post",
  "record": {
    "$type": "app.bsky.feed.post",
    "text": "Dólar blue ▲ $ 1.670 (+0,60%) · Más info: https://bluelytics.com.ar #DólarBlue #Argentina #economía",
    "createdAt": "2026-11-20T22:45:00.000Z",
    "langs": ["es"],
    "facets": [
      { "index": { "byteStart": 47, "byteEnd": 72 },
        "features": [{ "$type": "app.bsky.richtext.facet#link", "uri": "https://bluelytics.com.ar" }] },
      { "index": { "byteStart": 73, "byteEnd": 84 },
        "features": [{ "$type": "app.bsky.richtext.facet#tag", "tag": "DólarBlue" }] },
      { "index": { "byteStart": 85, "byteEnd": 95 },
        "features": [{ "$type": "app.bsky.richtext.facet#tag", "tag": "Argentina" }] },
      { "index": { "byteStart": 96, "byteEnd": 106 },
        "features": [{ "$type": "app.bsky.richtext.facet#tag", "tag": "economía" }] }
    ],
    "embed": {
      "$type": "app.bsky.embed.images",
      "images": [{
        "alt": "Dólar blue: compra $ 1.650, venta $ 1.670. Sube 0,60 % respecto del cierre anterior. Dólar oficial: $ 1.425. Actualizado el 20 nov 2026 a las 19:45, hora de Argentina.",
        "image": { "$type": "blob", "ref": { "$link": "bafkrei..." }, "mimeType": "image/png", "size": 123456 },
        "aspectRatio": { "width": 1600, "height": 900 }
      }]
    }
  }
}
```

The byte offsets above are real: computed with the helper below for that exact string. `[TEST]`

#### Record rules (all from the lexicons, `[V][B2]`)

| Field | Rule |
|---|---|
| `text` | max 300 graphemes and 3000 bytes. May be empty if there is an embed |
| `createdAt` | required, ISO datetime; trailing `Z` preferred over `+00:00` `[B1]` |
| `langs` | max 3 BCP-47 tags |
| `tags` | max 8 extra hashtags (not shown in text), each max 64 graphemes |
| `embed.images` | max 4 items; each needs `image` + `alt` (both required) |
| `image` blob | `accept: image/*`, **`maxSize: 2000000`** ("May be up to 2 MB, formerly limited to 1 MB") |
| `aspectRatio` | `{width, height}` integers >= 1. Ratio only; omit rather than guess `[B1]` |
| `embed.external.thumb` | still `maxSize: 1000000` (link-card thumbnail) |
| facets | `byteStart` inclusive, `byteEnd` exclusive, **UTF-8 byte offsets**. Feature types: `#link` (`uri`), `#mention` (`did`), `#tag` (`tag`, without `#`). Facets must not overlap `[B10]` |

- No server-side link/hashtag detection: without facets, URLs and hashtags render as plain text. `[V][B1][B10]`
- Strip EXIF/metadata before upload ("strongly recommended best practice"). `[V][B1]` Generated PNGs have none.
- A post has one embed type. Image embed and link card cannot be combined; put the URL in the text with a link facet. `[V][B2]` (embed is a union)
- PDS hard cap on any blob upload: 52,428,800 bytes. `[V][B3]`

#### Facet helper (tested)

```ts
const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).byteLength;

export function buildFacets(text: string) {
  const facets: any[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    const byteStart = byteLen(text.slice(0, m.index));
    facets.push({ index: { byteStart, byteEnd: byteStart + byteLen(url) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] });
  }
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{N}_]+)/gu)) {
    const tag = m[2];
    if (/^#\p{N}+$/u.test(tag)) continue;                 // "#1" is not a hashtag
    const byteStart = byteLen(text.slice(0, m.index! + m[1].length));
    facets.push({ index: { byteStart, byteEnd: byteStart + byteLen(tag) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.slice(1) }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
```

Count the 300 limit in graphemes: `[...new Intl.Segmenter('es', {granularity:'grapheme'}).segment(text)].length`. `Intl.Segmenter` exists in workerd. `[TEST]`

#### Rate limits

| Limit | Value | Source |
|---|---|---|
| Record writes per account | 5,000 points/hour, 35,000/day. CREATE = 3 points -> 1,666 creates/hour | `[V][B3]` |
| All API requests, per IP | 3,000 per 5 minutes | `[V][B3]`, matches live header `ratelimit-policy: 3000;w=300` `[LIVE][B8]` |
| `createSession` (documented) | 30 per 5 min and 300 per day, per account | `[V][B3]`; same numbers in open-source PDS, keyed by `identifier + IP` `[V][B7]` |
| `createSession` (observed on bsky.social) | header `ratelimit-policy: 10;w=86400`, counter keyed per identifier. Probed with non-existent identifiers, so it may be a failed-login bucket | `[LIVE][B8]` |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy`; over-limit is HTTP 429. `[V][B3][B8]`

#### Token strategy (zero owner maintenance)

- Access JWT lifetime 120 minutes, refresh JWT 90 days — defaults in the open-source PDS. `[V][B7]` The `bsky.social` entryway is closed source, so its real values are `[U]`; read the `exp` claim instead of hard-coding.
- Store `{accessJwt, refreshJwt, did}` in KV. Before posting: if access `exp` is more than 2 minutes away, use it; else `refreshSession`; if that fails, `createSession` with the app password. This costs roughly one `createSession` per quarter at worst.

```ts
const HOST = 'https://bsky.social';
const exp = (jwt: string) =>
  JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;

async function bskySession(env: Env) {
  const now = Date.now() / 1000;
  const s = await env.KV.get<{ accessJwt: string; refreshJwt: string; did: string }>('bsky:session', 'json');
  if (s && exp(s.accessJwt) - now > 120) return s;
  let r: Response | undefined;
  if (s && exp(s.refreshJwt) - now > 120) {
    r = await fetch(`${HOST}/xrpc/com.atproto.server.refreshSession`,
      { method: 'POST', headers: { authorization: `Bearer ${s.refreshJwt}` } });
  }
  if (!r?.ok) {
    r = await fetch(`${HOST}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: env.BSKY_IDENTIFIER, password: env.BSKY_APP_PASSWORD }) });
    if (!r.ok) throw new Error(`bsky login ${r.status}: ${await r.text()}`);
  }
  const j: any = await r.json();
  const next = { accessJwt: j.accessJwt, refreshJwt: j.refreshJwt, did: j.did };
  await env.KV.put('bsky:session', JSON.stringify(next));
  return next;
}
```

#### Policy

Developer guidelines forbid "automated or bulk interactions ... that would cause a notification" (follows, likes, replies, mentions). A broadcast-only price bot is fine; do not auto-mention or auto-reply. `[V][B13]`

### 2.2 Telegram (Bot API 10.5, dated 2026-11-22)

#### Owner setup (one time)

1. In Telegram, talk to `@BotFather` -> `/newbot` -> receive the token. `[V][T3]`
2. Create a public channel (e.g. `@bluelytics`).
3. Add the bot as a channel **administrator** with the "Post messages" right (`can_post_messages`: "True, if the administrator can post messages in the channel"). `[V][T1]`
4. Store the token and `chat_id` (`@channelusername`, or the numeric `-100...` id).

Token upkeep: none. Docs describe no expiry; `/token` in BotFather generates a new one if it leaks. `[V][T3]`

#### Calls

Base URL: `https://api.telegram.org/bot<token>/METHOD_NAME`. GET or POST; parameters as query string, `application/x-www-form-urlencoded`, `application/json` (not for file upload) or `multipart/form-data`. `[V][T1]`

```bash
# A) Upload bytes (multipart) — preferred: no public URL needed, 10 MB limit
curl -sS -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendPhoto" \
  --form-string 'chat_id=@bluelytics' \
  -F 'photo=@card-1600x900.png;type=image/png' \
  --form-string 'parse_mode=HTML' \
  --form-string 'caption=<b>Dólar blue</b> ▲ <b>$ 1.670</b> (+0,60%)
Compra $ 1.650 · Venta $ 1.670
<a href="https://bluelytics.com.ar">bluelytics.com.ar</a>'

# B) By URL (Telegram downloads it) — 5 MB limit, JSON body allowed
curl -sS -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendPhoto" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"@bluelytics","photo":"https://bluelytics.com.ar/social/2026-11-20T2245Z-16x9.png","caption":"...","parse_mode":"HTML"}'
```

curl gotcha: `-F 'chat_id=@bluelytics'` makes curl try to upload a file named `bluelytics`. Use `--form-string` for any value that may start with `@` or `<`.

Worker version:

```ts
const fd = new FormData();
fd.append('chat_id', env.TG_CHAT_ID);                               // "@bluelytics"
fd.append('photo', new Blob([png], { type: 'image/png' }), 'dolar-blue.png');
fd.append('caption', captionHtml);
fd.append('parse_mode', 'HTML');
const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: fd });
const j: any = await res.json();   // { ok: true, result: Message } | { ok: false, error_code, description, parameters? }
if (!j.ok) throw new Error(`telegram ${j.error_code}: ${j.description} retry_after=${j.parameters?.retry_after ?? '-'}`);
```

#### `sendPhoto` facts (`[V][T1]`)

| Item | Value |
|---|---|
| `chat_id` | "Unique identifier for the target chat or username of the target bot, supergroup, or channel in the format @username" |
| `photo` | `file_id`, HTTP URL, or multipart upload |
| Photo limits | at most 10 MB; width + height <= 10000; width/height ratio <= 20 |
| By URL | 5 MB max for photos; correct MIME type required |
| By multipart | 10 MB max for photos (50 MB other files) |
| By `file_id` | no size limit; reuse the `file_id` from the first send to post the same image elsewhere |
| `caption` | 0-1024 characters after entities parsing |
| `parse_mode` | `HTML`, `MarkdownV2`, or legacy `Markdown` |
| Other useful params | `show_caption_above_media`, `disable_notification`, `protect_content`, `reply_markup` (inline keyboard button linking to the site) |
| Text-only fallback | `sendMessage`, 1-4096 characters |

Formatting: use **HTML**. Only `<`, `>`, `&` need escaping (`&lt; &gt; &amp;`). MarkdownV2 requires escaping `_ * [ ] ( ) ~ \` > # + - = | { } . !` — it breaks on "1.670" and "+0,60%" unless every `.`, `+`, `-` is escaped. `[V][T1]`

New in recent Bot API versions: a date-time entity, `<tg-time unix="1795214700" format="dt">20 nov, 19:45</tg-time>`, renders in each reader's local format. Optional. `[V][T1]`

#### Limits and cost

- Free. `[V][T2]`
- "In a single chat, avoid sending more than one message per second." Groups: 20 messages per minute. Bulk: about 30 messages per second overall; exceeding returns 429. `[V][T2]` A handful of channel posts per day is nowhere near this.
- Errors return `ok:false` with `error_code` and `description`; 429 includes `parameters.retry_after`. `[V][T1]`

#### Unverified

- Photos sent with `sendPhoto` are recompressed and downscaled by Telegram (commonly reported: longest side 1280 px). `[U]` Check the returned `result.photo[]` sizes after the first post. If quality matters, upload a 2x-density card anyway; fall back to `sendDocument` only if you accept a file-style message.
- Telegram may cache images fetched by URL; use a unique URL per render. `[U]`

### 2.3 Mastodon

Latest releases (2026-11-19): 4.7.6 stable, 5.0.0-beta.2. `mastodon.social` runs `5.0.0-nightly.2026-11-20`. `[V][M10][M7]`

#### Owner setup (one time)

1. Create an account on an instance whose rules allow automated accounts (rules differ per instance — check; `[U]`). Mark the profile as automated ("This is a bot account" in profile settings; `[U]`).
2. Preferences -> Development -> New application (`/settings/applications` `[V][M6]`). Scopes: `write:statuses` and `write:media` only. `[V][M1][M2]`
3. Copy "Your access token" from the application page. Store it and the instance base URL.

Token upkeep: none. Mastodon's OAuth config has `access_token_expires_in nil` and refresh tokens commented out (`# use_refresh_token`) on `main`, which is 5.0-nightly. `[V][M5]` The Token entity has no `expires_in`. `[V][M4]`

#### Calls

```bash
# 1) Upload media
curl -sS -X POST "$MASTODON_BASE_URL/api/v2/media" \
  -H "Authorization: Bearer $MASTODON_TOKEN" \
  -F 'file=@card-1600x900.png;type=image/png' \
  --form-string 'description=Dólar blue: compra $ 1.650, venta $ 1.670. Sube 0,60 %. Actualizado 20 nov 2026, 19:45 (hora de Argentina).' \
  --form-string 'focus=0.0,0.0'
# 200 -> {"id":"1146...","type":"image","url":"https://...","preview_url":"https://...","meta":{...},"description":"..."}
# 202 -> same but "url": null  (still processing; poll GET /api/v1/media/:id until 200, 206 = not ready)

# 2) Publish
curl -sS -X POST "$MASTODON_BASE_URL/api/v1/statuses" \
  -H "Authorization: Bearer $MASTODON_TOKEN" \
  -H 'Idempotency-Key: blue-2026-11-20T22:45Z' \
  --data-urlencode 'status=Dólar blue ▲ $ 1.670 (+0,60%)
Compra $ 1.650 · Venta $ 1.670
https://bluelytics.com.ar #DólarBlue #Argentina' \
  --data-urlencode 'media_ids[]=1146...' \
  -d 'visibility=public' -d 'language=es'
# 200 -> Status JSON (id, url, ...)
```

Facts:

| Item | Value | Source |
|---|---|---|
| `POST /api/v2/media` params | `file` (required, multipart), `thumbnail`, `description`, `focus` (`x,y`, each -1.0..1.0) | `[V][M1]` |
| Sync vs async | Since 4.0.0 images are processed synchronously -> 200. Video/audio -> 202 | `[V][M1]` |
| `POST /api/v1/media` | Deprecated since 3.1.3 | `[V][M1]` |
| `POST /api/v1/statuses` params | `status`, `media_ids[]`, `visibility` (`public`/`unlisted`/`private`/`direct`), `language` (ISO 639-1), `sensitive`, `spoiler_text`, `scheduled_at` (>= 5 min ahead), `in_reply_to_id` | `[V][M2]` |
| `Idempotency-Key` header | Prevents duplicates; "stored for up to 1 hour" | `[V][M2]` |
| Hashtags / links | Parsed server-side from the text. Each URL counts as 23 characters | `[V][M7][M11]` |
| Text limit | 500 characters (instance default) | `[V][M7][M8]` |
| Images | Up to 4 per post, 16 MB each (`image_size_limit: 16777216`), downscaled above 8.3 MP (3840x2160). `image_matrix_limit: 33177600` | `[V][M7][M8]` |
| Image types on mastodon.social today | `image/jpeg`, `image/png`, `image/gif`, `image/webp` (docs example also lists heic/heif/avif — instance dependent) | `[LIVE][M7]` vs `[M11]` |
| Alt text limit | Docs example: 1500. mastodon.social today: `description_limit: 10000` | `[M11]` vs `[LIVE][M7]` |
| Thumbnails | "Server-side preview images are never cropped"; clients crop, guided by `focus` | `[V][M9]` |

Read limits at runtime instead of hard-coding: `GET $MASTODON_BASE_URL/api/v2/instance` -> `configuration.statuses` and `configuration.media_attachments`. `[V][M7]`

Rate limits: 300 requests per 5 minutes; media uploads 30 per 30 minutes; headers `X-RateLimit-Limit/Remaining/Reset`. `[V][M3]` Source confirms 300 per 5 min per token, 1,500 per 5 min per user, and the media throttle matching `/api/v\d+/media` (so v2 too). `[V][M6]` Cost: free.

### 2.4 WhatsApp Channels

**There is no official API to publish to a WhatsApp Channel.**

- Meta's WhatsApp Business Platform consists of Cloud API (messaging, calling, group management), Business Management API, Marketing Messages API, Webhooks and Meta Business Agent. Channels are not mentioned. `[V][W1][W2]`
- The only official API surface that touches Channels is the Meta Content Library API, which is **read-only research access** (search channels, last 30 days of updates). `[V][W3]` (seen via search-result summary of the official page, not fetched in full)
- WhatsApp's own Channels help page describes no API or automation. `[V][W4]`
- A negative cannot be proven from docs; treat "no official API" as: none documented anywhere in Meta's developer docs as of today.

Third-party gateways (Whapi.Cloud, WAHA) do post to channels by driving a WhatsApp Web session. `[2nd][W5]` They are unofficial, paid or self-hosted with a persistent session, and risk the number being banned. Not compatible with "lowest cost, zero maintenance".

Recommendation: do not automate. If the owner wants a Channel, generate the 1080x1350 card and caption and send them to the owner (e.g. via the Telegram bot) for a manual forward.

### 2.5 LinkedIn company page

The API itself is simple; access is the problem.

Access requirements (`[V][L1]`, page version `li-lms-2026-11`, updated 2026-02-11):

- "our Community Management APIs are only available to registered legal organizations for commercial use cases only."
- Business email (verified; "Personal email addresses won't pass the vetting process"), organization legal name, registered address, website, privacy policy.
- A super admin of the LinkedIn Page must verify the app.
- App name must not contain "Linked" or "In".
- Rejection means creating a new app and reapplying.

Tiers (`[V][L2]`, dated 2026-10-14):

- **Development tier** (default): 500 API calls per app per 24 h, 100 per member per 24 h; must finish integration "within twelve (12) months".
- **Standard tier**: no restrictions, but requires a second form plus a narrated screencast demonstrating the OAuth flow, posting, and how commenter data is displayed.
- Grants `w_organization_social` (post as the organization). The authenticated member needs page role ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER or CONTENT_ADMIN. `[V][L3]`

Tokens (`[V][L5][L6]`):

- "Currently, all access tokens are issued with a 60-day lifespan."
- Programmatic refresh tokens: 365 days, and the TTL does **not** reset on refresh. After 365 days "The member must reauthorize your application." The refresh-token page says they are for "approved Marketing Developer Platform (MDP) partners"; the OAuth page says "available for a limited set of partners".
- So best case is a manual browser re-consent once a year; worst case every 60 days.

Calls, if it is ever pursued (`[V][L3][L4]`; headers `Linkedin-Version: 202611` and `X-Restli-Protocol-Version: 2.0.0` on every call; version 202601 sunsets 2027-01-15):

```bash
# 1) Register the upload
curl -sS -X POST 'https://api.linkedin.com/rest/images?action=initializeUpload' \
  -H "Authorization: Bearer $LI_TOKEN" -H 'Linkedin-Version: 202611' \
  -H 'X-Restli-Protocol-Version: 2.0.0' -H 'Content-Type: application/json' \
  -d '{"initializeUploadRequest":{"owner":"urn:li:organization:ORG_ID"}}'
# -> {"value":{"uploadUrl":"https://www.linkedin.com/dms-uploads/...","image":"urn:li:image:C4E10...","uploadUrlExpiresAt":...}}

# 2) Send the bytes to uploadUrl (HTTP PUT with the binary body — method not re-verified today [U])
curl -sS -X PUT "$UPLOAD_URL" -H "Authorization: Bearer $LI_TOKEN" --upload-file card-1200x627.png

# 3) Create the post
curl -sS -X POST 'https://api.linkedin.com/rest/posts' \
  -H "Authorization: Bearer $LI_TOKEN" -H 'Linkedin-Version: 202611' \
  -H 'X-Restli-Protocol-Version: 2.0.0' -H 'Content-Type: application/json' \
  -d '{"author":"urn:li:organization:ORG_ID","commentary":"Dólar blue ...","visibility":"PUBLIC",
       "distribution":{"feedDistribution":"MAIN_FEED","targetEntities":[],"thirdPartyDistributionChannels":[]},
       "content":{"media":{"altText":"...","id":"urn:li:image:C4E10..."}},
       "lifecycleState":"PUBLISHED","isReshareDisabledByAuthor":false}'
# -> 201, post id in response header x-restli-id
```

Image limits: JPG, GIF, PNG; fewer than 36,152,320 pixels; `altText` max 4,086 characters. `[V][L4]`

Verdict: **not realistic** for a hobby-scale, zero-maintenance bot. It needs a registered legal entity, manual vetting, an annual (or 60-day) human re-login, and the audience fit for dólar-blue alerts is weak. Skip. If LinkedIn presence is wanted, share the page link manually; the OG image (section 5) makes that look right.

---

## 3. Per-channel text and alt-text limits (for caption builders)

| Channel | Post text | Alt text | Notes |
|---|---|---|---|
| X | 280; each link counts as 23 `[V][X3]` | 1000 `[U]` | Up to 4 photos `[V][X1]` |
| Bluesky | 300 graphemes / 3000 bytes `[V][B2]` | Required field; no max in lexicon `[V][B2]` | Facets needed for links/hashtags |
| Mastodon | 500 (instance default), URL = 23 `[V][M7]` | 1500 documented; 10000 on mastodon.social `[M11][M7]` | Hashtags parsed server-side |
| Telegram | Caption 1024; message 4096 `[V][T1]` | None (caption only) | HTML parse mode |
| Instagram | Caption 2200, 30 hashtags, 20 @ tags `[V][I1]` | `alt_text` up to 1000, image posts only (not stories/reels) `[V][I1]` | Links in captions are not clickable `[U]` |
| Threads | 500; posts with more than 5 links fail `[V][TH1]` | - | 250 posts per rolling 24 h `[V][TH1]` |
| LinkedIn | Commentary limit not checked `[U]` | 4086 `[V][L4]` | - |

---

## 4. Suggested copy templates

Keep one renderer for values (section 7) and build per-channel strings from the same parts.

```
headline   = "Dólar blue {▲|▼|=} {venta} ({±pct})"            e.g. "Dólar blue ▲ $ 1.670 (+0,60%)"
detail     = "Compra {compra} · Venta {venta}"
oficial    = "Oficial {oficial_venta}"
stamp      = "{fecha}, {hora} (ART)"                           e.g. "20 nov 2026, 19:45 (ART)"
link       = "https://bluelytics.com.ar"
tags       = "#DólarBlue #Argentina #economía"
```

- X / Bluesky: `headline` + `link` + 2-3 tags.
- Mastodon / Threads: `headline`, `detail`, `link`, tags.
- Telegram: bold headline, `detail`, `oficial`, link as `<a>`; no hashtags needed.
- Instagram: `headline`, `detail`, `stamp`, blank line, tags. Say "link en la bio".
- Alt text (all channels that support it): one sentence each for blue buy/sell, direction and percent in words ("Sube 0,60 %"), oficial, timestamp with "hora de Argentina". Do not describe colours or layout.

The current code writes "subio/bajo" without accents and "Dolar" (`bluescraper/src/updates.py`). Fix to "subió", "bajó", "Dólar".

---

## 5. Part B — image specs per placement

### 5.1 Specs table

| Placement | Accepted / recommended | Format and size | Source |
|---|---|---|---|
| **X single image** | Supported ratios listed by X: 16:9 (1920x1080), 1.91:1, 1:1, 4:5 (1440x1800), 2:3, 9:16. 16:9 is the safe uncropped landscape choice | JPG, PNG, GIF, WEBP; <= 5 MB | `[V][X1][X3]` (ratios from the ads spec page, (c) 2026; organic timeline crop rules are not officially documented `[U]`) |
| **Instagram feed via API** | Aspect ratio "Must be within a 4:5 to 1.91:1 range". Width 320-1440 (scaled into range) | **JPEG only**, <= 8 MB, sRGB | `[V][I1]` (Graph API v27.0) |
| **Instagram feed in-app** | 3:4 (1080x1440) accepted since late May 2025; profile grid cells are 3:4 | - | `[2nd][I6]` |
| **Instagram Stories via API** | `media_type=STORIES`; "We recommended 9:16 to avoid cropping or blank space" | JPEG, <= 8 MB, sRGB | `[V][I1]` |
| **Instagram Stories safe zone** | Keep about 14% top, 35% bottom, 6% each side free of text/logos | Meta's ad spec lists 1440x2560 | `[V][I4]` ((c) 2026, ads guide) |
| **Facebook feed** | 4:5, 1440x1800 recommended; min width 600 | JPG or PNG, <= 30 MB (ads) | `[V][I5]` ((c) 2026, ads guide) |
| **Instagram feed ads guide** | 4:5, 1440x1800; allowed range 400x500 (4:5) to 191x100 (1.91:1); tolerance 1% | JPG or PNG | `[V][I3]` |
| **Threads** | Aspect ratio limit 10:1; min width 320; scaled down above 4096x4096 | JPEG or PNG, <= 8 MB, sRGB | `[V][TH1]` (host `graph.threads.com`, v1.0) |
| **Bluesky** | Any ratio; send `aspectRatio`. In feeds the official app crops only images taller than 1:2. Web fits portrait images inside a 1:1 box; native inside 9:16 | `image/*`, <= 2,000,000 bytes, max 4 | `[V][B2][B9]`; app renders up to 4000 px since v1.121 `[2nd][B12]` |
| **Telegram photo** | w + h <= 10000, ratio <= 20; shown uncropped in the chat bubble `[U]` | <= 10 MB upload / 5 MB URL | `[V][T1]` |
| **Telegram story** (business accounts only) | Exactly 1080x1920 | <= 10 MB | `[V][T1]` |
| **Mastodon** | Any; previews never cropped server-side; set `focus` | PNG/JPEG/WebP/GIF, <= 16 MB, downscaled above 8.3 MP | `[V][M7][M8][M9]` |
| **Open Graph (Facebook, WhatsApp, LinkedIn, Telegram, Slack, Discord link previews)** | "at least 1200 x 630"; minimum 600x315 for large cards; "as close to 1.91:1 aspect ratio as possible" | <= 8 MB; add `og:image:width` / `og:image:height` | `[V][F1]` |
| **X link card (`summary_large_image`)** | 2:1; min 300x157, max 4096x4096 | < 5 MB; JPG, PNG, WEBP, GIF; no SVG; `twitter:image:alt` <= 420 chars | `[V][X4]` — the page is gone from the live docs (old URL redirects to `docs.x.com/overview`, no cards pages in the sitemap); values from the Wayback capture of 2026-01-12 |

### 5.2 The Instagram 3:4 question, answered

- App: yes, 3:4 is native (feed and grid). `[2nd][I6]`
- Publishing API: **no**. The official reference (v27.0) still says "Must be within a 4:5 to 1.91:1 range". 3:4 = 0.75 is below 4:5 = 0.80. `[V][I1]` Third-party reports say such containers fail with error 36003 / subcode 2207009. `[2nd]`
- Therefore API posts must be **1080x1350 (4:5)**.
- Grid crop consequence (arithmetic, assuming centre-crop to fill; `[U]`): a 4:5 image in a 3:4 cell keeps 93.75% of its width, so about 34 px is cut from each side at 1080 wide. A 1:1 image loses 135 px per side. Keep essential content at least 64 px from the left/right edges.
- Limits: 100 API-published posts per 24 h (the same page also says 50 in the carousel section — conflicting; query `GET /{ig-id}/content_publishing_limit`). `[V][I2]`
- `image_url`: "We will cURL the image using the URL that you specify so the image must be on a public server." `[V][I1]`

### 5.3 Recommended render set

| Name | Pixels | Ratio | Used for |
|---|---|---|---|
| `landscape` | **1600x900** | 16:9 | X, Bluesky, Mastodon, Telegram, (LinkedIn) |
| `portrait` | **1080x1350** | 4:5 | Instagram feed (API maximum height), Facebook feed, Threads, manual WhatsApp Channel |
| `story` | **1080x1920** | 9:16 | Instagram Stories (API), Facebook Stories, WhatsApp Status / Telegram story (manual) |
| `og` | **1200x630** | 1.91:1 | `og:image` / `twitter:image` for site pages |

Notes:

- Do not reuse `landscape` as the OG image: Facebook crops to 1.91:1 and X cards to 2:1, cutting roughly 3-5% off top and bottom. The OG image also carries different content (page title, not an alert).
- For X cards, keep OG content inside the central 1200x600 band so the 2:1 crop is harmless.
- Formats: render PNG as master. Instagram needs **JPEG** (API rejects PNG) — add one PNG->JPEG step for the `portrait` and `story` outputs (quality about 90, sRGB). Everything else accepts PNG.
- Byte budgets: Bluesky 2,000,000 is the tightest. A flat-colour 1600x900 PNG is normally far below that `[U]`; assert `bytes.length <= 2_000_000` and fall back to JPEG if a gradient-heavy design ever exceeds it.
- Current production sizes (`bluescraper/src/updates.py`) are 960x720 for Instagram/Facebook, 1350x706 for Twitter, 1200x628 for LinkedIn, rendered with `wkhtmltoimage`. All are below today's recommended resolution.

### 5.4 Safe areas (pixels)

| Canvas | Keep-out | Basis |
|---|---|---|
| 1600x900 | 64 px all sides | Rounded-corner clipping in timelines; design margin |
| 1080x1350 | 64 px left/right, 56 px top/bottom | 3:4 grid crop (34 px/side) plus margin |
| 1080x1920 | top **270 px** (14%), bottom **672 px** (35%), sides **65 px** (6%) | Meta ads guide percentages applied to 1080x1920 `[V][I4]` |
| 1200x630 | 48 px all sides; essential content within central 1200x600 | 2:1 card crop |

For organic (non-ad) stories the bottom 35% is conservative. A common community figure is about 250 px top and 340 px bottom. `[U]` Practical layout: hero block between y = 270 and y = 1248; secondary content may extend to about y = 1580; nothing important below.

---

## 6. Part C — dark rate-card design

### 6.1 Principles

1. **One number wins.** The sell price of the dólar blue is the hero. Everything else is at most half its size.
2. **Thumbnail test.** In Instagram's 3-column grid a 1080 px card is shown about 125 pt wide (about 1:8.6). Only the hero number and the direction colour survive. Check every template at 125 px width before shipping.
3. **Direction is never colour-only.** Pair colour with ▲/▼ and an explicit sign (WCAG 1.4.1 Use of Color `[U]` — cited from memory).
4. **Same skeleton on every size.** Label top-left, logo top-right, hero centre-left, delta chip beside/below, sparkline, footer with timestamp and domain. Recognition comes from repetition.
5. **Timestamp and source always visible.** A rate card without a time is a liability once it is re-shared.

### 6.2 Layout skeleton

```
+--------------------------------------------------------------+
| DÓLAR BLUE · VENTA                              [logo] bluelytics |
|                                                              |
|  $ 1.670        [▲ +10  +0,60%]                              |
|                                                              |
|  Compra  $ 1.650      Oficial  $ 1.425      Brecha  17,2%    |
|  ~~~~~~~~~~~~~~~~ sparkline 30 días ~~~~~~~~~~~~~~~~~~~~ •   |
|                                                              |
| 20 nov 2026, 19:45 (ART)                    bluelytics.com.ar |
+--------------------------------------------------------------+
```

- `portrait` and `story`: stack the same blocks vertically; the sparkline becomes a wider band under the hero.
- `og`: page title + hero number + logo only. No sparkline labels, no secondary row.

### 6.3 Type scale (px in the source image)

Derived from display scale: a 1600 px landscape card is shown about 375 pt wide in a phone timeline (1 pt is about 4.3 px); a 1080 px card about 375 pt wide (1 pt is about 2.9 px). Target: nothing below about 11 pt on screen, hero at least 45 pt. These are design calculations, not platform rules.

| Role | 1600x900 | 1080x1350 | 1080x1920 | 1200x630 | Weight |
|---|---|---|---|---|---|
| Hero number | 220-240 | 200-220 | 230-260 | 160-180 | 700-800 |
| Currency symbol `$` | 60% of hero | 60% | 60% | 60% | 500-600 |
| Delta chip text | 64-72 | 56-64 | 64-72 | 48-56 | 600-700 |
| Secondary values | 72-84 | 60-68 | 68-76 | - | 600 |
| Labels (caps, +4% tracking) | 40-44 | 34-38 | 38-42 | 36-40 | 500-600 |
| Footer (time, domain) | 34-38 | 30-34 | 34-38 | 30-34 | 400-500 |
| Sparkline stroke | 6 | 5 | 6 | - | - |

- Hero letter-spacing: -1% to -2%. Line-height 1.0.
- Do not letter-space numerals in the delta chip.
- Minimum text size anywhere: 30 px on 1080-wide canvases, 34 px on 1600-wide.

### 6.4 Colour tokens and contrast

Contrast ratios computed today with the WCAG relative-luminance formula. `[TEST]`

| Token | Hex | On canvas `#0A0E14` | On card `#111823` | Use |
|---|---|---|---|---|
| `canvas` | `#0A0E14` | - | - | Background (blue-black, not pure black) |
| `card` | `#111823` | 1.09 | - | Panels; separate with a 1-2 px `#223044` hairline, not contrast |
| `text` | `#F2F5F9` | 17.69 | 16.29 | Hero number, primary text |
| `textMuted` | `#A3AEBD` | 8.61 | 7.93 | Labels, secondary values |
| `textDim` | `#7C8798` | 5.32 | 4.90 | Footer |
| `up` | `#2FD67B` | 10.15 | 9.35 | Rising: chip text, arrow, sparkline |
| `down` | `#FF5D5D` | 6.42 | 5.92 | Falling |
| `flat` | `#A3AEBD` | 8.61 | 7.93 | Unchanged ("=" / "sin cambios") |
| `brand` | `#4C8DFF` | 6.04 | 5.57 | Logo accent, neutral sparkline |
| `warn` | `#FBBF24` | 11.59 | 10.67 | Rare "alerta" band |

WCAG thresholds: 4.5:1 for normal text, 3:1 for large text (at least 18 pt, or 14 pt bold; about 24 px / 18.5 px). Logos are exempt. `[V][WC1]` Non-text marks such as sparkline strokes need 3:1 (SC 1.4.11; `[U]` exact wording not fetched). All tokens above pass 4.5:1 on both backgrounds.

Legacy brand colours from `blueimg/template.html` do not work on dark: blue `#221199` is 1.48:1 on canvas (invisible); green `#229922` is 5.20:1 but dull. `[TEST]` Keep the hue, lift the lightness (`brand` and `up` above).

Chips: tinted background at 14-16% alpha of the direction colour (`rgba(47,214,123,0.15)` / `rgba(255,93,93,0.15)`) with full-colour text; radius about 30% of chip height.

Avoid: pure `#000` backgrounds with pure `#FFF` text (halation at large sizes), fully saturated `#FF0000` / `#00FF00`, and red/green as the only cue. `up` vs `down` contrast against each other is only 1.58:1, so colour-blind readers depend entirely on the arrow and sign.

### 6.5 Colour semantics for Argentina / LatAm

- Convention: **green = sube, red = baja**, as in US/European markets. Mainland China, Japan and Taiwan use the opposite (red = up). `[2nd]` No LatAm-specific primary source was found; this matches what Argentine finance sites display. `[U]`
- Semantics trap: a rising dólar is bad news for many readers, but the colour encodes **price direction, not sentiment**. Stay with the convention; do not invert.
- Keep the hero number neutral (`text`). Colour only the delta chip, arrow and sparkline. This keeps the card calm and avoids a wall of red on bad days.
- Unchanged: grey chip, "=" and "sin cambios". Never show "+0,00%" in green.

### 6.6 Sparkline

- Data: last 30 daily closes for daily/weekly cards; intraday points for "alert" cards. One series only (blue sell).
- Draw as an SVG path. Stroke 5-6 px, round joins and caps, colour = direction over the plotted window (or `brand` for neutral).
- Area fill: vertical gradient from the stroke colour at about 20% alpha to 0%.
- End dot: 2.5x the stroke width, with a canvas-coloured ring. It anchors the eye to "now".
- No axes, grid or tick labels. Optional: tiny min/max values in `textDim`.
- Do not start the y-axis at zero; pad the min-max range by about 10%. Add the period label ("30 días") so the scale choice is honest.
- Height about 18-22% of the card; never behind the hero number.

### 6.7 Numerals

- Use **tabular figures** so "$ 1.670" and "$ 1.711" occupy the same width across posts and columns align.
- Avoid monospace fonts for the hero: in monospace the `.` and `,` take a full digit cell (600/1000 em in JetBrains Mono, IBM Plex Mono, Geist Mono `[TEST]`), which makes "1.670,00" look gappy. Proportional fonts with `tnum` keep punctuation narrow (Inter: period 0.29 em vs digit 0.65 em `[TEST]`).
- Satori 0.63.2 (2026-10-20) supports `fontFeatureSettings` through HarfBuzz, and reads TTF, OTF, WOFF and **WOFF2**. "Variable fonts are rendered as their default instance" — so ship one static file per weight. `[V][SAT]` Use `fontFeatureSettings: '"tnum" 1'`.
- Arrows: the Fontsource `latin` subsets of Inter, Manrope, Space Grotesk, IBM Plex and the mono fonts **lack ▲ ▼ →**. `[TEST]` Draw arrows as SVG triangles instead of text glyphs. (They are fine in post captions, where the platform font renders them.)
- Use the true minus sign U+2212 on the card if you want typographic polish; all inspected fonts have it. `[TEST]` Keep ASCII `-` in captions.

### 6.8 Open-licensed fonts (licences and files checked today)

Inspection method: downloaded the `latin` 400/700 TTFs from the Fontsource CDN and read metrics/features with fontkit. All eight families contain `á é í ó ú ü ñ ¿ ¡ $ % € ° · −` in the `latin` subset. `[TEST]`

| Family | Licence | Digits by default | `tnum` | Latest upstream | Where to get static files |
|---|---|---|---|---|---|
| **Inter** | OFL-1.1 | proportional | yes | v4.1 (2024-11-16), `rsms/inter` | Release zip (TTF/OTF/WOFF2); `@fontsource/inter` 5.3.0 |
| **Geist Sans** | OFL-1.1 | proportional | yes | v1.9.2 (2026-11-06), `vercel/geist-font` | Release zip; npm `geist` 1.9.2. Fontsource copy is older (file says "Version 1.002") |
| **Geist Mono** | OFL-1.1 | tabular (mono) | n/a | same repo | same |
| **Manrope** | OFL-1.1 | proportional | yes | `googlefonts/manrope` (`sharanda/manrope` now 404) | `google/fonts` `ofl/manrope`; `@fontsource/manrope` 5.3.0 |
| **Space Grotesk** | OFL-1.1 | proportional | yes | 2.0.0 (2020-10-29), `floriankarsten/space-grotesk` | Release zip; `@fontsource/space-grotesk` 5.3.0. Weights 300-700 only |
| **JetBrains Mono** | OFL-1.1 | tabular (mono) | n/a | v2.304 (2023-01-14), `JetBrains/JetBrainsMono` | Release zip; `@fontsource/jetbrains-mono` 5.3.0 |
| **IBM Plex Sans** | OFL-1.1 | **tabular by default** (all digits 600/1000 em) | not needed | `@ibm/plex-sans@1.1.0`, repo active 2026-11-19 | Release zip; `@fontsource/ibm-plex-sans` 5.3.0 |
| **IBM Plex Mono** | OFL-1.1 | tabular (mono) | n/a | `IBM/plex` | `@fontsource/ibm-plex-mono` 5.3.0 |

Sources: GitHub API licence + latest-release fields `[V][FT1]`; npm registry `latest` metadata `[V][FT2]`; file inspection `[TEST]`. None of these is Apache-licensed; all are SIL OFL 1.1, which permits bundling and embedding (keep the licence text with the font files; do not sell the fonts on their own).

Direct file URL pattern (all returned HTTP 200 today `[TEST][FT3]`):

```
https://cdn.jsdelivr.net/fontsource/fonts/{id}@latest/latin-{weight}-normal.{ttf|woff|woff2}
# e.g. inter@latest/latin-700-normal.woff2  -> 24,356 bytes;  .ttf -> 67,128 bytes
```

Download at build time and commit/bundle the files; do not fetch from a CDN at render time. Pin a version instead of `@latest`.

Recommendation:

- **Default: Inter** (weights 500, 700, 800) with `"tnum" 1`. Neutral, excellent digits, complete Spanish coverage, about 24 KB per weight as WOFF2.
- **More character: Space Grotesk 700 for the hero number + Inter for everything else.** Distinctive numerals, still `tnum`.
- **Safest if feature settings ever fail: IBM Plex Sans.** Tabular digits without any OpenType feature.
- Mono (JetBrains Mono / Geist Mono) only for the footer timestamp, if at all.

**Licence problem in the current code:** `blueimg/template.html` uses **GT Walsheim** (`blueimg/fonts/gtwalsheim.*`), a commercial Grilli Type typeface, not an open licence. `[U]` for the exact licence terms held by the owner, but it should not be carried into a public monorepo. Replace it with one of the above.

### 6.9 What finance/markets accounts do (2025-2026 patterns)

Observational, from general familiarity; no primary source. `[U]`

- Near-black background, one accent colour, white hero number. Bloomberg-terminal lineage.
- One data point per card. Multi-rate summaries go in a carousel (first slide = headline number) rather than a dense table.
- Ticker-style label in small caps top-left; logo small and constant in a corner.
- Delta as a coloured pill with arrow, absolute and percent change.
- Mini chart without axes; last point highlighted.
- "Alert" variants add a thin coloured band or a "ÚLTIMO MOMENTO" tag, used sparingly.
- Timestamp plus source/domain in the footer; no hashtags or long sentences on the image.
- Consistent template for months; variation comes from the data, not the design.

---

## 7. es-AR number and date formatting (tested)

All outputs below were produced today in Node 24.22.3 (ICU 78.3, CLDR 48) and reproduced in **workerd 1.20260730.1** via miniflare, where `Intl.NumberFormat.supportedLocalesOf(['es-AR'])` returns `['es-AR']`. `[TEST]` So `Intl` with `es-AR` works in Workers; no polyfill needed.

| Call | Output | Notes |
|---|---|---|
| `NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(1670)` | `$ 1.670,00` | The space is **U+00A0** (no-break space) |
| same with `maximumFractionDigits:0` | `$ 1.670` | |
| `.format(-25)` | `-$ 25,00` | ASCII hyphen-minus, before the symbol |
| `currency:'USD'` | `US$ 1,00` | With `currencyDisplay:'narrowSymbol'`: `$ 1,00` |
| `currency:'EUR'` | `EUR 1.810,25` | With `narrowSymbol`: `€ 1.810,25` |
| `NumberFormat('es-AR').format(1234567.891)` | `1.234.567,891` | `.` thousands, `,` decimal |
| `NumberFormat('es',{minimumFractionDigits:2}).format(1670)` | `1670,00` | Generic `es` and `es-ES` do **not** group 4-digit numbers — always pass `es-AR` |
| percent, `minimumFractionDigits:2, signDisplay:'exceptZero'`, `0.0123` | `+1,23%` | No space before `%`. `-0.006` -> `-0,60%`; `0` -> `0,00%` |
| `notation:'compact'`, `1500000` | `1,5 M` | |
| `DateTimeFormat('es-AR',{dateStyle:'medium',timeZone})` | `20 nov 2026` | |
| `{timeStyle:'short'}` | `7:45 p. m.` | **es-AR defaults to 12-hour clock** in CLDR 48 |
| `{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}` | `19:45` | Force 24 h explicitly |
| `{dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}` | `20 de nov de 2026, 19:45` | Combining adds "de ... de" |
| `{day,month:'short',hour,minute,hourCycle:'h23'}` | `20 nov, 19:45` | |
| `{..., timeZoneName:'short'}` | `19:45 ART` | `shortOffset` -> `GMT-3`; `long` -> `hora estándar de Argentina` |
| `{dateStyle:'full'}` | `viernes, 20 de noviembre de 2026` | |
| `{weekday:'short',day:'numeric',month:'short'}` | `vie, 20 nov` | |
| short months | `ene feb mar abr may jun jul ago sept oct nov dic` | September is **`sept`** (4 letters) |
| `RelativeTimeFormat('es-AR').format(-5,'minute')` | `hace 5 minutos` | |

To get exactly `20 nov 2026, 19:45`, compose two formatters:

```ts
const TZ = 'America/Argentina/Buenos_Aires';
const fDate = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeZone: TZ });
const fTime = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
export const stamp = (d: Date) => `${fDate.format(d)}, ${fTime.format(d)}`;      // "20 nov 2026, 19:45"

const fArs0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const fArs2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
// One rule per card: if every value on the card is whole -> 0 decimals, else 2 decimals for all.
export const ars = (n: number, decimals: 0 | 2) => (decimals ? fArs2 : fArs0).format(n);
const fPct = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
export const pct = (ratio: number) => fPct.format(ratio);                         // "+0,60%"
```

Conventions and gotchas:

- Symbol first, then a space, then the number: `$ 1.670,00`. Use `US$` for dollars when both currencies appear.
- The U+00A0 after `$` is good on the card (prevents wrapping). For plain-text captions it is harmless; replace with a normal space only if a platform mangles it.
- Never hand-format with `toFixed` + string replace; never rely on the default locale of the runtime.
- Outputs depend on the ICU/CLDR version of the runtime. Add a snapshot test for the formatter so a workerd upgrade that changes CLDR data is caught.
- Time zone label: Argentina is UTC-3 year-round (no DST currently; `[U]` from memory). Use `(ART)` on the card footer, "hora de Argentina" in alt text and captions. Always pass `timeZone: 'America/Argentina/Buenos_Aires'`; Workers run in UTC.
- "hs" suffix ("19:45 hs") is common Argentine usage `[U]`; pick one style and keep it.
- Percent: CLDR gives `+0,60%` without a space; RAE style recommends a space (`0,60 %`) `[U]`. Use the CLDR form on cards (tighter), either in prose.

---

## 8. Unverified items (test or confirm before relying on them)

1. `bsky.social` access/refresh JWT lifetimes (120 min / 90 days are open-source PDS defaults only) and whether `refreshSession` rotates the refresh token.
2. The live `createSession` limit of 10/day was measured with invalid identifiers; the bucket for successful logins may be the documented 300/day.
3. Telegram server-side photo downscaling (about 1280 px) and URL caching behaviour.
4. X organic timeline crop rules; X alt-text limit (1000).
5. X link-card specs come from an archived page; X no longer publishes Cards docs.
6. Instagram grid centre-crop arithmetic; Instagram error codes for out-of-range ratios; whether links in captions are clickable.
7. Organic Instagram Stories safe zone (250/340 px) — only the ads figures (14% / 35% / 6%) are official.
8. Mastodon: instance rules about bots; the "bot account" profile flag path; per-instance limits other than mastodon.social.
9. LinkedIn binary upload method (PUT to `uploadUrl`) and commentary length limit.
10. WhatsApp: absence of a Channels publishing API is inferred from its absence in all official docs checked; the Content Library page was seen only as a search summary.
11. WCAG SC 1.4.1 and 1.4.11 wording (cited from memory); Material dark-theme guidance (page could not be fetched).
12. LatAm colour convention and the "what top accounts do" list are observational.
13. PNG size estimates for flat-colour cards; PNG->JPEG conversion options inside Workers were not researched here.
14. GT Walsheim licence status for the current owner.

---

## 9. Sources

Bluesky / AT Protocol

- `[B1]` https://docs.bsky.app/docs/advanced-guides/posts -> 308 -> https://bsky.network/docs/about-bluesky-content/posts (site footer "2026"; fetched 2026-11-22). Internal inconsistency: code sample says 2,000,000 bytes, prose says 1,000,000.
- `[B2]` Lexicons, `bluesky-social/atproto` `main`: https://raw.githubusercontent.com/bluesky-social/atproto/main/packages/pds/lexicons/app/bsky/embed/images.json , `.../embed/external.json`, `.../embed/defs.json`, `.../feed/post.json`, `.../richtext/facet.json`. PR "Increase max image upload size to 2mb from 1mb" https://github.com/bluesky-social/atproto/pull/4823 merged 2026-04-08. (Old path `lexicons/app/bsky/...` at repo root now 404s; moved 2026-10-15.)
- `[B3]` https://bsky.network/docs/rate-limits (2026)
- `[B4]` https://bsky.network/docs/api-directory (2026)
- `[B5]` https://bsky.network/docs/oauth-client (2026)
- `[B6]` https://atproto.com/specs/xrpc (fetched 2026-11-22)
- `[B7]` https://raw.githubusercontent.com/bluesky-social/atproto/main/packages/pds/src/account-manager/helpers/auth.ts and `.../packages/pds/src/api/com/atproto/server/createSession.ts` (`main`, 2026-11-22)
- `[B8]` Live probe 2026-11-22: `POST https://bsky.social/xrpc/com.atproto.server.createSession` with non-existent identifiers -> 401 + `ratelimit-policy: 10;w=86400`; `GET .../com.atproto.server.describeServer` -> `ratelimit-policy: 3000;w=300`
- `[B9]` https://raw.githubusercontent.com/bluesky-social/social-app/main/src/components/images/AutoSizedImage.tsx (`main`, 2026-11-22)
- `[B10]` https://bsky.network/docs/about-bluesky-content/post-richtext (2026)
- `[B11]` https://atproto.com/specs/handle (fetched 2026-11-22)
- `[B12]` https://techcrunch.com/2026/04/23/bluesky-now-supports-better-quality-photos/ (2026-04-23)
- `[B13]` https://bsky.network/docs/entryway and https://bsky.network/docs/developer-guidelines (2026)

Telegram

- `[T1]` https://core.telegram.org/bots/api — Bot API 10.5, "November 22, 2026" (sections: Making requests, sendPhoto, Sending files, Formatting options, ChatAdministratorRights, ResponseParameters, InputStoryContentPhoto)
- `[T2]` https://core.telegram.org/bots/faq (undated; fetched 2026-11-22)
- `[T3]` https://core.telegram.org/bots/features (undated; fetched 2026-11-22)

Mastodon

- `[M1]` https://docs.joinmastodon.org/methods/media/
- `[M2]` https://docs.joinmastodon.org/methods/statuses/ (includes 4.5.0 additions)
- `[M3]` https://docs.joinmastodon.org/api/rate-limits/
- `[M4]` https://docs.joinmastodon.org/methods/oauth/ , https://docs.joinmastodon.org/entities/Token/ , https://docs.joinmastodon.org/client/token/
- `[M5]` https://raw.githubusercontent.com/mastodon/mastodon/main/config/initializers/doorkeeper.rb (`main`, 2026-11-22)
- `[M6]` https://raw.githubusercontent.com/mastodon/mastodon/main/config/initializers/rack_attack.rb and `.../config/routes/settings.rb` (`main`, 2026-11-22)
- `[M7]` Live `GET https://mastodon.social/api/v2/instance` on 2026-11-22 (version `5.0.0-nightly.2026-11-20`)
- `[M8]` https://docs.joinmastodon.org/user/posting/
- `[M9]` https://docs.joinmastodon.org/api/guidelines/
- `[M10]` https://api.github.com/repos/mastodon/mastodon/releases (v4.7.6 and v5.0.0-beta.2, 2026-11-19)
- `[M11]` https://docs.joinmastodon.org/entities/Instance/
- Mastodon docs pages are undated; all fetched 2026-11-22.

WhatsApp

- `[W1]` https://developers.facebook.com/docs/whatsapp/cloud-api/overview (undated)
- `[W2]` https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform (undated)
- `[W3]` https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/wa-channel (search-result summary only)
- `[W4]` https://faq.whatsapp.com/549900560675125
- `[W5]` Third-party, unofficial: https://whapi.cloud/how-to-automate-whatsapp-channels-api , https://waha.devlike.pro/whatsapp-channels/

LinkedIn (Microsoft Learn; default version `li-lms-2026-11`)

- `[L1]` https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review (ms.date 2023-01-10, updated 2026-02-11)
- `[L2]` https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access (ms.date 2026-10-14)
- `[L3]` https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api (ms.date 2026-05-07)
- `[L4]` https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api (ms.date 2026-06-19)
- `[L5]` https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow (ms.date 2025-11-10, updated 2026-05-15)
- `[L6]` https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens (ms.date 2025-05-31, updated 2025-10-08)

Meta (Instagram, Facebook, Threads)

- `[I1]` https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ (examples use v27.0; dated notes 2025-03-24 and 2025-07-09)
- `[I2]` https://developers.facebook.com/docs/instagram-platform/content-publishing/ (v27.0)
- `[I3]` https://www.facebook.com/business/ads-guide/update/image/instagram-feed/ ((c) 2026)
- `[I4]` https://www.facebook.com/business/ads-guide/update/image/instagram-story/ ((c) 2026)
- `[I5]` https://www.facebook.com/business/ads-guide/update/image/facebook-feed/ ((c) 2026)
- `[I6]` https://petapixel.com/2025/05/29/instagram-finally-adds-support-for-34-aspect-ratio-photos (2025-05-29); also https://9to5mac.com/2025/05/29/instagram-changes-standard-photo-aspect-ratio/
- `[F1]` https://developers.facebook.com/docs/sharing/webmasters/images/ (undated)
- `[TH1]` https://developers.facebook.com/docs/threads/posts (mentions 2025-12-22 change)

X

- `[X1]` https://docs.x.com/x-api/media/quickstart/best-practices (undated)
- `[X2]` https://docs.x.com/x-api/media/quickstart/media-upload-chunked (undated)
- `[X3]` https://business.x.com/en/help/campaign-setup/creative-ad-specifications ((c) 2026)
- `[X4]` https://web.archive.org/web/20260112050218/https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image (capture 2026-01-12; live URL now redirects to https://docs.x.com/overview)

Design, fonts, tooling

- `[WC1]` https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- `[SAT]` https://raw.githubusercontent.com/vercel/satori/main/README.md ; npm `satori` 0.63.2, published 2026-10-20
- `[FT1]` GitHub API `repos/{owner}/{repo}` and `/releases/latest` for `rsms/inter`, `vercel/geist-font`, `floriankarsten/space-grotesk`, `JetBrains/JetBrainsMono`, `IBM/plex`; Manrope licence at https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt
- `[FT2]` npm registry `latest`: `@fontsource/{inter,geist-sans,geist-mono,manrope,space-grotesk,jetbrains-mono,ibm-plex-sans,ibm-plex-mono}` 5.3.0 (OFL-1.1); `geist` 1.9.2
- `[FT3]` Fontsource CDN files `https://cdn.jsdelivr.net/fontsource/fonts/{id}@latest/latin-{400,700}-normal.ttf`; metadata https://api.fontsource.org/v1/fonts/inter
- Local tests: Node v24.22.3 (ICU 78.3, CLDR 48, tz 2026e); miniflare 4.20260730.0 / workerd 1.20260730.1; fontkit 2.x
- Existing code read for context: `bluescraper/src/updates.py`, `bluescraper/src/buffer.py`, `blueimg/gen_image.py`, `blueimg/template.html`
