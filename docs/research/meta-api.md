# Meta publishing research: Instagram feed + Stories, Facebook Page, Threads

Research date: **2026-11-22**. Graph API version in force: **v27.0** (released 2026-11-04). Threads API version: **v1.0**.
Target: unattended cron job (Cloudflare Worker) posting one generated image + caption a few times per weekday to Instagram `@bluelytics_dolar`, optionally the Facebook Page "bluelytics" and Threads.

Legend used on every claim:

- **[V]** verified against a Meta primary source fetched on 2026-11-22 (source key in brackets, URLs in section 13).
- **[V*]** primary source, but read through a summarising fetch tool (the page was not available as raw markdown); wording may not be verbatim.
- **[U]** unverified / inferred / third-party only. Must be smoke-tested before relying on it.
- **[C]** Meta's own pages contradict each other; both statements are quoted in section 11.

Meta doc pages carry **no publication date**. Where a date exists (changelogs) it is given. Everything else is "as published on 2026-11-22".

---

## 0. Bottom line

1. **Use `graph.facebook.com/v27.0` with a non-expiring system-user token.** One token publishes Instagram feed posts and Stories and yields the Page token for the Facebook photo post. No refresh job is needed for it. Only Threads needs a 60-day token with an automated refresh. *(Verifier note 2026-11-22: non-expiry and the scope list are confirmed from primary sources; that the Instagram publishing endpoints accept a **Business Settings** system-user token is still [U] and must be smoke-tested first. The documented system-user token type for publishing is the Unified Login / Facebook Login for Business "Business Integration System User" token [IG-CP]. See 5.2 and the verification section at the end.)*
2. **No App Review and no Business Verification are needed** when the app only serves the owner's own account: Standard Access is sufficient for people with a role on the app [V][IG-REVIEW][DEV-LEVELS]. Two Meta pages say otherwise [C]; see 11.2.
3. **Instagram accepts JPEG only**, aspect ratio 4:5 to 1.91:1 for feed, 8 MB max, fetched by Meta from a public URL [V][IG-MEDIA]. Generate **1080x1350 JPEG** for feed and **1080x1920 JPEG** for Stories. 3:4 is not accepted by the API as documented.
4. The account must be a **Business** account (not Creator) to publish Stories [V][FBL-IDX].
5. Publishing is 2 calls + a status poll per post: `POST /{ig-id}/media` -> `GET /{container-id}?fields=status_code` -> `POST /{ig-id}/media_publish`.
6. Volume is a non-issue: 50 or 100 posts per 24 h depending on which Meta page you read [C]; the job needs about 3 to 8 per day. Read the real quota from `content_publishing_limit`.
7. The single largest uncertainty is **which token-issuing route the App Dashboard will actually offer a brand-new app** (three setups exist, one is new and one is reportedly closed to new apps). Section 5 gives an ordered list of routes that all end in the same code path, plus a fallback that needs a refresh cron. The implementation must therefore treat host and token as configuration, and must ship the token health check regardless.
8. Cost: Meta charges nothing for these APIs. There is no pricing page for the Instagram, Pages or Threads APIs [U: absence of a price, not a statement of one].

---

## 1. API flavours (Q1)

### 1.1 The three Instagram API setups

Meta's overview states "There are three Instagram API setups" [V][IG-OV].

| | Unified Login (new) | Instagram Login | Facebook Login |
|---|---|---|---|
| Host | `graph.facebook.com` | `graph.instagram.com` | `graph.facebook.com` |
| Token type | Business Integration System User token ("System-user access token (SUAT)" in the dashboard) | Instagram User access token | Facebook User access token (and Page token) |
| Publish permissions | `instagram_basic`, `instagram_content_publish` | `instagram_business_basic`, `instagram_business_content_publish` | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (+ `pages_show_list`; `ads_management` or `ads_read` if the Page role was granted through Business Manager) |
| Facebook Page link required | No | No | Yes, IG account must be connected to a Page |
| Business portfolio required | Yes | No | No (yes for system users) |
| Token lifetime | Chosen in the configuration; "Defaults to **never expire**" [V][FL4B] | 60 days, refreshable [V][IGL-REFRESH] | User: about 60 days. Page: no expiry [V][FB-LL] |
| IDs | `GET /me/assigned_instagram_accounts`; `/me` is the system user | `GET /me?fields=user_id,username` | `GET /{page-id}?fields=instagram_business_account` |
| Status | "recommended for new integrations... New Instagram API features are released only for this setup" [V][UL-IDX] | Keeps working, "There is no end date yet" [V][IGL-MIG] | Supported |

Sources: [IG-OV], [IG-USER] (requirements table lists all three), [UL-AUTH], [UL-PERM], [IGL-IDX], [FBL-IDX].

Rules that constrain the choice:

- "You can only add one setup per app. If you want to implement both setups, create an app for each setup." [V][DEV-IGUC]. App Review page: "Your app can either use Facebook Login or Instagram Login but not both." [V][IG-REVIEW]
- "**New apps.** Newly created apps can't set up the Instagram API with Instagram Login." [V][IGL-MIG]. Two other pages still describe the Instagram Login setup as automatically added to new apps [C], see 11.4.
- The Unified Login tab "only appears for apps owned by a business portfolio" and "for apps that use [Facebook Login for Business]" [V][UL-START].
- Content publishing "is available to all Instagram Professional accounts, except Stories, which are only available to business accounts" [V][FBL-IDX]. This sentence is on the Facebook Login page; no page states that the other setups lift it, so treat it as universal [U].
- Instagram Login "cannot access ads or tagging" [V][IGL-IDX]; irrelevant here.
- Token type for the Facebook Login setup is stated inconsistently by Meta: the Content Publishing guide's requirements table says "**Facebook Page access token**" [V][IG-CP], while the endpoint references (`/media`, `/media_publish`, IG Container, IG User) say "User" / "Facebook User access token" [V][IG-MEDIA][IG-PUB][IG-CONT][IG-USER]. No Instagram page names a Business Settings system-user token for this setup. Practical consequence: keep the token used for Instagram calls configurable, and if the system-user token is rejected on `/media`, retry with the Page token derived from it (section 6) before abandoning Route A. *(Added by verifier 2026-11-22.)*
- Unified Login launch date is **not** in the Instagram changelog (newest entry 2026-07-30) [V][IG-CHLOG]; it is newer than my ability to date it [U].

### 1.2 Simplest for a single owner-operated account

Recommendation: **`graph.facebook.com` + system-user token** (the Unified Login / Facebook Login family). Reasons:

- Same host, same permission names and same token work for Instagram publishing and for the Facebook Page post.
- The token can be non-expiring, which removes the refresh job for Instagram and Facebook.
- It is the setup Meta says receives new features.
- Instagram Login would need a second app for the Page, cannot post to the Page at all, always expires in 60 days, and is reportedly closed to new apps.

### 1.3 App Review / Business Verification for an own-account app

- "If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs." [V][IG-OV, section "Access levels"; the original draft attributed this sentence to IG-REVIEW, corrected 2026-11-22] and the table row "My app is only for a business I own or manage | ... | Standard Access | Not required" [V][IG-REVIEW].
- "If your app will only be used by people who have a role on the app itself you do not need to complete any of these processes [App Review, Business Verification, Go live] because your app is already available to these users." [V][DEV-REL]
- "If your app serves only your Instagram professional accounts, or accounts you manage, you do not need to implement a login flow." [V][IG-OV]
- "All Business, Consumer, and Gaming apps are automatically approved for Standard Access for all permissions and features." and "Permissions with Standard Access can only be requested from app users who have a role on the requesting app." [V][DEV-LEVELS]
- "If your app will only be used by app users who have a role on the app itself you do not need to complete verification" [V][DEV-BV].
- Advanced Access requires App Review **and** Business Verification [V][DEV-LEVELS]. Not needed here.
- Unified Login: "When you save your configuration, your app gets Standard Access to its permissions. Standard Access is enough to test with people who have a role on your app." [V][UL-START][IGL-MIG]

Consequence: the Instagram account must be attached to the app as an **Instagram Tester** (Unified Login / Instagram Login) or the acting Facebook user / system user must have a role on the app (Facebook Login). The Threads profile must be a **Threads Tester**.

### 1.4 Deprecations and changes 2024 to 2026

From the Instagram Platform changelog [V][IG-CHLOG] and Graph API changelogs [V][GAPI-CHLOG][GAPI-26][GAPI-27]:

| Date | Change | Impact on this job |
|---|---|---|
| 2024-12-04 | Instagram Basic Display API shut down | Never use `instagram_graph_user_profile` / Basic Display tutorials |
| 2025-01-21 | Insights metrics `impressions`, `plays` and others deprecated | None (no insights) |
| 2025-01-27 | Old scope values `business_basic`, `business_content_publish`, ... removed; use `instagram_business_*` | Only matters on the Instagram Login route |
| 2025-03-24 | `alt_text` parameter added for image posts | Use it |
| 2025-06-14 | `force_reauth` on Instagram authorize | None |
| 2025-07-09 | `user_tags` for stories | None |
| 2025-12-03 | `DELETE /{ig-media-id}` (needs `instagram_manage_contents`, Facebook Login only) | Optional clean-up tool |
| 2026-02-06 | `enable_fb_login` authorize parameter | None |
| 2026-06-22 | `is_ai_generated` parameter on container creation | Leave unset or `false`; the image is a rendered data card, not generative AI |
| 2026-07-29 (v26.0) | `pretty` and `debug` query params ignored; **any** request that includes `date_format` returns an error ("Requests that include `date_format` return an error", not only invalid values) (all versions from 2026-10-27). `debug_token` endpoint unaffected [V][GAPI-26] | Do not send them |
| 2026-11-04 (v27.0) | Pages `is_ai_generated` on post edit; nothing breaking for publishing | None |

Version lifetimes [V][GAPI-CHLOG]: v27.0 from 2026-11-04 (end "TBD"), v26.0 from 2026-07-29, v25.0 from 2026-02-18 until 2028-07-29, v24.0 until 2028-02-18, v23.0 until 2027-10-08, v22.0 until 2027-05-20, v21.0 removed 2027-01-21. Roughly two years per version: pin `v27.0` in config and review yearly.

---

## 2. Instagram content publishing flow (Q2)

`<HOST>` is `graph.facebook.com` (recommended) or `graph.instagram.com` (Instagram Login route). Paths, parameters and responses are identical on both hosts [V][IG-CP][IGL-MIG "Most request bodies stay the same"].

### 2.1 Step 1: create the container

`POST https://<HOST>/v27.0/<IG_ID>/media` [V][IG-MEDIA]

| Parameter | Use | Notes |
|---|---|---|
| `image_url` | required for images | "We will cURL the image using the URL that you specify so the image must be on a public server." |
| `caption` | optional | "Maximum 2200 characters, 30 hashtags, and 20 @ tags." Not supported for Stories [U: the Stories section lists no caption support; the table says nothing explicit] |
| `alt_text` | optional | "For image posts only. Alternative text, up to 1000 character... Reels and stories are not supported." |
| `media_type` | omit for a feed image; `STORIES` for a story | "Required for carousels, stories, and reels." Values `CAROUSEL`, `REELS`, `STORIES` |
| `is_ai_generated` | optional | self-disclosure flag |
| `collaborators`, `user_tags`, `location_id`, `is_carousel_item` | optional | not needed |
| `access_token` | required | or `Authorization: Bearer` header as in Meta's own example |

