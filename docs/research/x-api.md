# Posting to X (Twitter) from a Cloudflare Worker cron — state as of 2026-11-22

Scope: @bluelytics posts ~3-15 times per weekday, text + ONE generated image, unattended, from a Worker (fetch + WebCrypto only).

Legend: **[V]** verified today from a primary source (URL + date given). **[S]** secondary: official-forum thread seen only through search-engine snippets, or third-party. **[U]** unverified / inferred.

Access notes: `devcommunity.x.com`, `help.x.com` and `business.x.com` returned HTTP 403 to automated fetches, so nothing from those hosts is [V]. Primary sources actually read: `docs.x.com` (raw `.md` pages, `openapi.json` v2.175, `changelog.md`, `llms-full.txt`), the official docs repo `github.com/xdevplatform/docs` (PRs, `sliders.js`), the official `xdevplatform/xurl` README, the live rate card `https://console.x.com/api/credits/pricing`, the npm registry, RFC 5849, and unauthenticated probes of `api.x.com`.

Verifier note (2026-11-22, second pass): the forum and help center ARE readable by a script. `https://devcommunity.x.com/t/<id>.json` (Discourse JSON, browser User-Agent, `Accept: application/json`) and `https://devcommunity.x.com/search.json?q=...` return 200, as do `https://help.x.com/en/rules-and-policies/x-automation` and `/x-limits`. Statements re-checked against those pages are tagged **[V-forum]** (official forum post by an account flagged `staff: true` / "X Staff", quoted) or **[V-help]** below. Forum posts by ordinary developers remain [S]. Full results in the last section.

---

## 0. Bottom line (read this first)

1. **OAuth 1.0a is being retired on 2027-01-31** [V]. The "four static keys, sign with HMAC-SHA1, no token storage" design is dead ten weeks from now. Build on **OAuth 2.0 user context (Authorization Code + PKCE, confidential client, rotating refresh token)** and store the token pair in D1.
2. **There is no Free/Basic/Pro tier any more for new self-serve use; it is pay-per-use credits only** [V]. A post costs **$0.015**; a post **containing a URL costs $0.20** [V]. Never put a link (or a bare domain) in the post text.
3. Realistic cost: **$0.030 per image post, $0.035 with alt text** ($0.005). X staff confirmed on 2026-08-31 that each uploaded media object is counted as one extra `PostCreate` on top of the final `POST /2/tweets` [V-forum, see 1.3]; the public rate card still does not say so. That is **about $3.00-$3.50 per 100 posts**. (The $0.015 "upload is free" scenario is not what the Console bills today.)
4. Image posting works end to end on v2 with one OAuth 2.0 bearer token: `POST /2/media/upload` (one-shot) -> optional `POST /2/media/metadata` (alt text) -> `POST /2/tweets` [V].
5. **Risk to test on day one:** `api.x.com` is itself behind Cloudflare. The July 2025 incident (Workers getting `403` with body `IPv6`) was fixed within about 36 hours (2025-07-03 to 2025-07-04), with one unanswered recurrence report on 2025-08-19 [S, forum thread read in full]. In August to October 2026 developers report Workers reaching the API and posting, including with OAuth 2.0, without edge blocks [S]. A different Workers-only failure is open in 2026: the OAuth 1.0a 3-legged step `POST /oauth/access_token` returns HTTP 500 only from Workers egress, acknowledged by X staff and unresolved as of 2026-10-27 [V-forum]. The OAuth 2.0 design here does not call that endpoint, but it shows Workers egress is still treated differently at times. Deploy a 10-line Worker smoke test before building anything (section 8).

---

## 1. Access tiers and pricing

### 1.1 What exists now

| Fact | Status | Source |
| :- | :- | :- |
| "The X API uses pay-per-usage pricing. No subscriptions - pay only for what you use." Credits are bought upfront in the Developer Console (`console.x.com`) and deducted per request. No contracts, no minimum spend. | [V] | https://docs.x.com/x-api/getting-started/pricing.md (undated page, fetched 2026-11-22) |
| Pay-Per-Use launched 2026-02-06. "Public Utility Apps continue to receive free scaled access. Recently active Legacy Free tier users receive a one-time $10 voucher. Basic and Pro plans remain available, and existing subscribers can opt in to Pay-Per-Use." | [V] | https://docs.x.com/changelog.md entry "Feb 6, 2026" |
| Legacy Basic plans deprecated (announced 2026-05-21, subscribers moved to PPU on their billing-cycle cutover after 2026-06-01); legacy Pro deprecated (announced 2026-08-14, moved after 2026-09-01). | [V-forum] | X Staff posts, read in full 2026-11-22: https://devcommunity.x.com/t/266305 (Basic, 2026-05-21) and https://devcommunity.x.com/t/273255 (Pro, 2026-08-14) |
| Only other option is Enterprise (custom pricing, sales form). | [V] | pricing.md, https://docs.x.com/x-api/fundamentals/post-cap.md |
| A pre-existing legacy Free app does **not** post for free any more. X Staff 2026-09-23: "the legacy Free tier has been deprecated. Apps that were still on Free were moved to Pay-Per-Use; posting without credits returns HTTP 402 credits-depleted". X staff-group automated account `twin` ("Automated by @taycaldwell") 2026-11-19: a project still showing the legacy Free plan "doesn't include the v2 media upload endpoints ... It also doesn't include POST /2/tweets". | [V-forum] | https://devcommunity.x.com/t/276550 , https://devcommunity.x.com/t/281390 |

### 1.2 Rate card relevant to us