Feed image, as documented (JSON body + bearer header) [V][IG-CP]:

```bash
curl -sS -X POST "https://graph.facebook.com/v27.0/${IG_ID}/media" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${META_TOKEN}" \
  -d '{
        "image_url": "https://example.com/social/2026-11-20/1500-feed.jpg",
        "caption": "Dolar blue hoy: compra $1.234 / venta $1.254\n\n#dolarblue #dolarhoy",
        "alt_text": "Cotizaciones del dolar blue y oficial del 20 de noviembre de 2026"
      }'
# 200 -> {"id":"17889455560051444"}        (IG container id)
```

Form-encoded equivalent (also accepted by the Graph API; safest for arbitrary captions) [U: form encoding is standard Graph behaviour, the doc example uses JSON]:

```bash
curl -sS -X POST "https://graph.facebook.com/v27.0/${IG_ID}/media" \
  --data-urlencode "image_url=https://example.com/social/2026-11-20/1500-feed.jpg" \
  --data-urlencode "caption=Dolar blue hoy ..." \
  --data-urlencode "alt_text=Cotizaciones ..." \
  --data-urlencode "access_token=${META_TOKEN}"
```

Story image [V][IG-MEDIA][IG-CP "Story posts"]:

```bash
curl -sS -X POST "https://graph.facebook.com/v27.0/${IG_ID}/media" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${META_TOKEN}" \
  -d '{
        "image_url": "https://example.com/social/2026-11-20/1500-story.jpg",
        "media_type": "STORIES"
      }'
# 200 -> {"id":"17889455560051555"}
```

Story limits [V][IG-MEDIA]: "Stories expire after 24 hours."; "Publishing stickers (i.e., link, poll, location) is not supported; however mentioning users without a sticker is supported." A link sticker to the site is therefore **not possible** through the API; any text or URL must be baked into the image.

### 2.2 Step 2: poll the container

`GET https://<HOST>/v27.0/<IG_CONTAINER_ID>?fields=status_code,status` [V][IG-CONT][IG-CP]

```bash
curl -sS "https://graph.facebook.com/v27.0/${CONTAINER_ID}?fields=status_code,status" \
  -H "Authorization: Bearer ${META_TOKEN}"
# -> {"status_code":"FINISHED","id":"17889455560051444"}
```

`status_code` values: `EXPIRED` ("The container was not published within 24 hours and has expired"), `ERROR`, `FINISHED`, `IN_PROGRESS`, `PUBLISHED`. On `ERROR` the `status` field carries the error subcode text. Meta: "We recommend querying a container's status once per minute, for no more than 5 minutes." [V][IG-CP]

For still images the container is normally `FINISHED` within seconds [U: practice, not documented]. Publishing an unfinished container returns error `9007` / subcode `2207027` [V][IG-ERR].

### 2.3 Step 3: publish

`POST https://<HOST>/v27.0/<IG_ID>/media_publish` with `creation_id` [V][IG-PUB][IG-CP]

```bash
curl -sS -X POST "https://graph.facebook.com/v27.0/${IG_ID}/media_publish" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${META_TOKEN}" \
  -d "{\"creation_id\":\"${CONTAINER_ID}\"}"
# 200 -> {"id":"17920238422030506"}        (IG media id)
```

The response may also carry `config_issue` (`CAPTION_NOT_ATTACHED`, `USER_TAGGING_FAILURE`) and `caption_add_on_attachment_status` on partial success [V][IG-PUB]. Log them; `CAPTION_NOT_ATTACHED` means the post went out without its caption.

Optional follow-up to record the public link [V][IG-MEDIAOBJ]:

```bash
curl -sS "https://graph.facebook.com/v27.0/${MEDIA_ID}?fields=id,permalink,media_product_type,timestamp" \
  -H "Authorization: Bearer ${META_TOKEN}"
```

`media_product_type` is `FEED` or `STORY` ("Available for Instagram API with Facebook Login only") [V][IG-MEDIAOBJ]. Story media is not returned by `GET /{ig-id}/media`; use `GET /{ig-id}/stories` [V][IG-MEDIA].

### 2.4 Quota check

`GET https://<HOST>/v27.0/<IG_ID>/content_publishing_limit?fields=quota_usage,config` [V][IG-CPL]

```bash
curl -sS "https://graph.facebook.com/v27.0/${IG_ID}/content_publishing_limit?fields=quota_usage,config" \
  -H "Authorization: Bearer ${META_TOKEN}"
# -> {"data":[{"quota_usage":2,"config":{"quota_total":50,"quota_duration":86400}}]}
```

### 2.5 Hard rules for the flow

- Containers expire after 24 hours; at most 400 containers per rolling 24 h [V][IG-MEDIA].
- "We strongly recommended ... URLs that contain only US ASCII characters, or the request will fail" [V][IG-MEDIA].
- A Page that requires Page Publishing Authorization, or two-factor authentication the acting user has not completed, makes the request fail [V][IG-MEDIA][IG-CP].
- "Shopping tags are not supported. Filters are not supported." [V][IG-CP]
- `media_publish` is **not idempotent**. On a timeout, read the container (`status_code == PUBLISHED`) before retrying, otherwise a duplicate post is possible [U: design inference from the status enum].

---

## 3. Media requirements (Q3)

### 3.1 Feed image [V][IG-MEDIA]

- Format: **JPEG**. "JPEG is the only image format supported. Extended JPEG formats such as MPO and JPS are not supported." [V][IG-CP]. PNG and WebP are rejected (error `36001` / `2207005`).
- File size: 8 MB maximum (error `36000` / `2207004`).
- Aspect ratio: "Must be within a 4:5 to 1.91:1 range" (error `36003` / `2207009`).
- Minimum width 320 (scaled up), maximum width 1440 (scaled down). Height follows from the ratio.
- Colour space: sRGB; others are converted.

**3:4 (1080x1440)**: the Instagram app has allowed 3:4 feed photos since 2025 per third-party reports [U], but the API reference fetched today still says 4:5 to 1.91:1 and the error table still defines `2207009` on that range [V][IG-MEDIA][IG-ERR]. Do not use 3:4. The Instagram Help Center page on photo sizes could not be read (returns an empty shell to the fetch tool) [U].

Recommended output [U: derived from the limits above]:

| Surface | Pixels | Ratio | Notes |
|---|---|---|---|
| Feed (portrait, most screen area) | 1080 x 1350 | 4:5 exactly (0.8) | 1440 x 1800 also valid and is the widest stored size |
| Feed (square alternative) | 1080 x 1080 | 1:1 | safest crop in the profile grid |
| Story | 1080 x 1920 | 9:16 | keep content out of the top and bottom ~250 px (profile header and reply bar) [U] |

Encode baseline JPEG, sRGB, quality about 90, no CMYK, no alpha. A flat-colour data card will be well under 1 MB. Whether progressive JPEG is accepted is not documented [U]; use baseline.

Profile grid: Instagram's grid preview crops the centre of the post; keep the headline numbers in the central area [U].

### 3.2 Story image [V][IG-MEDIA]

- Format JPEG, 8 MB max, sRGB.
- "Aspect ratio: We recommended 9:16 to avoid cropping or blank space".

### 3.3 The image URL

What Meta documents [V][IG-CP][IG-MEDIA]:

- "We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server at the time of the attempt."
- US-ASCII URL.

What Meta does **not** document (all [U]):

- Which User-Agent fetches `image_url`. Third-party (Ayrshare, undated) says `facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)` and that the fetch may send a `Range` header [3P-AYR]. Meta's crawler page confirms that UA string exists, that it supports gzip/deflate and may send `Range`, and that content must be retrievable "within a few seconds" [V*][CRAWL], but does not tie it to the publishing fetcher.
- Whether redirects are followed, whether `Content-Type` must be `image/jpeg`, whether the extension matters, whether robots.txt is honoured. Third-party reports say a robots.txt block or a 403 produces `2207052` [3P-AYR].
- How long the URL must stay live. The fetch happens when the container is created; after `status_code == FINISHED` Meta has its copy [U]. Keep the object at least 24 h (container lifetime) to allow a rebuild.

Serving rules to implement (defensive, covers every unknown above):

1. Serve from the project's own domain or an R2 custom domain: HTTP 200, `Content-Type: image/jpeg`, `Content-Length` set, no redirect, no auth, no query-string signature that expires.
2. Path ends in `.jpg`, ASCII only, **unique per post** (date + slot in the path) so no stale copy can be reused by any cache.
3. Support `Range` requests (R2 and the Workers cache do).
4. No bot challenge on that path. Cloudflare: "Cloudflare does not block or challenge requests from Facebook by default"; exceptions are Under Attack mode, custom rules, and country challenges; suggested fix is a Skip rule for ASNs **AS32934** and **AS63293** [V*][CF-FB, dateModified 2026-05-05]. That page does not mention Bot Fight Mode; third parties report Bot Fight Mode blocking Meta's fetcher [3P-AYR][U]. Keep Bot Fight Mode off for the zone or put the images on a hostname without it.
5. robots.txt must not disallow the image path for `facebookexternalhit` [U].
6. Pre-flight in the job: `HEAD`/`GET` the URL from the Worker and assert 200 + `image/jpeg` + size < 8 MB before calling Meta.

Local test that mimics the reported fetcher [3P-AYR]:

```bash
curl -v --compressed -H "Range: bytes=0-524288" -H "Connection: close" \
  -A "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" \
  "https://example.com/social/2026-11-20/1500-feed.jpg" -o /dev/null
# expect HTTP 200 or 206 and Content-Type: image/jpeg
```

---

## 4. Limits (Q4)

| Limit | Value | Source |
|---|---|---|
| API-published posts per IG account per rolling 24 h | **100** (content publishing guide) or **50** (carousel section, `media_publish` reference, `quota_total` "currently 50") | [C][IG-CP][IG-PUB][IG-CPL] |
| Does a Story count? | Not stated. Assume every `media_publish` counts [U] | |
| Containers created per 24 h | 400 | [V][IG-MEDIA] |
| Container lifetime | 24 h | [V][IG-MEDIA] |
| Caption | 2200 characters, 30 hashtags, 20 @ tags | [V][IG-MEDIA][IG-ERR] |
| `alt_text` | 1000 characters | [V][IG-MEDIA] |
| Image | 8 MB | [V][IG-MEDIA] |
| Graph API calls, Instagram (Business Use Case rate limit) | `4800 * impressions` calls per rolling 24 h per app/account pair; impressions = times any content of the account entered a screen in the last 24 h. No minimum is documented for Instagram | [V][IG-OV "Rate Limiting"], [V*][GAPI-RATE] |
| Graph API calls, Facebook Page (BUC, Page or system-user token) | `4800 * engaged users` per 24 h; no minimum documented. A dormant Page could in theory have a very small budget; the job needs 2 calls per post [U for the floor] | [V*][GAPI-RATE] |
| Threads API calls | `4800 * impressions` per 24 h, "The minimum value for impressions is 10" (so at least 48,000 calls) | [V][TH-OV] |
| Threads posts per 24 h | 250 | [V][TH-OV] |
| Threads text | 500 characters | [V][TH-OV] |
| Facebook Page photo | 4 MB | [V*][GAPI-PHOTOS] |

Rate-limit telemetry: response header `X-Business-Use-Case-Usage` (JSON with `call_count`, `total_cputime`, `total_time` as percentages and `estimated_time_to_regain_access` in minutes) [V*][GAPI-RATE]. Throttle error codes: `4`, `17`, `32`, `613`, `80001` (Pages), `80002` (Instagram) [V*][GAPI-RATE][GAPI-ERR].

The job makes about 10 calls per post. Log the header and alert above 80 percent; no throttling logic beyond backoff is needed.

Caption guidance: hashtag count over 30 or @ tags over 20 is an error (`100` / `2207040` for tags), not a silent trim [V][IG-ERR]. Count characters the way Instagram does is not documented [U]; keep captions under 2000 UTF-16 units to stay clear of `36004` / `2207010`.

---

## 5. Tokens (Q5)

### 5.1 Lifetimes at a glance

| Token | Lifetime | Refresh | Source |
|---|---|---|---|
| System User token (business portfolio) | never expires, or 60 days if that option is chosen | none needed for the non-expiring kind | [V*][SYS], [V][FB-TOK] |
| Business Integration System User token (Unified Login) | per configuration; "Defaults to **never expire**" | management API if a 60-day configuration is used | [V][FL4B][UL-AUTH] |
| Page token derived from a long-lived user token | "do not have an expiration date" | none | [V][FB-LL] |
| Facebook long-lived User token | about 60 days | no unattended refresh; user must log in again | [V][FB-LL] |
| Instagram Login long-lived token | 60 days | `refresh_access_token`, token must be >= 24 h old and unexpired | [V][IGL-REFRESH] |
| Threads long-lived token | 60 days | `refresh_access_token`, same rule | [V][TH-LL] |
| Any short-lived token | 1 hour | exchange for long-lived | [V][IGL-TOKEN][TH-START] |

Other expiry mechanisms that are **independent of the token's own expiry**:

- **Data access expiration**: "The expiration period for data access is 90 days, based on when the user was last active." [V][FB-AVD]. This applies to user-granted access. Meta's list of permissions exempt from it includes `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management`; `instagram_basic` and `instagram_content_publish` are not on that list [V][FB-AVD]. This is the reason not to build on a personal Facebook User token.
- **Unused permission**: "if your app does not use a permission for 90 days, that permission may expire" [V][FB-AVD]. The job uses every permission daily.
- **Inactive app**: no logins, no API calls and no webhooks for 90 days can put the app in the Inactive state; then "New access tokens must be generated" [V][DEV-STATES]. Not a risk while the cron runs.
- **Revocation events** for user-derived tokens: password change, logout from all sessions, app removed, security checkpoint (error 190 subcodes 458/459/460/463/467) [V*][FB-DBG]. System-user tokens are not tied to a person's password.
- Unified Login token dies "if your client removes your app from their business portfolio or moves the Instagram account to another business portfolio" [V][UL-AUTH].

### 5.2 Most robust zero-maintenance strategy

A **non-expiring system-user token on `graph.facebook.com`**, stored as a Worker secret. Meta: "System User access tokens let your app perform programmatic, automated actions on Ad objects or Pages without requiring input from an app user or re-authentication." [V][FB-TOK]. Meta's system-user guide lists `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` and `business_management` among the scopes a system user token can carry, and its token table reads "Never expires" / refresh needed "No" for the non-expiring type [V*][SYS].

There are two ways to obtain such a token. Try them in this order; both produce a token used identically by the code.

**Route A: Business Settings system user (established, covers IG + Page).** [V][FB-TOK] for the steps; [U] that Instagram publishing accepts it under Standard Access (the Instagram reference pages name "Facebook User access token"; system-user use is common practice and matches the scope list, but no Instagram page states it).

1. `https://business.facebook.com/settings/` -> **System Users** -> **+Add** -> name it, role **Admin**.
2. Click the system user -> **Assign assets** -> select the app -> grant **Manage app**. Reload and confirm **Full control**.
3. Also assign the Facebook Page and the Instagram account as assets (an Admin system user has "full access to all assets owned by or shared with your business portfolio by default" [V][FB-TOK], so this is only needed for an Employee system user).
4. **Generate token** -> select the app -> "choose a token expiration preference" -> choose the never-expiring option -> tick `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, **and `ads_read`** -> **Generate token** -> copy it (shown once).

Why `ads_read` (corrected by verifier 2026-11-22): the `/media` and `/media_publish` references say "If the app user was granted a role on the Page via the Business Manager, you will also need one of: `ads_management`, `ads_read`" [V][IG-MEDIA][IG-PUB] (the read endpoints say `ads_management` or `business_management`). A system user always gets its Page access through the business portfolio, so this condition applies to Route A by construction. `ads_read` is the least-privileged of the two and is on the list of scopes a system-user token can carry [V*][SYS]. That a system user's Page role counts as "granted via the Business Manager" is the verifier's inference from how system users work, not a sentence in Meta's docs. Whether `business_management` alone is enough in practice is [U]; request `ads_read` from the start so a missing scope is not confused with a token-type rejection (typical symptom: error `10` or `200`). If the Generate-token dialog does not offer `ads_read` for this app, generate the token without it and let the smoke test decide.

Caveat, refined by verifier 2026-11-22 [V*][SYS], [V][MAPI-AUTH][DEV-MAPI-UC][DEV-CREATE]: Meta's system-user guides say "only apps with standard access to the Ads Management API and above can be installed" and "to create a system user access token, this app must have standard access" (pages served in Spanish; translated), and that system user and app must belong to the same business portfolio. "Ads Management Standard Access" has been renamed: "'Standard Access' is now **Limited Access**" of the **Marketing API Access Tier**, which is "Automatically granted when you add the Marketing API product to your app" and allows "1 system user and 1 admin system user" [V][MAPI-AUTH]. The Marketing API use cases (for example **Create & manage ads with Marketing API**) carry the feature "Ads Management Standard Access — Required for all use cases" [V][DEV-MAPI-UC]. The Business Settings UI steps above do not state the precondition [V][FB-TOK]. So, in order:

1. Try the UI steps as written.
2. If the UI does not list the app, or refuses the token or the permissions, add a Marketing API use case to the app (App Dashboard > Use cases > Add use cases) and try again. Mind two things: "**Use cases cannot be removed** after you create your app" [V][DEV-CREATE], and whether that use case is compatible with the Instagram, Pages and Threads use cases in one app is not documented (incompatible ones are "greyed out") [U].
3. If that still fails, use Route B.

Limited tier allows exactly one admin system user and one regular system user per app [V][MAPI-AUTH]; one is all this job needs.

If the token is issued but `POST /{ig-id}/media` rejects it, retry the Instagram calls with the Page access token derived from it (`GET /{page-id}?fields=access_token`, section 6): the Content Publishing guide names "Facebook Page access token" as the token for the Facebook Login setup [V][IG-CP].

**Route B: Unified Login dashboard token (Meta's recommended setup; Instagram only).** [V][UL-START]

1. App Dashboard -> **Use cases** -> **Manage messaging & content on Instagram** -> **Customize** -> **API setup with Unified login**.
2. **Configure your app** -> **Create new configuration** -> **Edit permissions**: keep `instagram_basic` (required), add `instagram_content_publish`; `instagram_manage_messages` is listed as required in the default configuration. Check that the configuration preview shows token type **System-user access token** and an expiration of never. **Use this configuration**, enter a redirect URL, **Save**.
3. **Generate access tokens** -> **Add account** -> invite the Instagram professional account as an **Instagram Tester** -> accept on instagram.com: **Settings > Website permissions > Apps and websites > Tester Invites**.
4. **Generate token**, complete the login, copy the token ("It's shown only once").

Meta describes this as the way "to test with your own Instagram account while your app is in Development mode" [V][UL-START]; the step is titled "Generate a **test** access token". Prerequisites listed on the same page [V][UL-START]: app owned by a business portfolio, app uses Facebook Login for Business, admin role on the app, an HTTPS redirect URL, "an HTTPS endpoint that can receive and verify webhook notifications" (webhook configuration is its own later step, so it is probably not needed just to generate the token [U]), and an Instagram professional account ("Test users aren't supported"). Up to 50 Instagram Testers can be added [V][IGL-MIG].

Open points [U]: whether that dashboard token honours the never-expire setting ("The configuration preview also shows the access token type and expiration for the configuration" [V][UL-START]; check `expires_at` with `debug_token`), and whether it can also read a Page token. On the second point the docs say more than the first draft recorded (verifier 2026-11-22): the Unified Login permission page states "This list isn't exhaustive. Other permissions that Facebook Login for Business supports can also be added to your configuration" [V][UL-PERM], and the Facebook Login for Business table marks `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` and `business_management` as available on Business Integration System User tokens [V][FL4B]. But a configuration only keeps the **Instagram Login Compatible** label if it "requests only an Instagram account, or only an Instagram account and an ad account" [V][IGL-MIG], so a configuration that also requests the Page is an ordinary Facebook Login for Business "System-user access token" configuration (login with Facebook, which is fine for the owner) and may not be selectable in the Unified Login tab [U]. That ordinary configuration (App Dashboard > Facebook Login for Business > Configurations > token type **System-user access token**, assets Page + Instagram account, permissions `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`) is a documented third way to get one non-expiring token for both Instagram and the Page [V][FL4B][DEV-PGUC]; its login flow needs a redirect URL and a code exchange (`GET /v27.0/oauth/access_token?client_id=&client_secret=&code=`). Facebook Login for Business also says the app's portfolio "needs to be separate from the business portfolio owned by your business client" [V][FL4B], which is written for the client-onboarding flow and may or may not bind the dashboard shortcut.

**Route C (fallback, needs the refresh job): Instagram Login 60-day token on `graph.instagram.com`.** Only if the dashboard still offers "API setup with Instagram login" for the app (see 11.4). Instagram only, no Page.

- Dashboard shortcut: **Instagram > API setup with Instagram business login > Generate token** next to the account; "Access tokens from the App Dashboard are long-lived and are valid for 60 days." [V][IGL-START]
- Refresh:

```bash
curl -sS "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${IG_LONG_LIVED_TOKEN}"
# -> {"access_token":"<TOKEN>","token_type":"bearer","expires_in":5183944}
```

Rules [V][IGL-REFRESH]: token "at least 24 hours old", "valid (not expired)", user granted `instagram_business_basic`. "Refreshed tokens are valid for 60 days from the date at which they are refreshed." "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed." No app secret is needed for the refresh call.

- Full OAuth, only if the dashboard button is missing [V][IGL-BL][IGL-TOKEN]:

```text
https://www.instagram.com/oauth/authorize?client_id=<IG_APP_ID>&redirect_uri=<URI>&response_type=code&scope=instagram_business_basic,instagram_business_content_publish
```

```bash
# code is valid 1 hour, single use; strip a trailing "#_" from the redirect
curl -sS -X POST "https://api.instagram.com/oauth/access_token" \
  -d "client_id=${IG_APP_ID}" -d "client_secret=${IG_APP_SECRET}" \
  -d "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" -d "code=${CODE}"
# -> short-lived token (1 h) + user_id + permissions