Two primary sources agree (docs page + the live JSON the docs' own cost widget reads):

| Operation | Price | Live key in `console.x.com/api/credits/pricing` |
| :- | :- | :- |
| Post: Create (`POST /2/tweets`) | **$0.015 / request** | `PostCreate: 0.015` |
| Post: Create **(with URL)** | **$0.200 / request** | `ContentCreateWithUrl: 0.2` |
| Post: Create (summoned reply) | $0.010 / request | `ContentCreateSummoned: 0.01` |
| Media Metadata (`POST /2/media/metadata`, i.e. alt text) | **$0.005 / request** | `MediaMetadata: 0.005` |
| Content: Manage (delete a post) | $0.005 / request | `ContentManage: 0.005` |
| User: Read (e.g. `GET /2/users/me`) | $0.010 / resource | `User: 0.01` |
| Owned Reads (own posts/mentions/followers...) | $0.001 / resource | `OwnedRead: 0.001` |
| Anything not listed | - | `defaultCost: 0.0` |

Sources [V]: https://docs.x.com/x-api/getting-started/pricing.md ; `https://console.x.com/api/credits/pricing` (JSON, fetched 2026-11-22, publicly readable); changelog "Apr 16, 2026": "`POST /2/tweets` is now $0.015 per post, and Posts containing a URL are $0.20 per Post (summoned replies remain $0.01)", effective 2026-04-20.

Reads are about to get dearer [V, open PR https://github.com/xdevplatform/docs/pull/520, not merged as of 2026-11-22]: objects returned through `expansions` (media, poll, place, topic at $0.005 each; users at $0.010) are planned to be billed from 2026-11-22. Irrelevant for posting (`POST /2/tweets` returns only `id` and `text`), but never add `expansions` to any read the bot makes.

Caps [V]: the only monthly cap on PPU is **3 million Post reads** per billing cycle (pricing.md). **No monthly/daily post-creation cap is documented**; posting is bounded by rate limits (section 4) and by your credit balance / spending limit.

Billing mechanics [V] (pricing.md, post-cap.md):
- Balance can go slightly negative; requests are then blocked until topped up.
- Auto-recharge: set recharge amount + trigger threshold; at most one top-up per 5 minutes; paused at zero/negative balance.
- Spending limit per billing cycle: when reached, "API requests will be blocked until the next billing cycle". Caveat [S]: developers reported in July 2026 that the spend cap and the negative-balance block were not enforced for days (https://devcommunity.x.com/t/271962, no staff answer in the thread). Keep auto-recharge off or small and add an app-side daily post cap; do not rely on the Console limit alone.
- "Do failed requests count? No. Only successful responses that return data are billed." (post-cap.md FAQ). Conflict [V-forum]: X Staff wrote on 2026-08-31 about media uploads and posts that "Failed retries can still record usage" (https://devcommunity.x.com/t/274646). Treat every upload attempt as potentially billed and avoid blind retries.
- Balance endpoint: `GET https://api.x.com/2/usage/credits` (Bearer app token or OAuth2 user token) returns `total_balance`, `prepaid_balance`, `free_balance`, `free_grants` in USD (openapi.json v2.175).

Free credits [V] (https://docs.x.com/x-api/getting-started/free-credits.md, changelog "Oct 2, 2026", rule updated 2026-10-13):
- One-time **$20** after the first credit purchase on an account whose first eligible credit/debit card (not prepaid) is saved.
- One-time match of the first successful auto-recharge, **up to $50**.
- Free credits are spent first and **expire 3 months after grant**. "These incentives are currently rolling out."

Public Utility program [V] (https://docs.x.com/exhibit.md): "Public Utility is a credit program for public-good work on the X API." You must first publish an app listing on the Developer Exhibit (from the Console; needs website, logo, screenshots, a launch post from the same account), then request Public Utility from the live listing; the X Dev Platform team decides. Bluelytics (free public exchange-rate information) is **unlikely to qualify** [V-forum]: on 2026-09-23 X Staff refused a lottery-results bot with "Lottery / results-informational bots are not Public Utility / for-good (that path is reserved for government / critical public-safety alerts, case-by-case)" (https://devcommunity.x.com/t/276550). The staff-group automated account `twin` also stated on 2026-11-17 that requests only go through the Exhibit listing, not the forum, and that "Approval isn't guaranteed" (https://devcommunity.x.com/t/280177). Do not budget on it. Credit size: [U].

### 1.3 Is media upload billed? (yes, per X staff; still missing from the rate card)

| Evidence | Says | Status |
| :- | :- | :- |
| Pricing page write table | No "media upload" line. Only Post: Create and Media Metadata. | [V] |
| Live rate JSON | No media-upload key; `defaultCost: 0.0`. | [V] |
| Official docs cost-estimator script `sliders.js` (https://raw.githubusercontent.com/xdevplatform/docs/main/sliders.js, last commit 2026-08-05) | Maps `upload-media`, `initialize-media-upload`, `append-media-upload`, `finalize-media-upload` to the **same billing class as `create-post`** (`ContentCreate`). The widget's class for create-post is itself stale ($0.010 vs the $0.015 `PostCreate`), so the mapping is suggestive, not authoritative. | [V] that the mapping exists |
| Forum thread https://devcommunity.x.com/t/274646 (opened by verifier 2026-11-22) | X Staff (`taycaldwell`, 2026-08-31), verbatim: "Media INIT/APPEND/FINALIZE are not listed as separate Post: Create rows, but console PostCreate counts matching one event per media object plus the final POST /2/tweets is the current usage accounting — the original Pay Per Use announcement billed Content (Create) for creating posts or media. Chunked appends and status polls are not billed as Post: Create. Media Metadata is $0.005. Failed retries can still record usage. I'll ask for the pricing page to spell out that mapping." | **[V-forum]** staff statement |
| Forum thread https://devcommunity.x.com/t/279445 (2026-10-27) | A second developer sees 2 `PostCreate` per one-media post and asks whether this is "intended, stable pricing"; staff bot reply: "We're checking on media upload billing with the team and will follow up". No follow-up as of 2026-11-22. | [V-forum] that the question is still open |
| Live rate JSON, second look | Besides `PostCreate: 0.015` it still carries `ContentCreate: 0.01` and `Write: 0.01`. X Staff 2026-08-31 (https://devcommunity.x.com/t/274497): "Content Create is the older label for that same write bucket (creating posts or media)". So a $0.010 charge per upload cannot be ruled out, but the Console evidence is `PostCreate` ($0.015). | [V] |

Conclusion: **an image post costs $0.015 (post) + $0.015 (one media object) = $0.030**, plus $0.005 if alt text is set. Accounting is **per media object, not per request**, so one-shot and chunked upload cost the same; the one-shot upload is still the right choice for a PNG (one request, nothing to finalize). Because "failed retries can still record usage", never re-upload on a retry: persist the `media_id` and reuse it (it lives about 24 h). Measure it once anyway: read `GET /2/usage/credits` before and after a test post, and check the Console usage breakdown.

### 1.4 What counts as "with URL" ($0.20)

X has not published the detection rule [U]. The docs widget only says "Posts containing a URL: $0.200 per request (summoned replies remain at standard price)" [V, sliders.js]. Safe rule: **no `http(s)://` link and no bare domain** such as `bluelytics.com.ar` in `text` (X's text parser auto-links bare domains with valid TLDs, and that very likely counts) [U]. Put the domain inside the image and in the profile bio/website field. An attached image is not a URL in the request body; third-party rate tables list "text or media, no link" at the plain rate [S]. Confirmed by X Staff on 2026-05-15 [V-forum, https://devcommunity.x.com/t/264451]: "Anytime you provide a URL as part of the text, it's going to be treated as a post containing a URL ... if you're trying to attach media to a post, instead of providing a link to the media as part of the text, make use of the media.media_ids field." So the trigger is a link **in `text`**; media attached through `media.media_ids` is billed at the plain rate. Whether a bare domain without scheme counts is still [U].

### 1.5 Monthly cost estimate

Per-post cost scenarios:

| Scenario | Per post |
| :- | :- |
| A. Rate card only: post + image, upload not billed, no alt text (contradicted by X staff, 1.3; only valid for a text-only post) | $0.015 |
| B. A + alt text (same caveat) | $0.020 |
| C. Upload billed as one PostCreate (X staff 2026-08-31, current Console accounting), no alt text | $0.030 |
| D. C + alt text (**plan for this**) | $0.035 |
| E. Any of the above but with a URL in the text | $0.200 to $0.220 |

| Posts / month | A | B | C | **D** | E (URL) |
| :- | :- | :- | :- | :- | :- |
| 100 | $1.50 | $2.00 | $3.00 | **$3.50** | $20-22 |
| 300 | $4.50 | $6.00 | $9.00 | **$10.50** | $60-66 |
| 600 | $9.00 | $12.00 | $18.00 | **$21.00** | $120-132 |

3-15 posts per weekday is roughly 65-330 posts/month, so budget **$2-$12/month**; the first months are covered by the $20 (+ up to $50) free credits. Cheapest viable option = pay-per-use with a Console spending limit of about $15/cycle. Fewer, more meaningful posts (open, close, moves above a threshold) are the main cost lever.

---

## 2. Endpoints to create a post with an image

All on `https://api.x.com`. Auth for every call below: `Authorization: Bearer <OAuth 2.0 user access token>` (or an OAuth 1.0a header until 2027-01-31). Source for everything in this section unless noted: https://docs.x.com/openapi.json (version 2.175, fetched 2026-11-22) and the matching reference pages [V].

### 2.1 One-shot image upload (use this)

`POST https://api.x.com/2/media/upload` — "Uploads a media file in one request and returns its id. Send the file base64-encoded in media (raw bytes in multipart bodies). For a Post, set media_category to tweet_image (JPG, PNG, GIF or WEBP, up to 5 MB) or tweet_gif ... For video, use Initialize Media Upload." (https://docs.x.com/x-api/media/upload-media.md)

- Content types: `multipart/form-data` or `application/json`.
- Body schema `MediaUploadRequest`, `additionalProperties: false`:
  - `media` (required): raw bytes in multipart, base64 string in JSON.
  - `media_category` (required): `tweet_image` | `tweet_gif` | `tweet_video` | `dm_image` | `dm_video` | `dm_gif` | `subtitles`.
  - `additional_owners` (optional): comma-separated user ids.
  - There is **no `media_type` field** on this endpoint in v2.175 (older 2025 examples send it; do not).
- Scope: `media.write`. Security: `OAuth2UserToken[media.write]` or `UserToken` (OAuth 1.0a).
- Response 200: `{"data":{"id":"<digits>","media_key":"3_<digits>","size":N,"expires_after_secs":N,"image":{"image_type":"image/png","w":1600,"h":900}}}`. Use `data.id` as a string. An image needs no STATUS polling (a result without `processing_info` is ready).
- Verifier notes 2026-11-22: (a) https://docs.x.com/x-api/media/introduction.md calls this endpoint "the older simple upload (images only)" and the chunked flow "recommended"; the one-shot endpoint is nevertheless in the current spec, in the rate-limit table, and the X staff-group account `twin` listed "the one-shot POST /2/media/upload" among the pay-per-use media endpoints on 2026-11-19 (https://devcommunity.x.com/t/281390). (b) Without the `media.write` scope the call returns 403 even though `POST /2/tweets` works with the same token (developer report, https://devcommunity.x.com/t/265176). (c) End-to-end confirmation in production: OAuth 2.0 PKCE token with `tweet.read tweet.write users.read media.write offline.access`, image through `POST /2/media/upload`, then `POST /2/tweets` with `text` + `media.media_ids` returned HTTP 201 on 2026-10-15 (https://devcommunity.x.com/t/278262) [S, developer report with X Staff in the thread].

```bash
# multipart (raw bytes)
curl -sS -X POST "https://api.x.com/2/media/upload" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" \
  -F "media_category=tweet_image" \
  -F "media=@post.png;type=image/png"

# JSON (base64) alternative
curl -sS -X POST "https://api.x.com/2/media/upload" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"media_category\":\"tweet_image\",\"media\":\"$(base64 -w0 post.png)\"}"
```

### 2.2 Chunked upload (not needed for a PNG; documented for completeness)

Changelog "Sep 1, 2026": the quickstart "now uses the v2 paths ... instead of the previous command-style `POST /2/media/upload` flow". Do **not** send `command=INIT|APPEND|FINALIZE` to `/2/media/upload` (https://docs.x.com/x-api/media/quickstart/media-upload-chunked.md).

```bash
# 1 INIT (JSON body, not multipart)
curl -sS -X POST "https://api.x.com/2/media/upload/initialize" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"media_type":"image/png","total_bytes":183422,"media_category":"tweet_image"}'
# -> {"data":{"id":"1880028106020515840","media_key":"...","expires_after_secs":86400}}

# 2 APPEND (multipart; segment_index from 0; <= 5 MB recommended, 8 MB server max, 4 MB if JSON/base64)
curl -sS -X POST "https://api.x.com/2/media/upload/1880028106020515840/append" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" -F "segment_index=0" -F "media=@post.png"

# 3 FINALIZE (no body)
curl -sS -X POST "https://api.x.com/2/media/upload/1880028106020515840/finalize" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN"

# 4 STATUS (only if FINALIZE returned processing_info; video/GIF)
curl -sS "https://api.x.com/2/media/upload?command=STATUS&media_id=1880028106020515840" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN"
```

`initialize` fields: `media_type` enum includes `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`...; `media_category` enum adds `amplify_video`; `total_bytes` max 17179869184; `shared`, `additional_owners` optional.

### 2.3 Alt text

`POST https://api.x.com/2/media/metadata` — scope `media.write`; body `{"id":"<media_id>","metadata":{"alt_text":{"text":"..."}}}`; `alt_text.text` **maxLength 1000**; billed $0.005. Call it after upload and before creating the post.

```bash
curl -sS -X POST "https://api.x.com/2/media/metadata" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"1880028106020515840","metadata":{"alt_text":{"text":"Dolar blue: compra 1.250, venta 1.270. Oficial: 1.050 / 1.090. 22/11/2026 15:00."}}}'
# -> {"data":{"id":"1880028106020515840","associated_metadata":{...}}}
```

### 2.4 Create the post

`POST https://api.x.com/2/tweets` — JSON only. Scopes: **`tweet.read tweet.write users.read`** (all three are listed). Response **201** `{"data":{"id":"...","text":"..."}}`.

```bash
curl -sS -X POST "https://api.x.com/2/tweets" \
  -H "Authorization: Bearer $X_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Dolar blue hoy: compra 1.250 / venta 1.270 (+10). Oficial 1.050 / 1.090.","media":{"media_ids":["1880028106020515840"]}}'
```

Relevant body fields (`additionalProperties: false`): `text` ("Required unless media is provided. At most 280 characters unless the account has X Premium"), `media.media_ids` (1-20 ids as strings; a Post may include up to 4 photos, 1 GIF or 1 video), `media.tagged_user_ids`, `reply`, `reply_settings` (`following` | `mentionedUsers` | `subscribers` | `verified`), `made_with_ai` (AI-generated media disclosure; not applicable to a programmatically drawn chart), `nullcast`, `paid_partnership`.

Self-serve restrictions on `POST /2/tweets` [V] (https://docs.x.com/x-api/posts/manage-tweets/integrate.md, create-post.md, changelog "Feb 23, 2026" and "Apr 16, 2026"):
- **Max 1 cashtag (`$TICKER`) per post**; more is rejected. Peso amounts like `$1.250` are not cashtags, but do not write `$USD $ARS`.
- Replies via API only when the original author @mentioned or quoted the bot ("summoned").
- `quote_tweet_id` requires Enterprise. Following/Likes/Quote-Posts are removed from self-serve.
- "Additional restrictions apply to programmatically @mentioning or quoting users": do not @mention anyone.

### 2.5 Is v1.1 `upload.twitter.com` still usable?

Do not use it.
- X announced the v1.1 media upload endpoints "will be sunset on Monday, June 9, 2025" (X Staff post https://devcommunity.x.com/t/241818 dated 2025-04-30, read in full 2026-11-22, linked from changelog "Apr 30, 2025") [V-forum]. The same post states that `POST /2/media/upload` is "exclusively used for one-shot media uploads moving forward (limited to image and subtitle files only)".
- Probe 2026-11-22: `POST https://upload.twitter.com/1.1/media/upload.json` and `https://upload.x.com/1.1/media/upload.json` without auth still answer `400 {"errors":[{"code":215,"message":"Bad Authentication data."}]}`; this shows the route exists, not that it works for a pay-per-use app [V probe, U usability]. Third-party reports conflict.
- It only accepts OAuth 1.0a, which stops working on 2027-01-31; X says "Move v1.1 calls to their v2 equivalents before the retirement date" [V].

---

## 3. Authentication for a single-account bot

### 3.1 What works where (today)

| Endpoint | OAuth 1.0a user context | OAuth 2.0 user context |
| :- | :- | :- |
| `POST /2/media/upload` (+ initialize/append/finalize, status) | yes (`UserToken`) | yes, scope `media.write` |
| `POST /2/media/metadata` | yes | yes, scope `media.write` |
| `POST /2/tweets` | yes | yes, scopes `tweet.read tweet.write users.read` |

Source: `security` arrays in https://docs.x.com/openapi.json v2.175 [V]. So **both** methods work for upload and post creation today. App-only bearer tokens cannot post.

### 3.2 OAuth 1.0a is being retired — the deciding fact

"X is retiring OAuth 1.0a user authentication. Apps have until **January 31, 2027**, to move to OAuth 2.0. After that date, requests signed with OAuth 1.0a stop working." [V]
- https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange.md (fetched 2026-11-22)
- Docs repo PR #538 "Move OAuth 1.0a retirement date to January 31, 2027", merged 2026-11-05 (previous date was January 1, 2027); PR #515 merged 2026-10-28 introduced the migration guide; PR #438 merged 2026-09-22 was "the first place on docs.x.com that mentions" the retirement. https://github.com/xdevplatform/docs/pull/538
- Changelog "Sep 21, 2026": token-exchange grant announced.
- Caveat: the date has already moved once; several other docs pages (manage-posts quickstart/integration guide, XDK samples) still show OAuth 1.0a examples without a deprecation banner.
- Verifier 2026-11-22: the three sentences carrying the date are present on the live page and in `llms-full.txt`; PR #538 (merged 2026-11-05T22:26Z), #515 and #438 confirmed through the GitHub API. The retirement is stated **only** on that migration page: there is no changelog entry for the retirement itself (only the "Sep 21, 2026" token-exchange entry) and a forum search found no announcement thread. A developer already cites "OAuth 1.0a, which is retired on Jan 31, 2027" (https://devcommunity.x.com/t/278014, 2026-11-08). The decision to build on OAuth 2.0 does not depend on the exact day.

Consequence: OAuth 1.0a would have been the simplest unattended option (static, non-expiring credentials, no storage), but it is not a viable foundation. **Use OAuth 2.0 and accept token storage.** OAuth 1.0a is useful only as (a) a headless bootstrap and (b) an automatic recovery path until 2027-01-31 (3.5).

### 3.3 OAuth 2.0 facts

All [V] from https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md , .../user-access-token.md , .../oauth-1-0a-token-exchange.md , https://docs.x.com/fundamentals/developer-apps.md

- Authorize URL: `https://x.com/i/oauth2/authorize?response_type=code&client_id=...&redirect_uri=...&scope=...&state=...&code_challenge=...&code_challenge_method=S256` (S256 or plain; `state` up to 500 chars).
- Token URL: `POST https://api.x.com/2/oauth2/token`, `Content-Type: application/x-www-form-urlencoded`. Revoke: `POST https://api.x.com/2/oauth2/revoke`.
- App types: "Web App" and "Automated App / Bot" are **confidential** clients (get a Client Secret; authenticate to the token endpoint with `Authorization: Basic base64(client_id:client_secret)`). Native / Single Page are public (send `client_id` in the body).
- The authorization code must be exchanged **within 30 seconds**.
- Access token lifetime **2 hours** (`expires_in: 7200`).
- Refresh token issued only with scope `offline.access`; lasts **about 6 months**; **single-use**: every refresh returns a new refresh token and the old one stops working. "Save the new one before you use the new access token." "If two workers refresh the same token at once, one of them fails."
- "X keeps one live OAuth 2.0 grant per user per App": re-authorizing or re-exchanging the same account on the same app invalidates the previously issued pair.
- Callback URLs: exact match, max 10 per app, `https://` in production, `http://127.0.0.1` for local (the docs say not `localhost`, although the official xurl tool defaults to `http://localhost:8080/callback`; register exactly what you use).
- "The OAuth login authorizes whichever X account is logged in when the browser opens" (https://docs.x.com/tools/mcp.md): be logged in as @bluelytics when approving.
- Scopes to request: **`tweet.read tweet.write users.read media.write offline.access`**.
- Token endpoint error shape (probe 2026-11-22): `400 {"error":"invalid_client","error_description":"Value passed for the client id was invalid."}`. A burned/expired refresh token is reported by developers as `400 invalid_request` "Value passed for the token was invalid." [S].

Requests:

```bash
# One-time: exchange the authorization code (within 30 s)
curl -sS -X POST https://api.x.com/2/oauth2/token \
  -u "$X_CLIENT_ID:$X_CLIENT_SECRET" -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "code_verifier=$VERIFIER"
# -> {"token_type":"bearer","expires_in":7200,"access_token":"...","refresh_token":"...","scope":"..."}

# Every ~2 h: refresh (rotates the refresh token)
curl -sS -X POST https://api.x.com/2/oauth2/token \
  -u "$X_CLIENT_ID:$X_CLIENT_SECRET" -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=refresh_token' \
  --data-urlencode "refresh_token=$X_REFRESH_TOKEN"
```

### 3.4 Storage design for the Worker

- Keep `X_CLIENT_ID` / `X_CLIENT_SECRET` as Worker secrets. Keep the mutable token pair in **D1** (strongly consistent), not KV: KV is eventually consistent, and reading a stale, already-used refresh token is exactly the failure to avoid.

```sql
CREATE TABLE x_oauth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,      -- epoch ms
  scope TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

- Refresh only inside the cron path, lazily (when `expires_at - now < 5 min` and a post is due). Take the lock with `UPDATE x_oauth SET lock_until=?now+60000 WHERE id=1 AND lock_until < ?now` and proceed only if one row changed; write the new pair with `version = version + 1` before any API call.
- With weekday posting the refresh token is renewed many times a day, so the 6-month lifetime is never approached. Add a weekly keep-alive refresh only if posting could pause for months.
- Never authorize the same app + account from another tool (e.g. `xurl token` on a laptop) once the Worker owns the pair; it would rotate or invalidate the Worker's copy.
- If refresh returns HTTP 400: until 2027-01-31 auto-recover through the token exchange (3.5); afterwards alert the owner to redo the browser authorization (an admin-only `/admin/x/authorize` + `/admin/x/callback` route on the Worker that performs PKCE and writes the row makes this a one-click fix).
- Expect this to happen occasionally; it is the main operational risk of the OAuth 2.0 design [V-forum]. X Staff 2026-07-27 (https://devcommunity.x.com/t/271768): "When the token endpoint successfully processes a refresh (even if the client later sees a 503 or network error on a related call), the old refresh token is immediately invalidated server-side and a new one is issued", and the advice is "On any refresh failure (especially 400/401 "invalid"), treat the token as dead and fall back to re-authorization. Add a small retry window with exponential backoff only on 5xx". So a refresh call that times out inside the Worker can burn the only refresh token. A developer also reported on 2026-11-11 that refresh tokens returned with HTTP 200 during X API degradation (2026-10-21 and 2026-11-11) were rejected two hours later with `400 invalid_request` "Value passed for the token was invalid." (https://devcommunity.x.com/t/280793, unanswered) [S]. Consequences: build the re-authorization route and the owner alert in the first version, not later; refresh as rarely as possible (only when a post is due); give the token `fetch` a generous timeout and never fire a second refresh while one is in flight.

### 3.5 Headless bootstrap / recovery via token exchange (available until 2027-01-31)

If the developer app is owned by @bluelytics, the Console can generate an OAuth 1.0a "Access Token & Secret" for that same account ("Make requests on behalf of your own account") [V getting-access.md]. That pair can be exchanged for an OAuth 2.0 pair with no browser consent and no callback:

```bash
curl -sS -X POST https://api.x.com/2/oauth2/token \
  -u "$X_CLIENT_ID:$X_CLIENT_SECRET" -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange' \
  --data-urlencode "subject_token=$X_OAUTH1_ACCESS_TOKEN" \
  --data-urlencode 'subject_token_type=urn:x:params:oauth:token-type:oauth1_token' \
  --data-urlencode "oauth_token_secret=$X_OAUTH1_ACCESS_SECRET"
```

[V] token-exchange page: an app with OAuth 1.0a permission "Read and write" yields scopes including `tweet.read users.read tweet.write media.write` plus `offline.access` always; the OAuth 1.0a token stays valid; re-exchanging returns a new pair and invalidates the previous one; limit 10,000 requests / 15 min per app per IP; `400 invalid_grant` means the token was revoked or belongs to another app. OAuth 2.0 must be enabled on the same app. After 2027-01-31 "the token exchange is no longer available".

### 3.6 OAuth 1.0a signing with WebCrypto (legacy; only until 2027-01-31)

Algorithm [V]: https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature.md , .../authorizing-a-request.md , .../percent-encoding-parameters.md , RFC 5849 section 3.4.1.3.1 (https://www.rfc-editor.org/rfc/rfc5849.txt).

1. OAuth params: `oauth_consumer_key`, `oauth_nonce` (random alphanumeric, unique per request), `oauth_signature_method=HMAC-SHA1`, `oauth_timestamp` (epoch seconds), `oauth_token`, `oauth_version=1.0`.
2. Parameters that enter the signature:
   - always: the six `oauth_*` params and every **URL query-string** parameter;
   - body parameters **only if** the body is single-part `application/x-www-form-urlencoded`;
   - **JSON body (`POST /2/tweets`, `/2/media/metadata`, `/2/media/upload/initialize`): the body is NOT signed** — sign only `oauth_*` (+ query);
   - **`multipart/form-data` (`/2/media/upload`, `/append`): no form field, not `media`, not `media_category`, is signed** — sign only `oauth_*` (+ query).
3. Percent-encode (RFC 3986: keep only `A-Z a-z 0-9 - . _ ~`, uppercase hex, UTF-8 bytes) each key and value; sort by encoded key (then value); join `k=v` with `&` -> parameter string.
4. Base string = `METHOD` + `&` + pct(base URL without query/fragment, `https://api.x.com/...`) + `&` + pct(parameter string). Exactly two unencoded `&`.
5. Signing key = pct(consumer secret) + `&` + pct(token secret).
6. `oauth_signature` = base64(HMAC-SHA1(key, base string)).
7. Header: `Authorization: OAuth k="v", ...` with each key and value percent-encoded (seven pairs).

```js
// Verified 2026-11-22 against the docs.x.com test vector:
// POST https://api.x.com/1.1/statuses/update.json?include_entities=true -> "Ls93hJiZbQ3akF3HF3x1Bz8/zU4="
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export async function oauth1Header({ method, url, formParams = {}, consumerKey, consumerSecret, token, tokenSecret }) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0",
  };
  // formParams: pass ONLY x-www-form-urlencoded body fields. Leave {} for JSON and multipart bodies.
  const params = [...Object.entries(oauth), ...u.searchParams.entries(), ...Object.entries(formParams)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.protocol}//${u.host}${u.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${pct(consumerSecret)}&${pct(tokenSecret)}`),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base)));
  const all = { ...oauth, oauth_signature: btoa(String.fromCharCode(...sig)) };
  return "OAuth " + Object.keys(all).sort().map((k) => `${pct(k)}="${pct(all[k])}"`).join(", ");
}
```

### 3.7 Worker-ready OAuth 2.0 client (fetch only)

Request shapes checked under Node 24 against a mocked fetch on 2026-11-22 (not run against the live API: no credentials).

```ts
const API = "https://api.x.com";
type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope?: string };
type Store = { get(): Promise<Tokens | null>; put(t: Tokens): Promise<void> };

export async function getAccessToken(env: { X_CLIENT_ID: string; X_CLIENT_SECRET: string }, store: Store): Promise<string> {
  const t = await store.get();
  if (!t) throw new Error("x: no tokens stored - run bootstrap");
  if (t.expires_at - Date.now() > 5 * 60_000) return t.access_token;
  const res = await fetch(`${API}/2/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`x: refresh ${res.status} ${j.error ?? ""}`), { status: res.status, body: j });
  const next = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000, scope: j.scope };
  await store.put(next); // persist BEFORE using it: the old refresh token is already dead
  return next.access_token;
}

async function xfetch(token: string, path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }   // a 403 from the edge may be plain text
  if (!res.ok) throw Object.assign(new Error(`x: ${init.method} ${path} -> ${res.status} ${body.title ?? ""} ${body.detail ?? ""}`),
    { status: res.status, body, rateLimitReset: Number(res.headers.get("x-rate-limit-reset") ?? 0) });
  return body;
}

export async function uploadImage(token: string, bytes: ArrayBuffer | Uint8Array, mime: "image/png" | "image/jpeg"): Promise<string> {
  const form = new FormData();
  form.append("media_category", "tweet_image");
  form.append("media", new Blob([bytes], { type: mime }), mime === "image/png" ? "post.png" : "post.jpg");
  const j = await xfetch(token, "/2/media/upload", { method: "POST", body: form }); // do not set Content-Type manually
  return j.data.id; // keep as string
}

export const setAltText = (token: string, mediaId: string, text: string) =>
  xfetch(token, "/2/media/metadata", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: text.slice(0, 1000) } } }) });

export async function createPost(token: string, text: string, mediaIds: string[]): Promise<{ id: string; text: string }> {
  const j = await xfetch(token, "/2/tweets", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: mediaIds } }) });
  return j.data;
}
```

The official TypeScript SDK `@xdevplatform/xdk` exists (0.7.0, published 2026-11-20, `engines.node >= 16.14`, npm registry) but is unnecessary here; with bearer auth the three calls above are the whole integration.

### 3.8 Not applicable: "bot accounts" API

`POST /2/bots` creates a brand-new programmatic account with an `xcbot_...` bearer token and an "Automated by @owner" label, but its token scopes are limited to `dm.read, dm.write, tweet.read, users.read, media.write` (no `tweet.write`) and it cannot act as the existing @bluelytics account [V https://docs.x.com/xchat/bots.md]. It is for X Chat bots.

---

## 4. Rate limits, headers, errors

### 4.1 Rate limits

Pay-per-use has a single self-serve limit table (no per-tier tables any more). [V] https://docs.x.com/x-api/fundamentals/rate-limits.md (fetched 2026-11-22)

| Endpoint | Per app | Per user |
| :- | :- | :- |
| `POST /2/tweets` | 10,000 / 24 h | **100 / 15 min** |
| `DELETE /2/tweets/:id` | - | 50 / 15 min |
| `POST /2/media/upload` | 50,000 / 24 h | 500 / 15 min |
| `GET /2/media/upload` (status) | 100,000 / 24 h | 1,000 / 15 min |
| `POST /2/media/upload/initialize`, `/:id/append`, `/:id/finalize` | 180,000 / 24 h | 1,875 / 15 min |
| `POST /2/media/metadata` | 50,000 / 24 h | 500 / 15 min |
| `GET /2/users/me` | - | 75 / 15 min |
| OAuth 1.0a -> 2.0 token exchange | 10,000 / 15 min per app per IP | |

Conflict inside the docs: the older manage-posts integration guide still states "200 requests per 15 minutes" plus "300 requests per 3 hours" for posting (https://docs.x.com/x-api/posts/manage-tweets/integrate.md). Our peak (15 posts/day) is far below either figure. Account-level daily posting limits of the X product itself are much lower than the API rate limits and are the binding constraint [V-help, https://help.x.com/en/rules-and-policies/x-limits, `dateModified` 2026-09-28]: "Posts: 50 original posts and 200 replies per day for unverified accounts. The daily update limit is further broken down into smaller limits for semi-hourly intervals." "These limits include actions from all devices, including web, mobile, phone, API, etc." (The same page still carries an older sentence about "2,400 updates per day"; treat 50/day as the limit unless @bluelytics is verified/Premium.) Hitting it is one cause of `403 "You are not permitted to perform this action."` (X Staff 2026-07-22, https://devcommunity.x.com/t/270946). Cap the bot at well under 50 posts/day and never burst several posts inside the same half hour.

Headers [V]: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (epoch seconds). "Rate limits and billing are separate."

### 4.2 Error handling matrix

Error bodies are `application/problem+json` (`title`, `detail`, `type`, `status`); observed live for 401 on 2026-11-22: `{"title":"Unauthorized","type":"about:blank","status":401,"detail":"Unauthorized"}`.

| HTTP | Meaning | Status | Action |
| :- | :- | :- | :- |
| 400 | Invalid JSON / unknown field (schemas are `additionalProperties: false`) / more than 1 cashtag | [V] docs | Fix the request; do not retry |
| 401 | Access token expired/revoked, bad signature | [V] | Force one refresh, retry once; then alert |
| 402 | Credits exhausted. Current body (developer paste of 2026-09, status and name confirmed by X Staff as "HTTP 402 credits-depleted"): `{"detail":"credits depleted","status":402,"title":"Payment Required","type":"https://api.x.com/2/problems/credits-depleted"}`. An older shape from January 2026 had `"CreditsDepleted"` and "Your enrolled account [...] does not have any credits to fulfill this request." Match on **status 402**, not on the text. | [V-forum] https://devcommunity.x.com/t/276550 ; older shape [S] https://devcommunity.x.com/t/255640 ; **not in the docs error table or in the OpenAPI Problem list** | Alert owner, stop posting until topped up; no retry |
| 403 `about:blank`, detail "Your account is not permitted to access this feature." | Account- or app-level restriction (spam filter), not a scope problem; `x-access-level: read-write` is still returned. Seen on plain image posts from an OAuth 2.0 bot in 2026-10 and cleared after staff review | [V-forum] https://devcommunity.x.com/t/278262 (X Staff 2026-10-15) | Stop posting, alert owner, retry slowly (hours); do not switch accounts |
| 403 `about:blank`, detail "You are not permitted to perform this action." | X Staff: "trying to create a post after hitting the platform limits, or trying to reply to a conversation/user in which you do not have permission" | [V-forum] https://devcommunity.x.com/t/270946 (2026-07-22) | Skip; check the 50 posts/day account limit (4.1) |
| 403 duplicate | detail like "You are not allowed to create a Tweet with duplicate content." X also rejects near-identical text; window undocumented | [S] third-party | Treat as "already posted"; never retry with cosmetic changes |
| 403 `.../client-forbidden`, `client-not-enrolled` | App not in the Pay-per-use package / Production environment | [V] xurl README | Fix in Console (section 7) |
| 403 `.../not-authorized-for-resource`, detail `client IP not allowed: <ip>` | Account IP allowlist active | [V] response-codes page | Keep the IP allowlist empty: Workers have no fixed egress IPs |
| 403 plain-text body `IPv6` (non-JSON) | X's edge rejecting Cloudflare Workers egress | [S] July 2025 incident, fixed 2025-07-04; one recurrence report 2025-08-19; no 2026 report found | See section 8 |
| 500 HTML error page on `POST /oauth/access_token` (OAuth 1.0a 3-legged only) | Happens only from Workers egress; open since 2026-09 | [V-forum] https://devcommunity.x.com/t/276108 | Not on our path (we use `/2/oauth2/token`); never run a 3-legged OAuth 1.0a flow from the Worker |
| 403 "not allowed to post a video longer than N minutes" | video only | [V] | n/a |
| 429 | Rate limit (`code 88` / `.../rate-limit-exceeded`) or usage cap (`.../usage-capped`); spending limit reached may also block | [V] | Skip this tick; resume after `x-rate-limit-reset` |
| 5xx | Transient | [V] | Retry on the next cron tick with backoff |
| Token endpoint 400 | `invalid_request` / `invalid_grant` = refresh token already used, expired, or grant replaced | [V]/[S] | Recovery path 3.4 / 3.5 |

Idempotency: record each post attempt in D1 (`rendered -> uploaded(media_id) -> posted(post_id)`). The upload response carries `expires_after_secs` (86400 in the docs example), so a retry within that window can reuse the `media_id` instead of paying for another upload. If `POST /2/tweets` times out, a blind retry may hit the duplicate 403; treat that as success.

---

## 5. Automation policy

[V] https://docs.x.com/developer-guidelines.md (fetched 2026-11-22). The full Automation Rules page (https://help.x.com/en/rules-and-policies/x-automation, headed "Updated April 2026", `dateModified` 2026-09-28) was fetched and read by the verifier on 2026-11-22 [V-help]. It says: "You may post automated posts based on sources of outside information — such as an RSS feed, weather data, etc. — as long as you are sufficiently authorized to publish such information" and "you may post automated posts for entertainment, informational, or novelty purposes"; violations can lead to "filtering your posts from search results or suspending your account". Correction: that page does **not** mention the "Automated" label or a human-run managing account; those two requirements come only from docs.x.com/developer-guidelines (below).

- Explicitly allowed scenarios: "Automated account posts scheduled content (news, weather, quotes)" and "**App posts stock/crypto prices on schedule** — Informational, no manipulation". Bluelytics' use case is squarely permitted.
- "Requirements for automated accounts": (1) enable the 'Automated' profile label; (2) disclose in the bio that it is a bot and who operates it; (3) link to a human-managed account; (4) honor opt-out requests; (5) use only the official API ("Non-API automation (scraping, browser automation) results in permanent suspension"); (6) stay within rate limits.
- Label setup [V] https://docs.x.com/fundamentals/developer-apps.md: on the bot account, Settings -> Your account -> Automation -> link the managing account. Requires a second, human-run X account.
- Posting: "No unsolicited @mentions. No identical cross-posting." "Never post identical or substantially similar content across multiple accounts." Correction: the written rule also covers a single account. Automation Rules [V-help]: "You may not post duplicative or substantially similar posts on one account or over multiple accounts you operate", and "accounts posting duplicative, spammy, or otherwise prohibited content may be subject to suspension". Exact same-account duplicates are additionally stopped by the duplicate-content 403. A fixed template with changing numbers is the normal shape of a price bot and is explicitly allowed by the developer guidelines, but it is a reason to post on real moves rather than re-posting unchanged prices.
- Prohibited: posting to trending topics to gain visibility, bulk posting, misleading links, more than one developer app for the same use case.
- Practical: each post carries different numbers and a time, so texts differ naturally. Post on real changes (and open/close summaries) rather than a fixed cadence, cap posts per day, and skip a post when nothing moved since the last one.

---

## 6. Post format

- Formats and size [V] https://docs.x.com/x-api/media/quickstart/best-practices.md and media/introduction.md: `tweet_image` accepts **JPG, PNG, GIF, WEBP, max 5 MB**. Up to 4 photos per post. Limits follow the posting account, not the API plan.
- Aspect ratio [S]: X publishes no organic-post image spec that could be fetched. Third-party 2026 guides agree that a single image between about 2:1 and 3:4 is shown uncropped in the timeline, and that **16:9 at 1600x900 (or 1200x675)** is the standard landscape choice; 4:5 (1080x1350) fills more of a phone feed.
- Recommendation: render **1600x900 PNG** for X (a flat dark chart is typically 100-400 KB, far under 5 MB) and a separate 1080x1350 for Instagram from the same layout code. Keep key numbers inside a central safe area so a 4-image or quote-crop never hides them. PNG keeps text crisp; X re-encodes anyway.
- Alt text [V]: `POST /2/media/metadata`, `alt_text.text` up to 1000 chars, $0.005 per call (2.3). Write the actual values, not "chart".
- Text: at most 280 weighted characters (non-Premium) [V]. No URL / bare domain (cost), at most one cashtag, no @mentions, one or two stable hashtags at most.

---

## 7. Owner checklist (one-time, about 30 minutes)

1. Decide the owning account. Simplest: sign in to https://console.x.com **as @bluelytics** and create the developer account there (app owner = posting account; enables the headless bootstrap in 3.5). Accept the Developer Agreement, complete the profile.
2. Create one app (New App: name, description, use case, e.g. "Automated posting of Argentine exchange rates for bluelytics.com.ar"). Give it a real name and icon. One app per use case.
3. In Apps -> Manage apps, confirm the app is in the **Pay-per-use** package and the **Production** environment ("Move to package" if not), otherwise calls fail with `client-forbidden` / `client-not-enrolled`.
4. Keys & Tokens -> "User authentication settings" -> Set up:
   - App permissions: **Read and write**.
   - Type of app: **Web App, Automated App or Bot** (confidential client).
   - Callback URI / Redirect URL: `http://127.0.0.1:8080/callback` (bootstrap) and, if the admin route is built, `https://<worker-host>/admin/x/callback`. Exact match.
   - Website URL: `https://bluelytics.com.ar`.
5. Save immediately (shown once): **OAuth 2.0 Client ID and Client Secret**. Optionally also generate API Key/Secret and Access Token/Secret (OAuth 1.0a) after setting Read and write; they are only useful until 2027-01-31.
6. Billing: add a credit/debit card and buy a small amount of credits (e.g. $5-10; this triggers the $20 free credit where the incentive is enabled). Optionally enable auto-recharge (first recharge matched up to $50). Set a **spending limit** (e.g. $15 per cycle). Leave the **IP allowlist empty**.
7. Obtain the OAuth 2.0 token pair, logged in to x.com as @bluelytics. Option A, manual PKCE (least privilege):
   ```bash
   VERIFIER=$(openssl rand -base64 96 | tr -d '=+/\n' | cut -c1-64)
   CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
   STATE=$(openssl rand -hex 16)
   echo "https://x.com/i/oauth2/authorize?response_type=code&client_id=$X_CLIENT_ID&redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=tweet.read%20tweet.write%20users.read%20media.write%20offline.access&state=$STATE&code_challenge=$CHALLENGE&code_challenge_method=S256"
   ```
   Open the URL, approve, copy `code` from the address bar of the (failing) redirect page, check `state`, and within 30 seconds run the `authorization_code` curl from 3.3 with `REDIRECT_URI=http://127.0.0.1:8080/callback`.
   Option B: official CLI `npm i -g @xdevplatform/xurl` (1.3.4), `xurl auth apps add bluelytics --client-id ... --client-secret ...`, `xurl auth oauth2 --app bluelytics --headless`; tokens land in `~/.xurl/auth.yml`. It requests a broad scope set and must not be used again afterwards (it would rotate the refresh token).
   Option C (until 2027-01-31): token exchange from the Console-generated OAuth 1.0a pair (3.5).
8. Store: `wrangler secret put X_CLIENT_ID`, `X_CLIENT_SECRET`; insert `access_token`, `refresh_token`, `expires_at` into the D1 `x_oauth` row (or through Pulumi-managed secrets plus a one-off seed command). Do not keep copies elsewhere.
9. Smoke test from the deployed Worker (section 8), then one real test post; compare `GET /2/usage/credits` before/after to learn the true per-post cost.
10. Compliance: on @bluelytics, Settings -> Your account -> Automation -> link a human-run managing account (label "Automated"); add to the bio that it is an automated account and who runs it.
11. Optional, low odds: publish a Developer Exhibit listing and request **Public Utility** credits. X Staff reserve that path for "government / critical public-safety alerts" and refused a results-informational bot in 2026-09 (1.1).

---

## 8. Cloudflare-specific risk and fallback

- `api.x.com` is fronted by Cloudflare (`server: cloudflare envoy`, `origin-cf-ray` response headers, observed 2026-11-22) [V].
- From 2025-07-03 developers reported that every request from Cloudflare Workers to `api.x.com` (including `POST /2/oauth2/token` and `POST /2/tweets`) returned `403` with the plain-text body `IPv6`, while the same request worked elsewhere. Thread https://devcommunity.x.com/t/245157 read in full by the verifier on 2026-11-22 [S, developer posts]: on 2025-07-04 14:57 UTC a developer reported it fixed, and at 15:08 UTC a user stating "I work there" (Cloudflare) wrote "This issue should be fixed! It was escalated internally at Cloudflare and we got in touch with X to fix the issue on their end." Later posts: "same issue" (2025-07-08) and "This Cloudflare error is happening pretty frequently for us recently again" (2025-08-19), with no follow-up. So the incident had a confirmed fix after roughly 36 hours, and one unanswered recurrence report.
- 2026 evidence that Workers can reach the endpoints we need [S, developer reports in the official forum]: a reply bot running "Plain HTTPS requests from a Cloudflare Worker, OAuth 2.0 user context (PKCE)" posting and reading in October 2026 (https://devcommunity.x.com/t/278019); a Worker getting `GET /2/users/me` 200 and a `POST /2/tweets` 400 validation error in August 2026 (https://devcommunity.x.com/t/273937); a Worker-hosted account posting 3 or 4 times a day in October 2026 (https://devcommunity.x.com/t/279798). Where Worker-based bots fail in these threads (for example https://devcommunity.x.com/t/270946), the response is a JSON error from X's application tier, not an edge block.
- A Workers-specific failure IS open in 2026 [V-forum]: `POST https://api.x.com/oauth/access_token` (step 3 of the OAuth 1.0a 3-legged flow) returns HTTP 500 only when sent from a Worker; the identical signed request returns 200 from a normal machine. X Staff 2026-09-19: "You've isolated it to the Cloudflare Worker egress path"; 2026-10-07: "still open on our side" (https://devcommunity.x.com/t/276108). A second report on 2026-10-27 was auto-closed without a fix (https://devcommunity.x.com/t/279382). `oauth/request_token` works from Workers. This design never calls `oauth/access_token` (OAuth 2.0 only; the token exchange in 3.5 uses `/2/oauth2/token`), but do the one-time authorization from a laptop, not from the Worker, if anything OAuth 1.0a is ever needed.
- Not verified by anyone here: a live call from a deployed Worker in November 2026 [U]. The smoke test below is still mandatory, and it should cover `POST /2/oauth2/token` (refresh) as well as an API call.
- Day-one smoke test: a Worker with a `scheduled` handler that calls `GET https://api.x.com/2/users/me` with the bearer token and logs status + first 200 bytes of the body. Run it from the cron trigger, not only from `wrangler dev`, since egress differs.
- Design so the poster is one small module behind an interface (`postToX(text, png, alt)`). If Workers egress is blocked, run that module elsewhere without touching the rest: a scheduled GitHub Actions job or a tiny function on another provider that pulls "pending posts" from the Worker API (the image is already in R2). The token row must then live where the poster runs, with a single writer.

---

## 9. Could not be confirmed from a primary source

1. Media upload billing: resolved by the verifier, one `PostCreate` per media object per X Staff (1.3). Still open: whether X will keep it (a follow-up question of 2026-10-27 is unanswered) and the exact amount debited, which only a real test post can show.
2. The exact rule for "Post: Create (with URL)" for bare domains. Resolved: a link in `text` triggers it, media attached with `media.media_ids` does not (1.4).
3. Text of the 403 duplicate-content response (absent from the docs error reference). The 402 body is now known (4.2).
4. Whether Cloudflare Workers egress to `api.x.com` is accepted today for `/2/oauth2/token`, `/2/media/upload` and `/2/tweets`: 2026 developer reports say yes, but nobody here ran it (section 8).
5. Legacy Basic/Pro cut-over dates and the fate of legacy Free: resolved, see 1.1.
6. Whether the 2027-01-31 OAuth 1.0a retirement will slip again (it moved from 2027-01-01 on 2026-11-05).
7. Organic image aspect-ratio behaviour in the timeline (third-party consensus only).
8. Whether purchased credits expire. (Automation Rules text and account-level post limits: resolved, see 5 and 4.1.)
9. Whether a refresh token has any reuse grace window (assume none; X Staff says the old token is "immediately invalidated server-side", 3.4).
10. What the Public Utility program grants. Acceptance of Bluelytics is unlikely per X Staff (1.1).

## 10. Source index

| Source | Date / version |
| :- | :- |
| https://docs.x.com/x-api/getting-started/pricing.md | undated, fetched 2026-11-22 |
| https://console.x.com/api/credits/pricing | live JSON, fetched 2026-11-22 |
| https://docs.x.com/changelog.md | entries 2025-01-16 to 2026-11-19 |
| https://docs.x.com/openapi.json | X API v2 spec version 2.175 |
| https://docs.x.com/x-api/media/upload-media.md , /media/introduction.md , /media/quickstart/best-practices.md , /media/quickstart/media-upload-chunked.md , /media/create-media-metadata.md | fetched 2026-11-22 (limits documented 2026-09-01) |
| https://docs.x.com/x-api/posts/create-post.md , /posts/manage-tweets/integrate.md , /posts/manage-tweets/introduction.md | fetched 2026-11-22 |
| https://docs.x.com/x-api/fundamentals/rate-limits.md , /response-codes-and-errors.md , /post-cap.md | fetched 2026-11-22 |
| https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange.md | page rewritten 2026-10-28, date changed 2026-11-05 |
| https://github.com/xdevplatform/docs/pull/538 , /pull/515 , /pull/438 , /pull/520 | merged 2026-11-05, 2026-10-28, 2026-09-22; #520 open |
| https://raw.githubusercontent.com/xdevplatform/docs/main/sliders.js | last commit 2026-08-05 |
| https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md , /user-access-token.md ; /oauth-1-0a/creating-a-signature.md , /authorizing-a-request.md , /percent-encoding-parameters.md | fetched 2026-11-22 |
| https://docs.x.com/fundamentals/developer-apps.md , /fundamentals/ip-allowlist.md , /x-api/getting-started/getting-access.md , /free-credits.md | fetched 2026-11-22 (free credits rule updated 2026-10-13) |
| https://docs.x.com/developer-guidelines.md , https://docs.x.com/exhibit.md , https://docs.x.com/xchat/bots.md | fetched 2026-11-22 |
| https://github.com/xdevplatform/xurl (README) ; npm `@xdevplatform/xurl` 1.3.4 (2026-09-29) ; npm `@xdevplatform/xdk` 0.7.0 (2026-11-20) | fetched 2026-11-22 |
| https://www.rfc-editor.org/rfc/rfc5849.txt | RFC 5849, section 3.4.1.3.1 |
| devcommunity.x.com threads 241818, 245157, 255640, 263025, 256476, 273255, 274646, 279445 | first pass: search snippets only. Verifier 2026-11-22: all opened via `https://devcommunity.x.com/t/<id>.json` |
| devcommunity.x.com threads 266305, 276550, 281390, 280177, 274497, 264451, 263884, 271768, 280793, 276108, 279382, 278019, 278262, 270946, 271962, 265176 | opened by the verifier 2026-11-22 (Discourse JSON); dates of the quoted posts are given inline |
| https://help.x.com/en/rules-and-policies/x-automation , https://help.x.com/en/rules-and-policies/x-limits | fetched by the verifier 2026-11-22; `dateModified` 2026-09-28 (automation page headed "Updated April 2026") |
| https://github.com/xdevplatform/docs/pull/520 (open, not merged) | "PPU: document expansion billing", planned enable date 2026-11-22; read 2026-11-22 |

---

## Independent verification (2026-11-22)

Second pass by a separate verifier who tried to refute the decision-critical claims. Everything below was re-fetched on 2026-11-22, not taken from the text above. Method: raw `.md` pages and `openapi.json` (v2.175) from docs.x.com; the live rate card `https://console.x.com/api/credits/pricing`; GitHub API for `xdevplatform/docs` PRs; npm registry; RFC 5849; unauthenticated `curl` probes of `api.x.com`; the official forum through its Discourse JSON endpoints (`/t/<id>.json`, `/search.json`); help.x.com pages. Two code samples were executed under Node 24.22.3. Nothing was run against the live API with credentials and nothing was deployed to a Worker.

Reading forum evidence: `taycaldwell` carries the "X Staff" title and the `staff` flag. `twin` is in the same staff group but is titled "Automated by @taycaldwell", so it is an automated assistant; its statements are weaker than a human staff post. Posts by other users are developer reports.

### Confirmed

| # | Claim | Result | Source opened |
| :- | :- | :- | :- |
| 1 | OAuth 1.0a user auth retires 2027-01-31; signed requests fail afterwards; token exchange ends the same day | CONFIRMED. Stated three times on the migration page; PR #538 merged 2026-11-05 moved it from 2027-01-01. Stated on that one page only (no changelog entry, no forum announcement found) | https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange.md ; https://api.github.com/repos/xdevplatform/docs/pulls/538 |
| 2 | No free or subscription self-serve tier; `POST /2/tweets` $0.015, with URL $0.20 | CONFIRMED. Pricing page table; live JSON `PostCreate: 0.015`, `ContentCreateWithUrl: 0.2`; changelog "Apr 16, 2026"; X Staff posts deprecating Free, Basic and Pro | https://docs.x.com/x-api/getting-started/pricing.md ; https://console.x.com/api/credits/pricing ; https://devcommunity.x.com/t/276550 ; /t/266305 ; /t/273255 |
| 3 | One-shot `POST https://api.x.com/2/media/upload` with only `media` + `media_category=tweet_image`, 5 MB, OAuth 2.0 `media.write` | CONFIRMED against the spec: `MediaUploadRequest` has `required: [media, media_category]`, `additionalProperties: false`, no `media_type`; security `OAuth2UserToken[media.write]` or `UserToken`; description says "JPG, PNG, GIF or WEBP, up to 5 MB". Unauthenticated probe returns 401 `application/problem+json`. A production flow matching it returned 201 on 2026-10-15 (developer report) | https://docs.x.com/openapi.json ; https://docs.x.com/x-api/media/introduction.md ; https://devcommunity.x.com/t/278262 |
| 4 | `POST /2/tweets` with `{text, media:{media_ids:[id]}}`, scopes `tweet.read tweet.write users.read`, returns 201 | CONFIRMED. Spec security `OAuth2UserToken: [users.read, tweet.write, tweet.read]`, only response code `201`, `media_ids` items are strings matching `^[0-9]{1,19}$`, 1 to 20 items | https://docs.x.com/openapi.json ; https://docs.x.com/fundamentals/authentication/guides/v2-authentication-mapping.md |
| 5 | Access token 2 h; refresh token single-use, rotates, about 6 months; one live grant per user per app | CONFIRMED verbatim on the migration page ("Access token: 2 hours. Refresh token: about 6 months, single-use"; "X keeps one live OAuth 2.0 grant per user per App"). X Staff 2026-07-27 adds that the old refresh token is "immediately invalidated server-side" | same migration page ; https://devcommunity.x.com/t/271768 |
| 6 | Media upload billed as an extra `PostCreate` per media object, image post about $0.030; rate card silent | CONFIRMED and upgraded from second-hand to a direct X Staff statement (2026-08-31). The pricing page fetched today still has no media-upload line. A follow-up of 2026-10-27 asking whether this is stable is unanswered | https://devcommunity.x.com/t/274646 ; /t/279445 ; pricing.md |
| 7 | Alt text via `POST /2/media/metadata` `{id, metadata:{alt_text:{text}}}`, max 1000, $0.005 | CONFIRMED. `CreateMediaMetadataMetadataAltText.text.maxLength = 1000`; scope `media.write`; pricing "Media Metadata $0.005 per request"; live JSON `MediaMetadata: 0.005` | openapi.json ; pricing.md ; live rate card |
| 9 | OAuth 1.0a: JSON and multipart bodies are not in the signature base string | CONFIRMED by RFC 5849 section 3.4.1.3.1 (entity-body only if single-part and `application/x-www-form-urlencoded`). The section 3.6 function was executed and reproduces the docs.x.com vector `Ls93hJiZbQ3akF3HF3x1Bz8/zU4=` | https://www.rfc-editor.org/rfc/rfc5849.txt ; https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature.md |
| 10 | Scheduled price posting from one labelled account is permitted | CONFIRMED. Guidelines table row "App posts stock/crypto prices on schedule" carries the checkmark icon in the rendered HTML (the `.md` export drops the icons); Automation Rules allow automated posts "for entertainment, informational, or novelty purposes" | https://docs.x.com/developer-guidelines ; https://help.x.com/en/rules-and-policies/x-automation |

Also confirmed (extra statements checked): rate limits `POST /2/tweets` 10,000/24 h per app and 100/15 min per user, `POST /2/media/upload` 50,000/24 h and 500/15 min, `POST /2/media/metadata` 50,000/24 h and 500/15 min (rate-limits.md); `GET /2/usage/credits` exists with `total_balance`, `prepaid_balance`, `free_balance`, `free_grants` (openapi.json); free credits $20 after first purchase (rule changed 2026-10-13) and auto-recharge match up to $50, expiring after 3 months (free-credits.md); authorization code valid 30 seconds, callback rules (max 10, exact match, `http://127.0.0.1` not `localhost`), confidential app types (authorization-code.md, developer-apps.md); chunked limits 5 MB recommended / 8 MB max / 4 MB for JSON, `total_bytes` max 17179869184, `command=STATUS` only on the GET (openapi.json, media-upload-chunked.md); max 1 cashtag, summoned-reply rule, `quote_tweet_id` Enterprise-only (integrate.md, create-post.md); `/2/bots` token scopes without `tweet.write` (xchat/bots.md); `@xdevplatform/xdk` 0.7.0 published 2026-11-20 and `@xdevplatform/xurl` 1.3.4 published 2026-09-29 with the `auth apps add` / `auth oauth2 --headless` syntax (npm registry, xurl README); probes: `api.x.com` answers with `server: cloudflare envoy`, 401 problem+json, token endpoint `400 invalid_client`, v1.1 upload hosts `400 code 215`; the section 3.7 client run against a mocked `fetch` sends exactly the documented request shapes; the PKCE shell snippet in section 7 yields a valid 64-char verifier and 43-char S256 challenge.

### Corrected (the text above was edited in place)

| Where | Was | Now | Source |
| :- | :- | :- | :- |
| Claim 8, sections 0.5, 4.2, 8 | 2025 `403 IPv6` reports "have no confirmed resolution" | Fixed on 2025-07-04 after about 36 hours (developers plus a self-identified Cloudflare employee in the thread); one unanswered recurrence report 2025-08-19; no 2026 `IPv6` report found. New: a different Workers-only failure is open in 2026, HTTP 500 on OAuth 1.0a `POST /oauth/access_token`, acknowledged by X Staff, unresolved on 2026-10-27. Not on this design's path | https://devcommunity.x.com/t/245157 ; /t/276108 ; /t/279382 |
| Sections 0.3, 1.3, 1.5 | $0.015 to $0.035 per image post, upload billing "conflicting, treat as open"; one-shot chosen so a per-request rule "cannot triple the charge" | $0.030 without and $0.035 with alt text. Accounting is per media object, so chunked costs the same; "Chunked appends and status polls are not billed as Post: Create" | https://devcommunity.x.com/t/274646 |
| Section 1.2 billing mechanics | "Do failed requests count? No." quoted without caveat | X Staff: "Failed retries can still record usage". Reuse the `media_id`, never re-upload on retry. Spend-cap enforcement was also reported unreliable in July 2026 | https://devcommunity.x.com/t/274646 ; /t/271962 |
| Section 1.1 Public Utility | Bluelytics "is a plausible candidate" | Unlikely. X Staff 2026-09-23 refused a results bot: the path "is reserved for government / critical public-safety alerts, case-by-case" | https://devcommunity.x.com/t/276550 |
| Section 1.1 legacy Free | "[U] ... assume no" | No, per X Staff: apps on Free were moved to pay-per-use and get 402 without credits | https://devcommunity.x.com/t/276550 ; /t/281390 |
| Section 4.2, 402 row | body `title: "CreditsDepleted"`, detail "Your enrolled account [...]" | Current body `{"detail":"credits depleted","status":402,"title":"Payment Required","type":"https://api.x.com/2/problems/credits-depleted"}`; the quoted shape is from January 2026. Match on status 402 | https://devcommunity.x.com/t/276550 ; /t/255640 |
| Section 4.1 account limits | "historically 2,400 posts/day ... not re-verified" | 50 original posts and 200 replies per day for unverified accounts, with semi-hourly sub-limits, counted across web, apps and API | https://help.x.com/en/rules-and-policies/x-limits (modified 2026-09-28) |
| Section 5 | Automation Rules "could not be fetched"; snippets said they require the label and a human-run account; duplicates only a cross-account rule | Page read. It does not mention the label or a managing account (those come from docs.x.com/developer-guidelines). It does forbid "duplicative or substantially similar posts on one account" | https://help.x.com/en/rules-and-policies/x-automation |
| Sections 1.1, 1.4, 2.5 | Basic/Pro cut-over, with-URL rule for media, v1.1 media sunset tagged [S] or [U] | All three are in X Staff posts: Basic 2026-05-21 / after 2026-06-01, Pro 2026-08-14 / after 2026-09-01; a link in `text` triggers the $0.20 rate while `media.media_ids` does not; v1.1 media upload sunset 2025-06-09 | https://devcommunity.x.com/t/266305 ; /t/273255 ; /t/264451 ; /t/241818 |
| Section 4.2, new rows | (absent) | 403 "Your account is not permitted to access this feature." = account/app restriction, seen on image posts and cleared by staff; 403 "You are not permitted to perform this action." = platform limits or reply permission | https://devcommunity.x.com/t/278262 ; /t/270946 |
| Section 3.4, new bullet | Refresh failure treated as an edge case | A refresh that succeeds server-side but is lost client-side kills the grant; after 2027-01-31 the only recovery is a browser re-authorization. Reports of refresh tokens issued during X degradation being rejected 2 h later (unanswered) | https://devcommunity.x.com/t/271768 ; /t/280793 |

### Still uncertain

1. Whether a deployed Cloudflare Worker can reach `/2/oauth2/token`, `/2/media/upload` and `/2/tweets` today. Developer reports from 2026-08 to 2026-10 show Workers reaching X's application tier and posting (threads 273937, 278019, 279798), and the open Workers-only bug concerns a different endpoint, but no one here ran a live call. Only the smoke test in section 8 settles it.
2. The amount actually debited for one image post. $0.030 follows from the staff statement and the rate card; the live JSON still lists a legacy `ContentCreate: 0.01` bucket, and X has not answered whether per-media `PostCreate` is permanent. Measure with `GET /2/usage/credits` around one test post.
3. Whether a bare domain without scheme (for example `bluelytics.com.ar`) in `text` triggers the $0.20 rate. Staff only say "a URL as part of the text". Keep domains out of the text.
4. Whether the 2027-01-31 date holds. It moved once and is published on a single docs page. Does not change the OAuth 2.0 decision.
5. Reliability of refresh-token rotation during X outages (item above), and whether any grace window exists. Assume none.
6. Whether the one-shot `POST /2/media/upload` will be kept long term; the media introduction page calls it "the older simple upload". The chunked calls in 2.2 are the fallback and cost the same.
7. Whether the Console spending limit is enforced reliably (one unanswered developer report says it was not, July 2026), and whether purchased credits expire.
8. Whether the free-credit incentives are enabled for a given new account ("currently rolling out").
9. Text of the duplicate-content 403, and timeline image cropping rules (third-party only).