curl -sS "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${IG_APP_SECRET}&access_token=${SHORT_TOKEN}"
# -> {"access_token":"...","token_type":"bearer","expires_in":5183944}
```

Routes not recommended:

- Personal Facebook User token exchanged with `fb_exchange_token` (60 days; "You can not use an expired token to request a long-lived token" [V][FB-LL]; no unattended renewal; subject to 90-day data-access expiry and to password-change revocation).
- Page token derived from a **personal** user token for Instagram calls: the Page token itself has no expiry, but it inherits the user's data-access and revocation behaviour [U]. (Corrected by verifier 2026-11-22: the first draft added "the Instagram references name a User token". That is true of the endpoint references, but the Content Publishing guide's requirements table names "Facebook Page access token" for the Facebook Login setup [V][IG-CP]. A Page token is therefore a documented token type for publishing; the objection here is only to deriving it from a personal user. A Page token derived from the system-user token is the fallback described under Route A.)

### 5.3 Verify whatever token you got

`GET https://graph.facebook.com/v27.0/debug_token?input_token=<TOKEN>&access_token=<APP_ID>|<APP_SECRET>` [V*][GAPI-DEBUG] ("An app access token or an app developer's user access token for the app associated with the `input_token` ... is required").

```bash
curl -sS -G "https://graph.facebook.com/v27.0/debug_token" \
  --data-urlencode "input_token=${META_TOKEN}" \
  --data-urlencode "access_token=${META_APP_ID}|${META_APP_SECRET}"
```

Response fields [V*][GAPI-DEBUG]: `app_id`, `application`, `expires_at`, `data_access_expires_at`, `is_valid`, `issued_at`, `scopes`, `granular_scopes`, `user_id`, `profile_id`, `error{code,message,subcode}`.

Accept the token only if `is_valid` is true, `scopes` contains `instagram_basic` and `instagram_content_publish` (plus `ads_read` on Route A, and the three `pages_*` scopes plus `business_management` if Facebook posting is wanted), and `expires_at` is `0`. That `0` means "never" is long-standing behaviour but is not spelled out on the reference page [U]; `data_access_expires_at` should also be `0` for a system-user token [U].

Then resolve the IDs once and store them as config:

```bash
# Route A / Facebook Login style
curl -sS "https://graph.facebook.com/v27.0/me/accounts?fields=id,name,tasks,instagram_business_account{id,username}" \
  -H "Authorization: Bearer ${META_TOKEN}"
# Route B / Unified Login style
curl -sS "https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id,username" \
  -H "Authorization: Bearer ${META_TOKEN}"
# From a known Page id
curl -sS "https://graph.facebook.com/v27.0/${PAGE_ID}?fields=instagram_business_account" \
  -H "Authorization: Bearer ${META_TOKEN}"
# Instagram Login (Route C): user_id is the IG account id, id is app-scoped
curl -sS "https://graph.instagram.com/v27.0/me?fields=user_id,username" \
  -H "Authorization: Bearer ${IG_LONG_LIVED_TOKEN}"
```

The Unified Login `id` "is the same value as the `user_id` field that `GET /me` returns in the Instagram API with Instagram Login" [V][IGL-MIG], so the stored IG id survives a later change of route.

### 5.4 Token health and refresh job (build it for every route)

Storage:

- Non-expiring Meta token: Worker secret (`META_TOKEN`). Rotated by hand only if revoked.
- Refreshable tokens (Threads always; Instagram only on Route C): mutable store (KV or D1), because a Worker cannot rewrite its own secrets without the Cloudflare API. Record `{token, obtained_at, expires_at, last_refresh_at, last_refresh_error}`.

Weekly cron (for example Mondays 12:00 UTC):

1. **Health check, all tokens**: call `debug_token` (Meta token with `APP_ID|APP_SECRET`; Threads token on `graph.threads.com/v1.0/debug_token` with `TH|<THREADS_APP_ID>|<THREADS_APP_SECRET>` [V][TH-DEBUG][TH-APPTOK]). Alert if `is_valid` is false, a required scope is missing, or a non-zero `expires_at` or `data_access_expires_at` is less than 21 days away.
2. **Refresh, refreshable tokens only**: if `now - last_refresh_at >= 24h`, call the refresh endpoint, then verify the returned token with one cheap read (`GET /me?fields=id`), then overwrite the stored value and set `expires_at = now + expires_in`. Always store the returned `access_token` string; whether it is a new string is not documented [U]. Keep the previous token until the new one has been verified.
3. **Failure policy**: on a refresh error keep the old token, retry daily, alert immediately. With a weekly refresh there are about seven further attempts before a 60-day token lapses.
4. **Alert channel**: anything that reaches the owner (email, Telegram bot, Discord webhook). An expired token cannot be repaired by code; the owner must redo the checklist step that issued it.

On every publish run, treat error code `190` (any subcode) as "token dead": stop retrying, alert, skip the platform until a new token is stored.

### 5.5 Optional hardening

`appsecret_proof` = HMAC-SHA256 of the access token keyed with the app secret, passed as a parameter; can be made mandatory at **App Settings > Advanced > Security > Require App Secret** [V*][GAPI-SECURE]. Recommended for a server-only app: a leaked token is then useless without the secret. Hex output encoding is what the documented PHP `hash_hmac` produces [U: encoding not stated on the page].

```ts
async function appsecretProof(token: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```

---

## 6. Facebook Page photo post (Q6)

Endpoint: `POST https://graph.facebook.com/v27.0/<PAGE_ID>/photos` [V][PG-POSTS], parameters [V*][GAPI-PHOTOS]:

| Parameter | Notes |
|---|---|
| `url` | "The URL of a photo that is already uploaded to the Internet" |
| `caption` | "The description of the photo". This is the post text. `message` and `name` are "Deprecated. Please use the caption param instead." |
| `published` | default `true` |
| `alt_text_custom` | optional alt text |
| `access_token` | **Page** access token |

Requirements [V*][GAPI-PHOTOS][V][PG-MANAGE]: Page access token from someone who can perform `CREATE_CONTENT` on the Page; permissions `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`; "If using a business system user in your API requests, the `business_management` permission is required." (Verifier note 2026-11-22: that permission triple is what the `/{page-id}/photos` reference lists. The Posts guide [PG-POSTS] lists a different set for posting in general: `pages_manage_engagement`, `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_engagement`, and tasks `CREATE_CONTENT`, `MANAGE` and `MODERATE`. If the photo post fails with error `200`/`283`, add `pages_manage_engagement` to the token before looking elsewhere.)

Formats and size [V*][GAPI-PHOTOS]: .jpeg, .bmp, .png, .gif, .tiff; 4 MB max; PNG recommended under 1 MB. The same JPEG used for Instagram is fine.

Get the Page token at run time from the system-user token (one extra call, nothing to store) [V*][GAPI-PAGE: `access_token` field "Only returned if the User making the request has a role (other than Live Contributor) on the Page"]:

```bash
PAGE_TOKEN=$(curl -sS "https://graph.facebook.com/v27.0/${PAGE_ID}?fields=access_token" \
  -H "Authorization: Bearer ${META_TOKEN}" | jq -r .access_token)

curl -sS -X POST "https://graph.facebook.com/v27.0/${PAGE_ID}/photos" \
  --data-urlencode "url=https://example.com/social/2026-11-20/1500-feed.jpg" \
  --data-urlencode "caption=Dolar blue hoy: compra \$1.234 / venta \$1.254 https://example.com" \
  --data-urlencode "access_token=${PAGE_TOKEN}"
# 200 -> {"id":"<photo_id>","post_id":"<page_id>_<post_id>"}
```

`GET /me/accounts?fields=id,access_token` returns the same Page token and is the documented way for user tokens [V][FB-LL][PG-MANAGE]; for a system user either call should work [U].

Unlike Instagram, a Facebook caption may contain a clickable link.

**Visibility trap** [V][DEV-MODES]: "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users. However, that data will be visible to non-role users once the app is switched to Live mode." A Page post made by an unpublished app is invisible to the public. The app must be **published (Live)** for the Facebook leg. Another page says "Business apps do not have app modes and rely exclusively on access levels." [C][DEV-REL], see 11.3. Verify by opening the post logged out.

Publishing the app needs [V][TH-APP][PG-APP]: app icon (512 to 1024 px, under 5 MB), Privacy Policy URL, data deletion URL or instructions, then **Publish** in the left menu. For a server-to-server app set the platform to Website [V][DEV-S2S].

Errors [V*][GAPI-PHOTOS] (`100` invalid parameter, `190` token, `200` permission, `240`, `283` requires extended permissions, `324` missing or invalid image file, `368` abusive or otherwise disallowed) and [V*][GAPI-ERR] (`506` duplicate post, `368` temporarily blocked for policy violations). The Pages API error page [PG-ERR] lists other codes, of which `190` with subcode `2069032` "A Page access token is required for this call" is the relevant one here. *(Source attribution corrected by verifier 2026-11-22: none of the codes in the first draft come from PG-ERR.)*

---

## 7. Threads (Q7)

Worth adding: the pattern is the same container flow, it accepts the same public image URL, and the only extra cost is a second 60-day token with the refresh job from 5.4.

### 7.1 Setup facts

- Hosts: "The Threads API can be accessed by either `graph.threads.com` or `graph.threads.net`." Version `v1.0` [V][TH-OV].
- Use case: **Access the Threads API**. The app then has two IDs and secrets: "For Threads API implementation purposes, use the Threads app ID and its corresponding app secret." Found at **Use cases > Threads > Settings** [V][TH-START][TH-APP].
- Permissions: `threads_basic` (required for all calls) and `threads_content_publish` [V][TH-START].
- No App Review for testers: "Threads testers can grant your app these permissions at any time." Add at **App Dashboard > App roles > Roles > Add People > Threads Tester**; accept in Threads **Account Settings > Website permissions** (`https://www.threads.com/settings/account`) [V][TH-START].
- Since 2025-09-23 a Threads profile does not need a linked Instagram account [V][TH-CHLOG].
- Threads + Pages in one app is explicitly allowed (corrected by verifier 2026-11-22; the first draft called this unstated): "You can add multiple use cases to a single app, provided they are compatible with each other. For example, you can add the **Access Threads API** use case to an app with the **Manage everything on your Page** use case" [V][DEV-CREATE]. The Instagram use case is not named in that sentence, so Instagram + Pages + Threads in one app is still [U]; incompatible use cases are "greyed out" in the dashboard. If the dashboard refuses, create a second app (no cost). "**Use cases cannot be removed** after you create your app" [V][DEV-CREATE], so add them deliberately.

### 7.2 One-time authorization (owner, in a browser)

```text
https://threads.com/oauth/authorize?client_id=<THREADS_APP_ID>&redirect_uri=<REDIRECT_URI>&scope=threads_basic,threads_content_publish&response_type=code
```

The redirect URI must be registered under **Client OAuth Settings**. "Authorization codes are valid for 1 hour and can only be used once." [V][TH-TOK]

```bash
curl -sS -X POST "https://graph.threads.com/oauth/access_token" \
  -d "client_id=${THREADS_APP_ID}" -d "client_secret=${THREADS_APP_SECRET}" \
  -d "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" -d "code=${CODE}"
# -> {"access_token":"<SHORT_LIVED>","token_type":"bearer","user_id":<THREADS_USER_ID>}

curl -sS "https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret=${THREADS_APP_SECRET}&access_token=${SHORT_LIVED}"
# -> {"access_token":"<LONG_LIVED>","token_type":"bearer","expires_in":5183944}
```

Meta's docs say that for testing "you can generate tokens and grant your app permissions by using the Graph API Explorer" [V][TH-POSTS]; whether the Explorer or the dashboard hands out a long-lived Threads token directly is not documented [U].

### 7.3 Token lifetime and refresh [V][TH-LL]

- Short-lived: 1 hour. Long-lived: 60 days.
- Refresh "as long as they are at least 24 hours old but have not expired, and the app user has granted your app the `threads_basic` permission". "Refreshed tokens are valid for 60 days from the date at which they are refreshed."

```bash
curl -sS "https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=${THREADS_TOKEN}"
# -> {"access_token":"...","token_type":"bearer","expires_in":5183944}
```

- "Permission grants are valid for 90 days. Refreshing an app user's long-lived access token extends the permission grant for another 90 days only if the user has a public profile." The Threads profile must stay **public**, otherwise the owner must re-authorize every 90 days.
- No non-expiring Threads token exists in the docs [V: none of the token pages offers one].

### 7.4 Publish an image post

Create [V][TH-POSTS][TH-REFPUB]:

```bash
curl -sS -X POST "https://graph.threads.com/v1.0/${THREADS_USER_ID}/threads" \
  -d "media_type=IMAGE" \
  --data-urlencode "image_url=https://example.com/social/2026-11-20/1500-feed.jpg" \
  --data-urlencode "text=Dolar blue hoy: compra \$1.234 / venta \$1.254 https://example.com" \
  --data-urlencode "alt_text=Cotizaciones del dolar del 20 de noviembre de 2026" \
  -d "access_token=${THREADS_TOKEN}"
# -> {"id":"<THREADS_CONTAINER_ID>"}
```

Wait: "Wait about 30 seconds before publishing a Threads media container to give Threads enough time to fully process the upload." [V][TH-POSTS]. Prefer polling:

```bash
curl -sS "https://graph.threads.com/v1.0/${THREADS_CONTAINER_ID}?fields=status,error_message&access_token=${THREADS_TOKEN}"
# status: EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED
```

"We recommend querying a container's status once per minute, for no more than 5 minutes." [V][TH-TROUBLE]

Publish:

```bash
curl -sS -X POST "https://graph.threads.com/v1.0/${THREADS_USER_ID}/threads_publish" \
  -d "creation_id=${THREADS_CONTAINER_ID}" \
  -d "access_token=${THREADS_TOKEN}"
# -> {"id":"<THREADS_MEDIA_ID>"}
```

`me` works in place of the user id (`/v1.0/me?fields=id,username`, `/v1.0/me/threads`) [V][TH-PROFILE].

Parameters worth knowing [V][TH-REFPUB][TH-POSTS]: `text` (500 characters; emoji counted by UTF-8 bytes), `alt_text` (1000), `topic_tag`, `reply_control`, `is_made_with_ai`. `link_attachment` is for `TEXT` posts only; in an image post put the URL in `text`. Max 5 links per post (`THREADS_API__LINK_LIMIT_EXCEEDED`, since 2025-12-22) [V][TH-CHLOG].

Image specs [V][TH-OV]: "JPEG and PNG image types are the officially supported formats"; 8 MB; aspect ratio limit 10:1; minimum width 320; images above 4096 x 4096 are scaled down; sRGB. The Instagram 1080x1350 JPEG is valid as is.

Quota [V][TH-OV]: 250 API-published posts per rolling 24 h; `GET /v1.0/{threads-user-id}/threads_publishing_limit?fields=quota_usage,config`.

Optional shortcut [V][TH-SHAREIG]: `crossreshare_to_ig=true` (or `crossreshare_to_ig_dark_mode=true`) on the Threads container cross-posts the thread as an Instagram Story; needs the extra permission `threads_share_to_instagram`; the publish response reports `crossreshare_to_ig_status` (`SUCCESS`/`FAILED`). Not recommended as the primary Story path: the story is Threads' rendering, not the custom 9:16 card.

---

## 8. Owner checklist (Q8)

UI labels marked [U] were not fetched from a Meta help page and are from general knowledge; the developer-dashboard labels are from the docs cited.

**A. Accounts (once)**

1. Instagram app, `@bluelytics_dolar`: switch to a professional account and choose **Business**, not Creator (Stories via API are "only available to business accounts" [V][FBL-IDX]). Path in the app is roughly Settings > Account type and tools > Switch to professional account [U]. The account must be public ("This account must be public." [V][IG-CREATE]).
2. Connect the Instagram account to the Facebook Page "bluelytics" (Page settings > Linked accounts > Instagram, or Instagram > Edit profile > Page) [U]. Required for the Facebook Login style calls [V][FBL-IDX] and harmless otherwise.
3. Create or open a **business portfolio** at `https://business.facebook.com`. Add the Page and the Instagram account as assets (Business settings > Accounts > Pages / Instagram accounts) [U]. The app must be owned by this portfolio for Unified Login [V][UL-START].
4. Turn on two-factor authentication on the owner's Facebook account; complete Page Publishing Authorization if the Page asks for it [V][IG-MEDIA].

**B. Meta app (once)**

5. `https://developers.facebook.com` -> register as a developer -> **My Apps > Create App**. Add use cases **Manage messaging & content on Instagram**, **Manage everything on your Page**, **Access the Threads API**; attach the business portfolio [V][DEV-IGUC][PG-APP][TH-APP].
6. Instagram use case -> **Customize**. Pick exactly one setup: **API setup with Unified login** if the tab is shown, else **API setup with Facebook login**. Make sure `instagram_basic` and `instagram_content_publish` are added.
7. Pages use case -> **Customize**: add `pages_manage_posts`; `pages_read_engagement` and `pages_show_list` are needed too [V][PG-POSTS].
8. **App settings > Basic**: note App ID and App secret; set app icon, Privacy Policy URL, data deletion instructions URL; add platform Website.
9. **Publish** (left menu) -> review -> **Publish / Go live** [V][TH-APP][DEV-REL]. Needed for public Facebook Page posts (section 6). If the dashboard demands Business Verification at this step (one page says it does [C], 11.2), either complete it or drop the Facebook leg; Instagram and Threads do not depend on it as far as the docs show [U].

**C. Meta token (once)**

10. Route A (section 5.2): Business settings > System Users > +Add (Admin) > Assign assets (app: Manage app) > Generate token (never expire; the six permissions plus `ads_read`). If the UI will not issue it, add a Marketing API use case to the app and retry (irreversible, see 5.2). If that fails, Route B (Unified Login > Generate access tokens > Add account as Instagram Tester > accept invite > Generate token).
11. Hand the token, App ID, App secret to the deployer as secrets. Never paste them in chat or commit them.
12. Deployer runs the `debug_token` and ID-resolution calls from 5.3 and stores `IG_USER_ID` and `FB_PAGE_ID`.

**D. Threads (once)**

13. **Use cases > Access the Threads API > Settings**: note Threads app ID and secret; add the OAuth redirect URI.
14. **App roles > Roles > Add People > Threads Tester**: add the Threads profile. Accept at `https://www.threads.com/settings/account` > Website permissions [V][TH-START]. Keep the profile public.
15. Open the authorize URL from 7.2, approve, copy the `code` from the redirect, run the two exchange calls within the hour, store the long-lived token in KV.

**E. Smoke test (deployer)**

16. Upload a test JPEG to the real public path; run the curl test in 3.3.
17. Instagram feed: 2.1 -> 2.2 -> 2.3; confirm the post from a logged-out browser via `permalink`. Delete it in the app afterwards.
18. Instagram story: same with `media_type=STORIES`.
19. Facebook: section 6; open the post logged out to confirm it is public.
20. Threads: 7.4.
21. Record in the runbook which token route worked and the `debug_token` output (`expires_at`, `data_access_expires_at`, `scopes`).

**Graph API Explorer** (`https://developers.facebook.com/tools/explorer/`) is only needed for ad-hoc debugging: choose the app in the **Meta App** dropdown, pick the token kind in **User or Page**, add permissions in the **Permissions** dropdown, click **Get Access Token**; the information icon shows the token's app and granted permissions [V*][GAPI-EXPLORER]. Tokens from it are short-lived user tokens and must not be used for the cron.

---

## 9. Failure modes and reactions (Q9)

Error shape [V][IG-ERR]:

```json
{"error":{"message":"...","type":"OAuthException","code":36000,"error_subcode":2207004,
          "is_transient":false,"error_user_title":"...","error_user_msg":"...","fbtrace_id":"..."}}
```

Always log `code`, `error_subcode`, `message`, `fbtrace_id`, and the `X-Business-Use-Case-Usage` header.

### 9.1 Instagram publishing errors [V][IG-ERR] (all HTTP 400)

| code / subcode | Meaning | Job reaction |
|---|---|---|
| `-2` / `2207003` | "It takes too long to download the media." | Retry container creation up to 3 times with backoff; check origin latency |
| `-2` / `2207020` | Media expired | Create a new container |
| `-1` / `2207001` | Instagram server error | Retry with backoff |
| `-1` / `2207032` | Create media failed | Retry with backoff |
| `-1` / `2207053` | Unknown upload error | Retry once, then alert |
| `4` / `2207051` | Suspected spam, activity restricted | Stop for the day, alert. Do not hammer |
| `9` / `2207042` | Daily publishing limit reached | Skip until next day, alert (should never happen at this volume) |
| `24` / `2207006` | Media not found; "Possible permission error due to missing permission or expired token" | Check token with `debug_token`; new container |
| `24` / `2207008` | Container does not exist or expired | "Try again 1-2 times in the next 30 seconds to 2 minutes", else new container |
| `25` / `2207050` | Account restricted, inactive or checkpointed | Alert owner to open the Instagram app; stop |
| `100` / `2207023` | Unknown media type | Bug; fix the request |
| `100` / `2207040` | More than 20 @ tags | Bug; fix the caption |
| `9004` / `2207052` | "The media could not be fetched from this uri" | Verify the URL from the Worker (3.3 pre-flight); if 200, suspect WAF/bot rule; retry once, then alert |
| `9007` / `2207027` | Not ready for publishing | Keep polling `status_code`; publish on `FINISHED` |
| `36000` / `2207004` | Image larger than 8 MiB | Bug in the renderer |
| `36001` / `2207005` | Image format not supported | Not a JPEG; fix the renderer |
| `36003` / `2207009` | Aspect ratio outside 4:5 to 1.91:1 | Fix dimensions |
| `36004` / `2207010` | Caption too long | Truncate and retry |

Note: `352` / `2207026` is "unsupported **video** format", not an image error.

Container `status_code == ERROR`: read `status` for the subcode, treat as the matching row above, and create a new container. `EXPIRED`: create a new container.

Unified Login specific [V][UL-ELIG]: `(#10) Access is denied because the instagram account type is not business or creator.` -> account was switched to personal; owner must switch back and reconnect.

### 9.2 Generic Graph API errors [V*][GAPI-ERR][FB-DBG]

| code | Meaning | Reaction |
|---|---|---|
| `1`, `2` | Unknown / service temporarily unavailable | Retry with exponential backoff (for example 5 s, 30 s, 2 min) |
| `4`, `17`, `32`, `613`, `80001`, `80002`, `341` | Rate or volume throttling | Back off; read `estimated_time_to_regain_access`; skip the slot if it exceeds the slot window |
| `10`, `200` to `299` | Permission missing or denied | Not retryable. Alert; re-check `debug_token` scopes and asset assignment |
| `100` | Invalid parameter | Not retryable. Bug |
| `102`, `190` | Session / access token invalid or expired | Not retryable. Mark token dead, alert. Subcodes: `458` app not installed, `459` checkpoint, `460` password changed, `463` expired, `464` unconfirmed user, `467` invalid token, `492` user lacks Page role |
| `368` | Temporarily blocked for policy violations | Stop for 24 h, alert |
| `506` | Duplicate post (Pages) | Treat as success-equivalent; do not retry |

`is_transient: true` in the error body is a signal to retry. Do not treat its absence or `false` as "never retry" (verifier note 2026-11-22): the field appears only in the Instagram sample error [V][IG-ERR], it is not described on the Graph error-handling page [V*][GAPI-ERR], and Meta's own recommended action for several Instagram subcodes above (`2207001`, `2207003`, `2207008`, `2207032`) is "try again". Decide from the code tables first and use `is_transient` as an extra hint.

On `graph.instagram.com` the error `type` is `IGApiException` rather than `OAuthException` (observed live 2026-11-22 with an invalid token: `{"error":{"message":"Invalid OAuth 2.0 Access Token","type":"IGApiException","code":190,...}}`). Match on `code` and `error_subcode`, never on `type`.

### 9.3 Threads [V][TH-TROUBLE]

Container `status` `ERROR` with `error_message` (`FAILED_DOWNLOADING_VIDEO`, `FAILED_PROCESSING_*`, `UNKNOWN`, and others): create a new container once, then alert. Token errors use the same `190` convention [U]. Link limit: `THREADS_API__LINK_LIMIT_EXCEEDED`.

### 9.4 Design rules for the job

- Persist a small state record per `(slot, platform)`: `pending -> container_created(id, at) -> published(media_id)`. A crashed or timed-out run resumes from the stored container id instead of posting twice.
- Poll every 3 to 5 s for up to about 60 s inside one invocation; if still `IN_PROGRESS`, persist and finish on the next cron tick (the container is valid for 24 h).
- Platforms are independent: an Instagram failure must not block Facebook or Threads, and vice versa.
- A feed post and a story are two separate containers and two publishes; one may succeed without the other.
- Before the first container of a run, optionally read `content_publishing_limit` and skip if `quota_usage >= config.quota_total`.
- Cloudflare Worker time and subrequest limits are outside this document's scope; confirm them in the Cloudflare research.

Minimal reference implementation of the Instagram leg (TypeScript, Workers runtime):

```ts
const G = "https://graph.facebook.com/v27.0";

async function meta<T>(url: string, token: string, body?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json();
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw Object.assign(new Error(e.message ?? `HTTP ${res.status}`), {
      code: e.code, subcode: e.error_subcode, transient: e.is_transient === true,
      fbtrace: e.fbtrace_id, usage: res.headers.get("x-business-use-case-usage"),
    });
  }
  return json as T;
}

export async function publishInstagram(opts: {
  igId: string; token: string; imageUrl: string; caption?: string; altText?: string; story?: boolean;
}): Promise<string> {
  const body: Record<string, string> = { image_url: opts.imageUrl };
  if (opts.story) body.media_type = "STORIES";
  else {
    if (opts.caption) body.caption = opts.caption;
    if (opts.altText) body.alt_text = opts.altText;
  }
  const { id: containerId } = await meta<{ id: string }>(`${G}/${opts.igId}/media`, opts.token, body);

  for (let i = 0; i < 15; i++) {
    const s = await meta<{ status_code: string; status?: string }>(
      `${G}/${containerId}?fields=status_code,status`, opts.token);
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "PUBLISHED") return containerId; // already out; look up media separately
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED")
      throw new Error(`container ${s.status_code}: ${s.status ?? ""}`);
    await new Promise(r => setTimeout(r, 4000));
  }
  const { id: mediaId } = await meta<{ id: string }>(
    `${G}/${opts.igId}/media_publish`, opts.token, { creation_id: containerId });
  return mediaId;
}
```

Configuration the Worker needs: `META_GRAPH_HOST` (default `graph.facebook.com`), `META_API_VERSION` (`v27.0`), `META_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `IG_USER_ID`, `FB_PAGE_ID`, `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_USER_ID`, a KV/D1 binding for the Threads token and the publish state, and an alert webhook URL.

---

## 10. What changes versus Buffer

- Instagram cannot receive an uploaded file from the job; it pulls a public JPEG URL. The image must exist at a stable public URL before the API call.
- Feed captions cannot contain clickable links, and Stories cannot carry link stickers through the API. Put the site name in the artwork.
- Feed and Story are separate renders (4:5 and 9:16).
- The dark redesign must be exported as JPEG (no alpha). Check banding on dark gradients at quality 90; raise quality or add subtle noise if visible [U: general image advice].

---

## 11. Contradictions inside Meta's documentation

**11.1 Posts per 24 hours: 100 or 50.**
- "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period." [IG-CP]
- "Accounts are limited to 50 published posts within a 24-hour period." (carousel section, same page) [IG-CP]; `media_publish` reference: 50 within a 24 hour moving period [IG-PUB]; `quota_total` sample value 50 [IG-CPL].
- Resolution: irrelevant at this volume; read `config.quota_total` at run time.

**11.2 App Review and Business Verification for an own-account app.**
- Not required: [IG-REVIEW] table row "My app is only for a business I own or manage ... Standard Access ... Not required"; [DEV-BV] "you do not need to complete verification".
- Required: "Create an Instagram app" page, Step 10: "Instagram requires successful completion of the App Review process before your app can access live data"; Step 2: "You're required to connect your app to a business that has completed Business Verification before you can publish your app" [IG-CREATE].
- Resolution: the access-level pages are the governing definition and are consistent with each other. Plan for no review; if the dashboard blocks **Publish** on verification, that affects only the Facebook leg.

**11.3 Do app modes apply.**
- "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users." [DEV-MODES]
- "Business apps do not have app modes and rely exclusively on access levels." [DEV-REL]
- Also [DEV-MODES]: "Apps in Live mode can request permissions from anyone, but only permissions approved through App Review." Read literally this conflicts with Standard Access working for role users in Live mode, which [DEV-LEVELS] says it does.
- Resolution: publish the app and test public visibility of a Facebook post logged out. Whether Instagram and Threads posts from an unpublished app are publicly visible is not documented [U]; common experience is that they are.

**11.4 Can a new app use Instagram Login.**
- "Newly created apps can't set up the Instagram API with Instagram Login." [IGL-MIG]
- "API setup with Instagram login is automatically added" for new apps [IG-CREATE][DEV-IGAPIS]; [DEV-IGUC] lists both setups as selectable.
- Resolution: assume the newer migration guide is right; treat Route C as possibly unavailable.

**11.5 Unified Login and the business portfolio.**
- "invite your Instagram professional account ... to test with your own Instagram account while your app is in Development mode" [UL-START].
- "Your app must be associated with a business portfolio, which you have full control. This needs to be separate from the business portfolio owned by your business client." [FL4B]
- Resolution: unknown for a single-portfolio owner; this is why Route A is listed first.

---

## 12. Unverified items to smoke-test

1. A Business Settings system-user token with `instagram_content_publish` (and `ads_read`) publishes to Instagram from an app with Standard Access only (Route A). If it is rejected, whether the Page token derived from it is accepted instead.
2. The Business Settings UI allows assigning this app and selecting Instagram and Pages permissions without the Marketing API product on the app (Marketing API Access Tier "Limited", formerly "Ads Management Standard Access").
3. The Unified Login dashboard **Generate token** yields a never-expiring token for the owner's own account, and whether it can read a Page token (Route B).
4. `debug_token` returns `expires_at: 0` and `data_access_expires_at: 0` for the chosen token.
5. Instagram and Threads posts from an unpublished (Development) app are public.
6. The app can be published without Business Verification.
7. Instagram + Pages + Threads use cases coexist in one app (Threads + Pages is documented as compatible [DEV-CREATE]; the Instagram use case and a Marketing API use case in the same app are not).
8. Fetcher behaviour for `image_url`: User-Agent, redirects, `Content-Type`, robots.txt, Cloudflare bot features.
9. Stories count against the 50/100 quota.
10. Stories for Creator accounts on the Unified Login setup (documented restriction is on the Facebook Login page).
11. Whether a refresh returns a new token string (Instagram Login and Threads).
12. 3:4 feed images via the API (documented as not allowed).
13. Exact Instagram and Business Suite menu labels in checklist steps 1 to 3.
14. Launch date and maturity of Unified Login (absent from the changelog).

---

## 13. Sources

All `developers.facebook.com/documentation/...` pages were fetched as Meta's own markdown (`<url>.md`) on 2026-11-22; none carries a publication date. Pages marked "summary" were read through a summarising fetch tool. Keys with "path not recorded" were fetched the same way but the exact URL was not kept; the local dump name is given (directory `research/raw/`).

Instagram Platform
- [IG-OV] https://developers.facebook.com/documentation/instagram-platform/overview
- [IG-CP] https://developers.facebook.com/documentation/instagram-platform/content-publishing
- [IG-MEDIA] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
- [IG-PUB] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish
- [IG-CPL] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- [IG-CONT] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container
- [IG-USER] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
- [IG-MEDIAOBJ] https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
- [IG-ERR] https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes
- [IG-REVIEW] https://developers.facebook.com/documentation/instagram-platform/app-review
- [IG-CHLOG] https://developers.facebook.com/documentation/instagram-platform/changelog (dated entries; newest 2026-07-30)
- [IG-CREATE] https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app
- [UL-IDX] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
- [UL-START] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
- [UL-AUTH] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
- [UL-PERM] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions
- [UL-ELIG] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting
- [UL-MIG] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/migration
- [IGL-IDX] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- [IGL-START] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
- [IGL-BL] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- [IGL-MIG] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide
- [IGL-TOKEN] https://developers.facebook.com/documentation/instagram-platform/reference/access_token
- [IGL-REFRESH] https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token
- [FBL-IDX] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login
- [FBL-START] https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started

Login, tokens, app platform
- [FL4B] https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- [FB-TOK] https://developers.facebook.com/documentation/facebook-login/guides/access-tokens
- [FB-LL] https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived
- [FB-AVD] https://developers.facebook.com/documentation/facebook-login/auth-vs-data ("Authentication Versus Data Access"; URL recovered by verifier 2026-11-22)
- [FB-DBG] https://developers.facebook.com/docs/facebook-login/access-tokens/debugging-and-error-handling (summary)
- [SYS] https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens (summary; served in Spanish) and https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser (summary)
- [DEV-LEVELS] https://developers.facebook.com/documentation/development/graph-api/overview/access-levels
- [DEV-MODES] https://developers.facebook.com/documentation/development/build-and-test/app-modes
- [DEV-BV] https://developers.facebook.com/documentation/development/release/business-verification
- [DEV-REL] https://developers.facebook.com/documentation/development/release ("Publish"; URL recovered by verifier 2026-11-22)
- [DEV-STATES] https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/app-states ("App States"; URL recovered by verifier 2026-11-22)
- [DEV-CREATE] https://developers.facebook.com/documentation/development/create-an-app (use-case compatibility; "Use cases cannot be removed"; added by verifier)
- [DEV-PGUC] https://developers.facebook.com/documentation/development/create-an-app/pages-use-case (added by verifier)
- [DEV-MAPI-UC] https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases (added by verifier)
- [MAPI-AUTH] https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization (Marketing API Access Tier, system-user counts; added by verifier)
- [DEV-IGUC] https://developers.facebook.com/documentation/development/create-an-app/instagram-use-case
- [DEV-IGAPIS] https://developers.facebook.com/documentation/development/create-an-app/other-app-types/instagram-apis
- [DEV-S2S] https://developers.facebook.com/documentation/development/create-an-app/server-to-server-apps

Graph API
- [GAPI-CHLOG] https://developers.facebook.com/documentation/development/graph-api/changelog (dated)
- [GAPI-27] https://developers.facebook.com/documentation/development/graph-api/changelog/version27.0 (2026-11-04)
- [GAPI-26] https://developers.facebook.com/documentation/development/graph-api/changelog/version26.0 (2026-07-29)
- [GAPI-ERR] https://developers.facebook.com/docs/graph-api/guides/error-handling (summary)
- [GAPI-RATE] https://developers.facebook.com/docs/graph-api/overview/rate-limiting (summary)
- [GAPI-DEBUG] https://developers.facebook.com/docs/graph-api/reference/debug_token/ (summary, v27.0)
- [GAPI-SECURE] https://developers.facebook.com/docs/graph-api/guides/secure-requests (summary)
- [GAPI-PAGE] https://developers.facebook.com/docs/graph-api/reference/page/ (summary)
- [GAPI-PHOTOS] https://developers.facebook.com/docs/graph-api/reference/page/photos/ (summary, v27.0)
- [GAPI-EXPLORER] https://developers.facebook.com/docs/graph-api/guides/explorer (summary)
- [CRAWL] https://developers.facebook.com/docs/sharing/webmasters/web-crawlers (summary)

Pages API
- [PG-POSTS] https://developers.facebook.com/documentation/pages-api/posts
- [PG-OV] https://developers.facebook.com/documentation/pages-api/overview
- [PG-START] https://developers.facebook.com/documentation/pages-api/getting-started
- [PG-MANAGE] https://developers.facebook.com/documentation/pages-api/manage-pages ("Manage a Page"; URL recovered by verifier 2026-11-22)
- [PG-ERR] https://developers.facebook.com/documentation/pages-api/error-codes
- [PG-APP] https://developers.facebook.com/documentation/pages-api/create-an-app

Threads API
- [TH-OV] https://developers.facebook.com/documentation/threads/overview
- [TH-START] https://developers.facebook.com/documentation/threads/get-started
- [TH-TOK] https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions
- [TH-LL] https://developers.facebook.com/documentation/threads/get-started/long-lived-tokens
- [TH-APP] https://developers.facebook.com/documentation/threads/get-started/create-an-app
- [TH-APPTOK] https://developers.facebook.com/documentation/threads/get-started/app-access-tokens
- [TH-POSTS] https://developers.facebook.com/documentation/threads/posts and https://developers.facebook.com/documentation/threads/create-posts
- [TH-REFPUB] https://developers.facebook.com/documentation/threads/reference/publishing
- [TH-TROUBLE] https://developers.facebook.com/documentation/threads/troubleshooting
- [TH-PROFILE] https://developers.facebook.com/documentation/threads/threads-profiles
- [TH-CHLOG] https://developers.facebook.com/documentation/threads/changelog (dated)
- [TH-SHAREIG] https://developers.facebook.com/documentation/threads/create-posts/share-to-ig-stories
- [TH-DEBUG] https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token ("Debug access token"; URL recovered by verifier 2026-11-22)

Non-Meta
- [CF-FB] https://developers.cloudflare.com/waf/troubleshooting/facebook-sharing/ (dateModified 2026-05-05; summary)
- [3P-AYR] https://www.ayrshare.com/docs/help-center/technical-support/meta-media-crawler-blocked (third party, undated)
- [3P-BF] https://help.buildfire.com/how-to-generate-a-meta-system-user-access-token-for-instagram (third party, undated; describes a non-expiring system-user token for Instagram with `instagram_basic`, `pages_show_list`, `pages_read_engagement`, read-only use)

Not obtainable: `https://help.instagram.com/1631821640426723` (Instagram Help Center image-size article) returned no article text.

---

## Independent verification (2026-11-22)

Second-pass check by a separate verifier whose brief was to refute the decision-critical claims. Every page below was re-fetched on 2026-11-22, independently of the first researcher's dumps.

Method:

- **Raw**: Meta's own markdown rendering (`<doc URL>.md`, fetched with curl). The pages a verdict rests on were read in full; the long changelogs and a few supporting pages (app roles, Pages overview and getting-started, server-to-server apps, Threads profiles) were searched for the relevant passages only. Used for every `developers.facebook.com/documentation/...` page and for the Cloudflare page (`.../index.md`).
- **Summary**: legacy `developers.facebook.com/docs/...` pages are not served as markdown and block curl; they were read through a summarising fetch tool and were served in Spanish. Quotes from them are translations and are marked [V*] in the body.
- **Live probe**: unauthenticated requests to the API hosts, to confirm that hosts, version and endpoints exist and to see real error shapes. No token was available, so **no publishing call was executed**. Nothing in this document has been proven by an actual post.

Meta's pages carry no publication date; "confirmed" means "this is what the page said on 2026-11-22".

### A. The ten flagged claims

| # | Claim | Verdict | Evidence opened |
|---|---|---|---|
| 1 | Instagram publishing accepts only JPEG, max 8 MB, feed ratio 4:5 to 1.91:1; 3:4 and PNG rejected | **CONFIRMED (documentation level)** | Raw: content-publishing ("JPEG is the only image format supported. Extended JPEG formats such as MPO and JPS are not supported."); ig-user/media ("Format: JPEG / File size: 8 MB maximum / Aspect ratio: Must be within a 4:5 to 1.91:1 range / Minimum width: 320 / Maximum width: 1440"); error-codes (`36001`/`2207005` format, `36000`/`2207004` "less than 8 MiB", `36003`/`2207009` "4:5 to 1.91:1 range"). 3:4 is 0.75, below 0.8, so it is outside the documented range. Not live-tested. A web search found third-party reports of the same app/API mismatch and none of the API accepting 3:4. Story images have no hard ratio rule, only "We recommended 9:16". |
| 2 | Own-account app needs no App Review and no Business Verification; Standard Access plus a role/tester relationship is enough for live, publicly visible posts | **CONFIRMED for review and verification; visibility is split** | Raw: overview ("If your app only serves your Instagram professional account or an account you manage, Standard Access is all your app needs."); app-review (table: own business, Standard Access, "Not required"); access-levels; business-verification ("you do not need to complete verification"); release ("you do not need to complete any of these processes"). Visibility: app-modes says "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users", so the **Facebook Page** leg needs the app published (third party agrees: Postiz docs, "posts made via the API will display for yourself but will not be visible for other users"). For **Instagram and Threads** no Meta page says whether Development-mode posts are public: STILL UNCERTAIN, test logged out. The contradicting sentences on create-an-instagram-app (Step 2 and Step 10) are still on that page. |
| 3 | A non-expiring system-user token with `instagram_basic` + `instagram_content_publish` publishes feed posts and Stories on `graph.facebook.com` without refresh | **PARTLY CONFIRMED, core still UNCERTAIN, scope list CORRECTED** | Confirmed raw: access-tokens (system-user tokens "do not expire based on time"); facebook-login-for-business (Business Integration System User tokens: "Defaults to **never expire**"; table marks `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `business_management` as available); content-publishing (Unified Login token type is "Business Integration System User access token"). Confirmed by summary: the system-user guide lists `instagram_basic`, `instagram_content_publish`, `ads_read`, `pages_*`, `business_management` as supported scopes and "never expires" tokens. **Not confirmed anywhere**: that a *Business Settings* system-user token is accepted by `/media` and `/media_publish` (the Facebook Login column says "Facebook Page access token" in the guide and "User" in the references). Corrected in 5.2: add `ads_read`; the "standard access" precondition is the Marketing API Access Tier. |
| 4 | Flow is `POST /{ig-id}/media`, poll `GET /{container-id}?fields=status_code` until `FINISHED`, `POST /{ig-id}/media_publish` with `creation_id`; same on both hosts; Story is the same call with `media_type=STORIES` | **CONFIRMED** | Raw: content-publishing (endpoint list, `<HOST_URL>` examples, "Story posts": "include the `media_type` parameter set to `STORIES`"); ig-container (five `status_code` values); media_publish (`creation_id`, `config_issue`); migration-guide ("Publish content: `POST graph.instagram.com/{ig-user-id}/media` -> `POST graph.facebook.com/{ig-user-id}/media`", "Most request bodies stay the same"). Meta's polling advice is "once per minute, for no more than 5 minutes"; the reference code polls faster, which is harmless for a still image and costs at most 15 calls. |
| 5 | Stories via API only for Business accounts, not Creator; no link stickers | **CONFIRMED** | Raw: instagram-api-with-facebook-login ("Content Publishing is available to all Instagram Professional accounts, except Stories, which are only available to business accounts."); ig-user/media ("Publishing stickers (i.e., link, poll, location) is not supported"). The Business-only sentence exists only on the Facebook Login page; nothing lifts it for Unified Login. |
| 6 | New apps cannot set up Instagram API with Instagram Login | **CONFIRMED, with an unresolved contradiction inside Meta's docs** | Raw: migration-guide ("**New apps.** Newly created apps can't set up the Instagram API with Instagram Login."). Still contradicted by create-an-instagram-app and other-app-types/instagram-apis ("API setup with Instagram login is automatically added") and instagram-use-case (lists both setups). Treat Route C as possibly unavailable, as the document already does. |
| 7 | Page photo via `POST /{page-id}/photos` with `url` + `caption`, Page token obtainable from the system-user token, public only when the app is Live | **CONFIRMED except the token derivation, which is UNCERTAIN** | Raw: pages-api/posts (endpoint, `url`, response `id` + `post_id`); app-modes (visibility); manage-pages ("If using a business system user in your API requests, the `business_management` permission is required."). Summary: page/photos reference v27.0 (`caption`; `message` and `name` deprecated; 4 MB; `pages_read_engagement`, `pages_manage_posts`, `pages_show_list`; Page token with `CREATE_CONTENT`). The Page `access_token` field is documented as "Only returned if the User making the request has a role ... on the Page"; that a system user qualifies is common practice but not written down. |
| 8 | Threads tokens always expire after 60 days; refresh via `graph.threads.com/refresh_access_token`, token at least 24 h old; no non-expiring token | **CONFIRMED** | Raw: threads/get-started/long-lived-tokens (60 days; "at least 24 hours old but have not expired"; `grant_type=th_refresh_token`; 90-day permission grant extended on refresh "only if the user has a public profile"); get-started; get-access-tokens-and-permissions. No token page offers a non-expiring token. Live probe: `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=x` returns code `190` "Cannot parse access token", so the endpoint exists on that host; `graph.threads.net` answers too. |
| 9 | Meta fetches `image_url` server-side at container creation; image must be public without bot challenges; Cloudflare bot/WAF features can cause `9004`/`2207052` | **CONFIRMED for the fetch and the error code; the Cloudflare causation is third-party** | Raw: content-publishing ("We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server at the time of the attempt."); error-codes (`9004`/`2207052` "The media could not be fetched from this uri"); Cloudflare facebook-sharing (dateModified 2026-05-05: not blocked by default; Under Attack mode, custom rules, country challenges; skip rule for `AS32934` and `AS63293`). The user agent of the publishing fetcher and any Bot Fight Mode interaction are documented only by a third party (Ayrshare, undated). Meta's crawler page (summary) confirms the `facebookexternalhit/1.1` string and the `Range: bytes=0-524288` test, but does not mention content publishing. |
| 10 | Publishing quota (50 or 100 per 24 h) and rate limits are far above a few posts per weekday | **CONFIRMED** | Raw: content-publishing (100); media_publish and content_publishing_limit (50); ig-user/media (400 containers per 24 h); overview ("Calls within 24 hours = 4800 * Number of Impressions"). Caveat added to section 4: no minimum is documented for the Instagram or Pages formula (Threads documents a floor of 10 impressions). For an established account this is irrelevant; for a brand-new or dormant account it is unknown. |

### B. Other statements checked (chosen as most likely to be wrong or stale)

| Statement in this document | Verdict | Evidence |
|---|---|---|
| Graph API v27.0 is current, released 2026-11-04; version end dates in 1.4 | **CONFIRMED** | Raw: graph-api/changelog table (v27.0 2026-11-04 TBD; v25.0 until 2028-07-29; v24.0 until 2028-02-18; v23.0 until 2027-10-08; v22.0 until 2027-05-20; v21.0 until 2027-01-21). Live probe: `GET https://graph.facebook.com/v27.0/me` answers with header `facebook-api-version: v27.0`; `v28.0` is rejected ("Unknown path components"). |
| Threads endpoints, hosts, limits and image specs (section 7) | **CONFIRMED** | Raw: threads overview, posts, reference/publishing, troubleshooting, debug-access-token, app-access-tokens, changelog, share-to-ig-stories. `https://threads.com/oauth/authorize`, `POST https://graph.threads.com/oauth/access_token`, `th_exchange_token`, `media_type=IMAGE`, `threads_publish` with `creation_id`, 250 posts per 24 h, 500 characters, JPEG and PNG, 8 MB, `link_attachment` "Can only be used for `media_type=TEXT` posts", 5-link limit since 2025-12-22, `TH\|<id>\|<secret>` app token: all as written. |
| "Whether the Threads use case can live in the same app as the ... Pages use cases is not stated" (7.1) | **CORRECTED** | Raw: development/create-an-app names exactly this pair as compatible. Same page: "Use cases cannot be removed after you create your app." Instagram in the same app remains unstated. |
| Route A scope list and its Marketing API caveat (5.2) | **CORRECTED** | `ads_read` or `ads_management` is required when the Page role comes through Business Manager (raw: ig-user/media, media_publish), which is always the case for a system user. The "standard access" precondition (summary, Spanish: "Para crear un token de acceso de usuario del sistema, esta app debe contar con acceso estándar") maps to Marketing API Access Tier "Limited access", "Automatically granted when you add the Marketing API product to your app"; "Can create 1 system user and 1 admin system user" (raw: marketing-api/get-started/authorization). |
| "the Instagram references name a User token" as a reason against Page tokens (5.2) | **CORRECTED** | Raw: content-publishing requirements table lists "Facebook Page access token" for the Facebook Login setup. |
| v26.0: "invalid `date_format` errors" (1.4) | **CORRECTED** | Raw: changelog/version26.0: "Requests that include `date_format` return an error." |
| Quote "Standard Access is all your app needs" attributed to the App Review page (1.3) | **CORRECTED (attribution only)** | The sentence is on the overview page. |
| Page-photo error list attributed to the Pages API error page; "`is_transient` ... otherwise do not" retry rule (6, 9.2) | **CORRECTED** | Raw: pages-api/error-codes contains none of those codes. Summary: page/photos reference and graph error-handling page do. `is_transient` is not described on the error-handling page. |
| Instagram Login OAuth endpoints and refresh (Route C) | **CONFIRMED** | Raw: business-login (`https://www.instagram.com/oauth/authorize`, `POST https://api.instagram.com/oauth/access_token`, code valid 1 hour, strip `#_`); reference/access_token (`ig_exchange_token`); reference/refresh_access_token (`ig_refresh_token`, at least 24 hours old, 60 days). |
| Changelog dates in 1.4 | **CONFIRMED** | Raw: instagram-platform/changelog headings for 2024-12-04, 2025-01-21, 2025-03-24, 2025-06-14, 2025-12-03 (Delete Instagram Media, `instagram_manage_contents`), 2026-02-06 (`enable_fb_login`), 2026-06-22 (`is_ai_generated`); newest entry 2026-07-30; no entry mentions Unified Login. The 2025-07-09 `user_tags` date comes from the banner on ig-user/media, not from the changelog. |
| App publish requirements and Website platform for a server-only app (6); Threads Tester path (7.1) | **CONFIRMED, one addition** | Raw: pages-api/create-an-app and threads/get-started/create-an-app (icon 512 to 1024 px under 5 MB, Privacy Policy URL, data deletion URL, **Publish** in the left menu); server-to-server-apps ("set this to Website"); threads/get-started (Threads Tester). Addition from app-roles: "If your app is connected to a business portfolio, you must use the Business Manager to manage roles for your app", so Administrator/Developer/Tester roles for a portfolio-owned app are managed in Business settings, not in the App Dashboard Roles panel. Whether that also moves the Instagram Tester and Threads Tester invitations is not stated [U]. |
| `debug_token` syntax and fields; data-access expiry list; inactive-app rule (5.1, 5.3) | **CONFIRMED** | Summary: debug_token reference v27.0 (fields as listed; the page does not say what `expires_at: 0` means, as the document already notes). Raw: auth-vs-data (90 days; exempt list contains the `pages_*` scopes and `business_management`, not the `instagram_*` ones); app-states (90 days without logins, API calls or webhooks; "All access tokens associated with the app will be invalidated"). |

### C. Still uncertain after verification (smoke-test before building on them)

1. **Route A end to end.** Whether `POST /{ig-id}/media` accepts a Business Settings system-user token under Standard Access, and if not, whether the Page token derived from it is accepted. Nothing but a real call settles this.
2. **Whether Business Settings will issue the token** for an app without the Marketing API product, and whether a Marketing API use case can be added next to the Instagram, Pages and Threads use cases.
3. **Unified Login dashboard token** (Route B): whether "Generate token" yields a never-expiring token (the step is called a *test* access token), and whether the single-portfolio owner case works given "This needs to be separate from the business portfolio owned by your business client" [FL4B].
4. **Public visibility of Instagram and Threads posts made by an unpublished app.** Undocumented. The Facebook Page leg is documented as role-users-only until the app is Live.
5. **Whether the app can be published without Business Verification** (create-an-instagram-app says no; the release and business-verification pages say role-only apps need none of it).
6. **`GET /{page-id}?fields=access_token` with a system-user token**, and `instagram_business_account` discovery with it (the Page reference says that field "requires a User access token").
7. **Fetcher behaviour for `image_url`**: user agent, redirects, `Content-Type` sensitivity, robots.txt, Cloudflare Bot Fight Mode. Only third-party statements exist.
8. **3:4 and PNG rejection in practice.** Documented, not exercised.
9. **Stories for Creator accounts under Unified Login**, and whether a Story counts against the 50/100 quota.
10. **Rate-limit floor** for an Instagram account or Page with near-zero impressions or engaged users.
11. The legacy system-user pages could only be read as machine summaries of the Spanish rendering; their exact English wording was not seen.

Suggested order for the smoke test, cheapest first: `debug_token` on the issued token (expect `expires_at: 0`, scopes present) -> `GET /{ig-id}?fields=username` -> `GET /{ig-id}/content_publishing_limit?fields=quota_usage,config` -> one feed post -> open its `permalink` logged out -> one Story -> Page photo -> open it logged out. Items 1, 3, 4 and 6 are answered by that sequence.

### D. Pages opened by the verifier

Raw (curl, `<URL>.md`), all under `https://developers.facebook.com/documentation/`:
`instagram-platform/overview`, `.../content-publishing`, `.../instagram-graph-api/reference/ig-user`, `.../ig-user/media`, `.../ig-user/media_publish`, `.../ig-user/content_publishing_limit`, `.../ig-user/stories`, `.../reference/ig-container`, `.../reference/error-codes`, `instagram-platform/reference/instagram-media`, `.../reference/access_token`, `.../reference/refresh_access_token`, `instagram-platform/app-review`, `.../changelog`, `.../create-an-instagram-app`, `.../instagram-api-with-unified-login` (+ `/get-started`, `/authentication`, `/permissions`, `/eligibility-and-troubleshooting`, `/migration`, `/business-onboarding`), `.../instagram-api-with-instagram-login` (+ `/get-started`, `/business-login`, `/migration-guide`), `.../instagram-api-with-facebook-login` (+ `/get-started`), `facebook-login/facebook-login-for-business`, `facebook-login/guides/access-tokens`, `.../access-tokens/get-long-lived`, `facebook-login/auth-vs-data`, `development/graph-api/overview/access-levels`, `development/build-and-test/app-modes`, `development/build-and-test/app-roles`, `development/release`, `development/release/business-verification`, `development/create-an-app` (+ `/instagram-use-case`, `/pages-use-case`, `/threads-use-case`, `/marketing-api-use-cases`, `/other-app-types/instagram-apis`, `/server-to-server-apps`, `/app-dashboard/app-states`, `/app-dashboard/app-types`), `development/graph-api/changelog` (+ `/version26.0`, `/version27.0`), `pages-api/posts`, `pages-api/manage-pages`, `pages-api/overview`, `pages-api/getting-started`, `pages-api/error-codes`, `pages-api/create-an-app`, `threads/overview`, `threads/get-started` (+ `/get-access-tokens-and-permissions`, `/long-lived-tokens`, `/create-an-app`, `/app-access-tokens`), `threads/posts`, `threads/create-posts`, `threads/create-posts/share-to-ig-stories`, `threads/reference/publishing`, `threads/troubleshooting`, `threads/troubleshooting/debug-access-token`, `threads/threads-profiles`, `threads/changelog`, `ads-commerce/marketing-api/get-started/authorization`.

Raw, non-Meta: `https://developers.cloudflare.com/waf/troubleshooting/facebook-sharing/index.md` (dateModified 2026-05-05).

Summary (fetch tool; Meta served Spanish): `https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens`, `https://developers.facebook.com/docs/marketing-api/system-users/overview`, `https://developers.facebook.com/docs/graph-api/reference/page/photos/`, `https://developers.facebook.com/docs/graph-api/reference/page/`, `https://developers.facebook.com/docs/graph-api/reference/debug_token/`, `https://developers.facebook.com/docs/graph-api/overview/rate-limiting`, `https://developers.facebook.com/docs/graph-api/guides/error-handling`, `https://developers.facebook.com/docs/sharing/webmasters/web-crawlers`.

Third party (undated, lower weight): `https://www.ayrshare.com/docs/help-center/technical-support/meta-media-crawler-blocked`, `https://docs.postiz.com/self-host/providers/facebook`.

Live probes (unauthenticated, 2026-11-22): `graph.facebook.com/v27.0/me`, `graph.facebook.com/v28.0/me`, `graph.instagram.com/v27.0/me`, `graph.threads.com/v1.0/me`, `graph.threads.net/v1.0/me`, `graph.instagram.com/refresh_access_token`, `graph.threads.com/refresh_access_token`, `graph.threads.com/v1.0/debug_token`.

Not applicable: this document makes no Pulumi claims, so nothing was checked against the provider schema.
