# Bluelytics legacy repos — git history + secrets audit

Audit date: 2026-11-22. Scope: `/home/sicarul/dev/bluelytics/{blueimg,bluelytics_api,bluelytics_frontend,bluelytics_mobile_v3,bluescraper}` (git repos) and `{bluelytics_database,bluelytics_notifiy,bluelytics_vpn}` (plain directories).
Purpose: decide how to unify everything into `/home/sicarul/dev/bluelytics/bluelytics_v2` while preserving history **without carrying secrets**.

No secret VALUE appears anywhere in this document. Key names, file paths, git object ids and lengths only.

---

## 1. Verdict (read this first)

1. **All five repos can be imported with full history.** No live credential was ever committed on any importable branch. Every high-entropy secret found on disk (AWS key, Postgres password, Buffer token, Open Exchange Rates key, Firebase Admin SDK private key, Meta app secret/token, VPN keys) was checked **by value** against every object (reachable and dangling) of all five object databases: zero matches.
2. **One real trap exists: `bluelytics_mobile_v3/.git` holds a 436 MB Gradle heap dump** (`android/java_pid7522.hprof`, blob `d539d0b9151a62179e983743c9aefc950489b191`) reachable only through the leftover `refs/original/refs/heads/master` from a 2020 `git filter-branch`. The dump contains the property names `BLUELYTICS_UPLOAD_STORE_PASSWORD` and `BLUELYTICS_UPLOAD_KEY_PASSWORD` 117 times each, so the Android upload-keystore passwords are almost certainly inside it in clear text. It is **not** on `master` and was **never pushed**. It gets carried along only if you clone with `--mirror`, or import from a plain local (hardlink) clone and then copy that `.git`. The recipe below uses `git clone --no-local --single-branch`, which was verified to exclude it.
3. **The secrets that matter are plain files on disk**, untracked and gitignored, mode 0644: `bluescraper/.env`, `bluescraper/test.py`, `bluescraper/bluelytics-mobile-firebase-adminsdk.json`, plus all of `bluelytics_vpn/`. They must never be copied into the new repo and should be rotated (checklist in section 9).
4. **Recommended import method:** `git subtree add --prefix=legacy/<name>` from throwaway `--no-local` clones. Validated end to end in a scratch directory: 191 commits, 230 tracked files, 5.7 MB `.git`, original commit SHAs preserved, both scanners clean apart from two known non-secrets.
5. **`git filter-repo` is not installed** and is not needed for the recommended path.

---

## 2. Method and tooling

| Item | Result |
|---|---|
| git | 2.56.1, `git subtree` available (`/usr/lib/git-core/git-subtree`), `init.defaultBranch=main` |
| `git filter-repo --version` | **Not installed** (`git: 'filter-repo' is not a git command`). Available as `extra/git-filter-repo 2.47.0-3` (`sudo pacman -S git-filter-repo`) or without installing via `uvx git-filter-repo …` (`/usr/bin/uvx` exists). |
| gitleaks / trufflehog binaries | Not installed. |
| docker | Works without sudo. Used `ghcr.io/gitleaks/gitleaks:latest` (v8.30.1), repos mounted `:ro`, `--network none`, `--redact=100`. The image is still in the local Docker cache. |
| `bluelytics_v2` | Does not exist yet. |

What was run:

- Path audit: the task's `git log --all --diff-filter=A --name-only` grep, plus a stricter union of `git ls-tree -r` over every commit of every ref (catches renames that `--diff-filter=A` misses, e.g. `src/openexchange*.py`).
- Content audit: `git log --all -p` filtered by credential regexes, output passed through a redactor that masks every quoted string, every value after `=`/`:` and every token of 16+ characters.
- **By-value audit**: a script read each secret from the on-disk files (37 needles: every `.env` value, the three literals in `test.py`, service-account `private_key_id` / `client_email` / `client_id` / two private-key lines, two base64 lines of each VPN file, the VPN remote host, the `--add-host` value) and searched for them in every blob and commit returned by `git cat-file --batch-all-objects` in each repo (including dangling objects and the 436 MB heap dump). It prints names and counts only.
- gitleaks `git` mode on all refs of each repo, and gitleaks `dir` mode on the on-disk directories.
- A full dry run of the import recipe into a scratch directory, re-scanned with both methods, then deleted.

Not executed: any `git filter-repo` command (tool absent; fetching the standalone script for a dry run was blocked by this session's permission policy). The filter-repo invocations in section 7.3 are written from its documented flags and are untested here. Equivalent built-in `git filter-branch` variants **were** tested and are given next to them.

Originals were treated as read-only. HEAD, ref lists and `git status --porcelain` were identical before and after. The only possible side effect is git's opportunistic index stat-cache refresh from `git status`; the recipe sets `GIT_OPTIONAL_LOCKS=0` to avoid even that.

---

## 3. Per-repo inventory

### 3.1 Summary

| | blueimg | bluelytics_api | bluelytics_frontend | bluelytics_mobile_v3 | bluescraper |
|---|---|---|---|---|---|
| Default (checked-out) branch | `master` | `main` | `master` | `master` | `master` |
| Local branches | master | main | master, `material` (b5ced90, 2015-04-02, fully merged into master) | master | master |
| Other refs | origin/master | origin/main | origin/master | origin/master, **`refs/original/refs/heads/master`** (f4f128b) | origin/master |
| Tags | none | none | none | none | none |
| Commits (all refs / HEAD) | 8 / 8 | 8 / 8 | 69 / 69 | **54 / 53** | 45 / 45 |
| Merge commits / roots | 0 / 1 | 0 / 1 | 3 / 1 | 0 / **2** | 1 / 1 |
| First commit | 2014-06-18 `5843c0a` | 2021-04-29 `1bdcc56` | 2014-10-13 `589f71a` | 2020-05-19 `eaccb15` | 2014-02-06 `f020fb0` |
| Last commit | 2020-05-03 `3b0376d` | 2023-11-03 `555cf09` | 2023-12-19 `67687eb` | 2023-12-19 `ca2cf88` | 2024-09-03 `85fb03e` |
| Authors (names) | Pablo Seibelt (5), Pablo Seibelt (Sicarul) (3) | Pablo Seibelt (8) | Pablo Seibelt (52), Pablo Seibelt (Sicarul) (17) | Pablo Seibelt (54) | Pablo Seibelt (39), Pablo Seibelt (Sicarul) (6) |
| Author e-mail domains | gmail.com, sicarul.com | gmail.com | gmail.com, sicarul.com | gmail.com, sicarul.com | gmail.com, sicarul.com, **auth0.com** (2 commits, 2018-11-29: `a0e7cb1`, `3252642`) |
| Remote `origin` | `git@github.com:sicarul/blueimg.git` | `git@github.com:Bluelytics/bluelytics_api.git` | `git@github.com:sicarul/bluelytics_frontend.git` (redirects to `Bluelytics/bluelytics_frontend`) | `git@github.com:sicarul/bluelytics_mobile_v3.git` | `git@github.com:Bluelytics/bluescraper.git` |
| GitHub visibility (anonymous HTTP) | public (200) | public (200) | public (301 then 200) | **private or missing (404)** | public (200) |
| Local HEAD == remote HEAD | yes | yes | yes (remote also has 16 unmerged `dependabot/*` branches and 36 PR refs) | not checkable anonymously; local `origin/master` == `master` | yes |
| Working tree | untracked: `template_ig_story.html` | clean | clean | modified unstaged: `android/build.gradle`; staged: `package.json`, `package-lock.json` | clean |
| Ignored files on disk | `bin/ include/ lib/ local/` (virtualenv, 17 MB), `out/` (3 PNGs, 5.5 MB), `out.html`, `out_ig.html` | none (`.gitignore` lists `docker_run.sh run_local.sh update_docker.sh main`, none exist) | `node_modules/` 161 MB, `bower_components/` 21 MB, `.tmp/` 4.0 MB, `.sass-cache/` 3.5 MB, `dist/` 2.0 MB, `app/scripts/views/templates.js` | `node_modules/` 613 MB, `android/` build output (dir is 1.2 GB), `.gradle/ .idea/ android/.gradle/ android/.idea/ android/local.properties *.iml` | **`.env`, `test.py`, `docker_run.sh`, `bluelytics-mobile-firebase-adminsdk.json`**, `src/__pycache__/`, empty `test/` |
| Tracked files at HEAD | 22 | 10 | 81 | 111 | 33 |
| Tracked size at HEAD (bytes) | 1,047,237 | 25,078 | 690,813 | 3,033,715 | 850,901 |
| Unique blobs in all history (count / bytes) | 37 / 1,064,834 | 21 / 51,040 | 404 / 2,513,056 | 265 / **444,825,145** | 128 / 987,099 |
| `.git` size on disk | 528 K | **8.1 M** | 1.5 M | **142 M** | 1.1 M |
| `.git` size of a clean `--no-local --single-branch` clone | 432 K | 124 K | 604 K | 2.0 M | 368 K |
| LICENSE | none | none | **AGPL-3.0** (`LICENSE`, blob `dba13ed2`) | none | **AGPL-3.0** (same blob) |
| Stashes | 0 | 0 | 0 | 0 | 0 |

Why two `.git` directories are oversized:

- `bluelytics_api/.git` (8.1 M for 51 KB of history): a **dangling 15,275,610-byte ELF binary** (blob `fe28e348669bc954b27e010749e388c5265ddfcb`, the compiled Go `main`, staged once and never committed). Unreachable; not transferred by `--no-local` clones.
- `bluelytics_mobile_v3/.git` (142 M): the heap dump blob, 142,940,652 bytes compressed as a loose object. See section 5.

Other unreachable objects (all harmless, none carried by the recipe): mobile has 5 reflog-only commits (amended versions of "Fix touchable", "Remove tax calculation", "remove http", "Updated podfile", "Switch to https") and 12 small blobs (manifests, package.json, lockfiles); bluescraper has one unreachable commit `bb932d8` ("Readd la nacion", superseded) and a 226-byte conflicted `bluescraper.sh`.

### 3.2 Fifteen largest blobs in history

Command: `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sort -k3 -n -r | head -15` (blobs only).

**blueimg**

| bytes | blob | path |
|---:|---|---|
| 245,960 | 6bc5a2dc75 | css/bootstrap.css.map |
| 124,009 | c8eb136c4e | fonts/gtwalsheim.svg |
| 121,220 | 7f36651961 | css/bootstrap.css |
| 99,961 | 679272d258 | css/bootstrap.min.css |
| 62,927 | e3e2dc739d | fonts/glyphicons-halflings-regular.svg |
| 55,258 | 8ae571b6da | js/bootstrap.js |
| 55,104 | 365533d7b2 | fonts/gtwalsheim.eot |
| 54,856 | fa2166e918 | fonts/gtwalsheim.ttf |
| 41,280 | 67fa00bf83 | fonts/glyphicons-halflings-regular.ttf |
| 38,388 | b36fc9a497 | css/bootstrap-theme.css.map |
| 29,110 | b04a0e82ff | js/bootstrap.min.js |
| 26,160 | 017b60bf9b | fonts/gtwalsheim.woff |
| 23,320 | 8c54182aa5 | fonts/glyphicons-halflings-regular.woff |
| 20,335 | 4a4ca865d6 | fonts/glyphicons-halflings-regular.eot |
| 16,864 | 44586dccce | img/logo.png |

**bluelytics_api**

| bytes | blob | path |
|---:|---|---|
| 13,850 | 0a1275726c | go.sum |
| 5,948 | 140f029a54 | v2.go |
| 5,948 | 119cafa68f | v2.go |
| 5,756 | e81149b282 | v2.go |
| 4,208 | 766c76f19f | v2.go |
| 1,893 | 82d20dabc1 | evolution.go |
| 1,893 | 2072c0f005 | evolution.go |
| 1,746 | c88bf9553f | evolution.go |
| 1,710 | 77e6a137a3 | evolution.go |
| 1,199 | 82298eb724 | evolution.go |
| 1,006 | 03d68de854 | server.go |
| 925 | d2635cbc6e | server.go |
| 919 | 225071d4a1 | server.go |
| 872 | fc8aa543ba | v1.go |
| 833 | a7bbd3e5bf | server.go |

**bluelytics_frontend**

| bytes | blob | path |
|---:|---|---|
| 631,181 | 93ca567b50 | package-lock.json |
| 294,127 | d1c1e53ffb | package-lock.json |
| 40,898 | 9050b24077 | app/images/material-design/action-icons.svg |
| 40,241 | e70932983b | app/images/material-design/image-icons.svg |
| 36,281 | 054e2de19c | app/images/loading.gif |
| 34,520 | dba13ed2dd | LICENSE |
| 24,139 | cb84cb918f | app/.htaccess |
| 17,579 | 70b90b6c21 | app/images/material-design/device-icons.svg |
| 17,273 | 0779fb77ff | app/images/mobile-icon-144.png |
| 15,444 | 3dbcba095c | app/index.html |
| 15,393 | c89bc24a8c | app/index.html |
| 15,362 | bc5bfdcaea | app/index.html |
| 14,918 | bcf76deb98 | app/index.html |
| 14,656 | 0a9844187d | app/index.html |
| 14,408 | afecc3740b | app/images/material-design/maps-icons.svg |

**bluelytics_mobile_v3**

| bytes | blob | path |
|---:|---|---|
| **436,602,674** | d539d0b915 | **android/java_pid7522.hprof** (only via `refs/original`) |
| 552,553 | f3af944240 | package-lock.json |
| 546,548 | 9cc8db1666 | android/app/src/main/assets/fonts/MaterialCommunityIcons.ttf |
| 440,394 | 75aa7fe615 | package-lock.json |
| 433,178 | 5cf4802319 | package-lock.json |
| 431,273 | f788c17836 | package-lock.json |
| 428,952 | 8bf7a4b89e | package-lock.json |
| 427,164 | c76fa0e35e | package-lock.json |
| 421,530 | 6fabe27605 | package-lock.json |
| 414,843 | 361e62d420 | package-lock.json |
| 403,289 | 83cfe953a8 | package-lock.json |
| 397,815 | 301ee1e91c | package-lock.json |
| 313,528 | 96e2e81a3d | android/app/src/main/assets/fonts/Fontisto.ttf |
| 186,228 | 7ece3282a4 | android/app/src/main/assets/fonts/FontAwesome5_Solid.ttf |
| 165,548 | 35acda2fa1 | android/app/src/main/assets/fonts/FontAwesome.ttf |

**bluescraper**

| bytes | blob | path |
|---:|---|---|
| 248,314 | 344d26ccb0 | src/weekly_chart/js/d3.v5.min.js |
| 160,403 | 7d2a868f57 | src/weekly_chart/css/bootstrap.min.css |
| 99,961 | 679272d258 | src/alerts/css/bootstrap.min.css |
| 86,658 | bcd3956c82 | src/weekly_chart/js/jquery-3.2.1.min.js |
| 81,084 | 525069deff | src/weekly_chart/js/bootstrap.bundle.min.js |
| 34,520 | dba13ed2dd | LICENSE |
| 31,803 | af20626d85 | src/weekly_chart/js/d3-annotation.min.js |
| 29,110 | b04a0e82ff | src/alerts/js/bootstrap.min.js |
| 16,864 | 44586dccce | src/alerts/img/logo.png |
| 13,185 | ba4bd28ae5 | src/alerts/css/bootstrap-theme.min.css |
| 6,188 | b2e04e69fb | src/updates.py |
| 6,139 | df687c5f85 | src/updates.py |
| 6,100 | fbbb0fb1e2 | src/updates.py |
| 6,051 | 93db0df847 | src/updates.py |
| 6,050 | 6eee41754f | src/updates.py |

### 3.3 Paths that existed in history but not at HEAD

- blueimg: `template_ig.html` (deleted in `3b0376d`).
- bluelytics_frontend: `app/.htaccess`, `app/images/yeoman.png`, forecast and wordcloud controllers/views/specs, `app/scripts/services/valorblue.js`.
- bluelytics_mobile_v3: `android/java_pid7522.hprof` (refs/original only), `.gitattributes`, `ios/bluelytics_mobile_v3/AppDelegate.m`, `Base.lproj/LaunchScreen.xib`, tvOS `Info.plist` files.
- bluescraper: the 2014–2018 CasperJS/PhantomJS era (`bluescrape.js|py`, `ambitoscrape.js|py`, `ofiscrape.js|py`, `elcronistascrape.js|py`, `lanacionscrape.js|py`, `dolarbluenet.js`, `bluescraper.sh`, `currency_names.sh`, `currency_values.sh`, `install_casperjs.sh`, `openexchange.py`, `openexchange_values.py`, `README`) and the 2020 intermediates (`src/ambitoscrape.py`, `src/cronista.py`, `src/lanacionscrape.py`, `src/ofiscrape.py`, `src/alerts/alert_template.html`).

Never committed in any repo: `bower_components/`, `dist/`, `node_modules/`, the blueimg virtualenv (`bin/ lib/ include/ local/`), any `.env`, any service-account JSON, any `.ovpn`/`.key`/`.crt`.

---

## 4. Secrets in history

### 4.1 Sensitive-looking paths ever committed

Task regex applied to `git log --all --diff-filter=A --name-only --format= | sort -u`, extended over the tree union with `test\.py|docker_run|local\.properties|gradle\.properties|\.hprof`:

| Repo | Hits |
|---|---|
| blueimg | none |
| bluelytics_api | none |
| bluelytics_frontend | none |
| bluescraper | none |
| bluelytics_mobile_v3 | `android/app/debug.keystore`, `android/app/google-services.json`, `ios/GoogleService-Info.plist`, `ios/.xcode.env`, `android/gradle.properties`, `android/java_pid7522.hprof` |

### 4.2 Classification of every distinct hit

| Repo | Where | What it is | Class |
|---|---|---|---|
| mobile | `android/java_pid7522.hprof`, commit `f4f128b`, **only reachable from `refs/original/refs/heads/master`** | Gradle daemon heap dump; holds `BLUELYTICS_UPLOAD_STORE_PASSWORD` / `BLUELYTICS_UPLOAD_KEY_PASSWORD` (117 occurrences each), 105k user-home path strings | **REAL SECRET (probable)**. Never import. Section 5. |
| mobile | `android/app/google-services.json:32` (`current_key`), added in `a22853e`; single version in history | Firebase Android client config for project `bluelytics-mobile`, package `com.bluelytics.mobileapp`; Google API key, OAuth client ids, app id | Client-side public config. Ships inside every APK. Restrict the key, do not treat as leak. gitleaks rule `gcp-api-key`. |
| mobile | `ios/GoogleService-Info.plist:11-12` (`API_KEY`); single version | Firebase iOS client config | Client-side public config. |
| mobile | `android/app/debug.keystore` (2,257 bytes, blob `364e105ed39fbfd62001429a68140672b06ec0de`) | Byte-identical to the React Native template keystore (same blob id as `facebook/react-native` v0.62.2 and v0.69.3 `template/android/app/debug.keystore`) | Public, false positive. |
| mobile | `android/app/build.gradle:222-231` | Debug signing block with the template's literal debug password; release block references Gradle properties `BLUELYTICS_UPLOAD_STORE_FILE`, `…_STORE_PASSWORD`, `…_KEY_ALIAS`, `…_KEY_PASSWORD` defined **outside** the repo | False positive (names only). |
| mobile | `android/gradle.properties` (all versions) | `android.useAndroidX`, `android.enableJetifier`, `FLIPPER_VERSION`, `org.gradle.jvmargs`, `reactNativeArchitectures`, `newArchEnabled` | False positive, no signing values. |
| mobile | `ios/.xcode.env` | `export NODE_BINARY=…` | False positive. |
| mobile | `ios/Podfile.lock:764`, commit `01bac98` | Pod checksum flagged by gitleaks `generic-api-key` | False positive. |
| bluescraper | `src/database.py:4-8`, `src/tester.py:4-8` | `os.environ[...]` lookups of `PG_USER`, `PG_PASSWORD`, `PG_HOSTNAME`, `PG_DB` | False positive (env lookups). |
| bluescraper | `src/buffer.py:6,8` | `os.environ['BUFFER_API_KEY']`, `os.environ['SN_PROFILE_<NETWORK>']` | False positive. |
| bluescraper | `src/openexchange_values.py:4`; 2014–2020 versions read a gitignored `.apikey` file | `os.environ['OPENEX_API_KEY']`; URL `https://openexchangerates.org/api/latest.json?app_id=` + variable | False positive. `.apikey` was gitignored from `1fa072c` (2014-02-28) and never committed. |
| bluescraper | `src/alerts.py:97`, `Dockerfile:18,21` | `credentials.Certificate("/bluelytics-mobile-firebase-adminsdk.json")`, `COPY bluelytics-mobile-firebase-adminsdk.json /`, `ENV GOOGLE_APPLICATION_CREDENTIALS=…` | Path references only; the JSON was never committed (`*.json` ignored 2014-02-15 to 2020-05-23, explicit name since `9a3fd5e`). **But the key is baked into every `bluelytics_scraper` image** (rotation item). |
| bluescraper | `src/buffer.py:20`; `redeploy.sh`; `README.md` | SNS topic ARN `arn:aws:sns:us-west-2:<aws-account-id>:mailPablo`; ECR host `<aws-account-id>.dkr.ecr.us-west-2.amazonaws.com/bluelytics_scraper` | Infra identifiers, already public on GitHub. Not credentials. |
| bluescraper | `dolarbluenet.js` (2014-04-21 `9f265b0`, 2015-05-05 `63804c8`) | Published-to-web Google Sheets URLs | Public identifiers. |
| bluelytics_api | `v2.go:22-25` | `os.Getenv(...)` lookups of `PG_USER`, `PG_DB`, `PG_SSLMODE`, `PG_PASSWORD`, `PG_HOSTNAME` | False positive. |
| bluelytics_api | `redeploy.sh:2,4,5` | `aws ecr get-login-password … --password-stdin <aws-account-id>.dkr.ecr.us-west-2.amazonaws.com`, image `bluelytics_api:latest` | Identifier only. |
| bluelytics_frontend | `app/index.html:220` | `ga('create', 'UA-…')` | Public analytics id. |
| bluelytics_frontend | `build.sh:4` | `s3cmd sync . s3://<bucket>` | Bucket name; credentials live in `~/.s3cfg`, outside the repo. |
| bluelytics_frontend | `app/.htaccess`, `README.md` ("ServerTokens Prod"), `LICENSE`, `.travis.yml` (no `secure:` entries) | Regex noise | False positive. |
| blueimg | `js/bootstrap.js` (`autoToken`), CSS source maps | Regex noise | False positive. |

### 4.3 By-value check

- All high-entropy values: **0 occurrences** in all five repos, including dangling objects and the heap dump: `OPENEX_API_KEY`, `PG_PASSWORD`, `BUFFER_API_KEY`, `SN_PROFILE_*`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `test.py` `app_id` / `app_key` / `access_token`, service-account `private_key_id` / `client_email` / `client_id` / private-key lines, every VPN cert/key line, the VPN remote host, the `--add-host` mapping.
- Four low-entropy values did match (`PG_USER`, `PG_DB`, `PG_HOSTNAME`, `PG_SSLMODE`, 7–10 alphanumeric characters each). They are ordinary words that also occur in unrelated files (Bootstrap CSS, icon fonts, READMEs, Gruntfile, commit metadata). Coincidental, not a leak.

### 4.4 gitleaks v8.30.1

| Target | Result |
|---|---|
| blueimg, bluelytics_api, bluelytics_frontend, bluescraper (history, all refs) | no leaks |
| bluelytics_mobile_v3 (history, all refs) | 2: `gcp-api-key` in `android/app/google-services.json` (`a22853e`); `generic-api-key` in `ios/Podfile.lock` (`01bac98`, false positive). gitleaks does not look inside the binary heap dump. |
| `bluescraper/` on disk | `aws-access-token` ×1 and `generic-api-key` ×3 in `.env`; `generic-api-key` ×1 in `test.py`; `private-key` ×1 in the adminsdk JSON |
| `bluelytics_vpn/` on disk | `private-key` in `server.key` and `sicarul.bluelytics.com.ar.key` |
| `bluelytics_notifiy/`, `bluelytics_database/`, `blueimg/`, `bluelytics_api/` on disk | no leaks |
| Dry-run monorepo (all history) | the same 2 mobile findings, nothing else |

Fingerprints for a `.gitleaksignore` in the new repo (unchanged by a subtree import because commit ids and root-relative paths are preserved):

```
a22853e059ea059b32855892d0d424902adb6761:android/app/google-services.json:gcp-api-key:32
01bac98eef61e6f8f7d7234138241ce760f40f34:ios/Podfile.lock:generic-api-key:764
```

---

## 5. The mobile heap dump in detail

- `git log --all -- android/java_pid7522.hprof` returns only `f4f128b` "Initial commit" (2020-05-19 00:44:49 -0300).
- `git diff --name-status f4f128b eaccb15` returns exactly `D android/java_pid7522.hprof`: `eaccb15` is the same commit rewritten without the dump, and is the root of `master`.
- Reflog shows `filter-branch: rewrite` on 2020-05-19. `refs/original/refs/heads/master` still points at `f4f128b`, which is why `rev-list --all --count` is 54 while `master` has 53.
- `git merge-base --is-ancestor f4f128b origin/master` is false, and a 436 MB file exceeds GitHub's 100 MB limit, so it never reached the remote.
- Header `JAVA PROFILE 1.0.2`, 436,602,674 bytes. Pattern counts (no values extracted): `BLUELYTICS_UPLOAD_STORE_PASSWORD` 117, `BLUELYTICS_UPLOAD_KEY_PASSWORD` 117, `storePassword` 22, `keyPassword` 23, `signingConfig` 144, `gradle.properties` 24. Zero matches for `AIza…`, `AKIA…`, PEM private-key headers, GitHub tokens. Keystore file names mentioned include `bluelytics_mobile.keystore`, `release.keystore`, `debug.keystore`.
- `.gitignore` already contains `*.hprof`; the file is no longer in the working tree.

How it could leak into the new repo:

| Action | Carries the dump? |
|---|---|
| `git clone --no-local --single-branch --branch master` (recipe) | **No** (verified with `git cat-file -e d539d0b9…`) |
| `git clone <path>` (default local clone) | The object file is hardlinked into the clone's `.git/objects` but is unreferenced; a later `git subtree add` / `git fetch` from that clone does not transfer it. Unsafe only if that clone's `.git` itself becomes the new repo. |
| `git clone --mirror`, `git fetch origin '+refs/*:refs/*'`, `git filter-repo` on a mirror | **Yes** (`refs/original` is copied) |
| `cp -a bluelytics_mobile_v3 …` | **Yes** |

Optional local purge, to be run by the owner (it modifies the legacy repo, so it is outside this audit's read-only rule): `git -C bluelytics_mobile_v3 update-ref -d refs/original/refs/heads/master && git -C bluelytics_mobile_v3 reflog expire --expire=now --all && git -C bluelytics_mobile_v3 gc --prune=now`. Frees about 136 MB.

---

## 6. Non-git directories and untracked files

| Path | Mode | Content (names only) | Ever committed anywhere? | Import? |
|---|---|---|---|---|
| `bluescraper/.env` (611 B) | 0644 | `OPENEX_API_KEY, PG_USER, PG_HOSTNAME, PG_SSLMODE, PG_DB, PG_PASSWORD, SN_PROFILE_INSTAGRAM, SN_PROFILE_FACEBOOK, SN_PROFILE_TWITTER, SN_PROFILE_LINKEDIN, BUFFER_API_KEY, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, RUN_ALWAYS` | No (path never in any tree; values not in any object) | **Never** |
| `bluescraper/test.py` (177 B) | 0644 | `app_id` (15 digits), `app_key` (32 hex), `access_token` (app-token shape, two parts joined by a pipe), then `Api(app_id=app_id, app_secret=app_key)`: Meta/Facebook Graph app credentials | No | **Never** |
| `bluescraper/bluelytics-mobile-firebase-adminsdk.json` (2,352 B) | 0644 | Google service account for project `bluelytics-mobile`: `private_key_id`, `private_key`, `client_email`, `client_id` | No | **Never** |
| `bluescraper/docker_run.sh` (211 B) | 0755 | `docker build`, `docker run --add-host=<name>:<ip> -v … --env-file .env`. No credential; reveals the DB host alias and IP | No | No |
| `bluelytics_vpn/server.key`, `sicarul.bluelytics.com.ar.key` | 0600 | PEM private keys: OpenVPN **server** key and one client key | No | **Never** |
| `bluelytics_vpn/ca.crt`, `server.crt`, `sicarul.bluelytics.com.ar.crt`, `bluelytics.ovpn` | 0600 / 0644 | CA and leaf certificates; client profile (`remote` endpoint, UDP, AES-256-GCM, absolute cert/key paths). No `ca.key` in the folder | No | **Never** |
| `bluelytics_notifiy/update.py` (137 lines) | 0644 | Old Django management command posting to Buffer. Imports `buffer_accesstoken` from a missing `buffer_apikeys` module (line 16), so no token is present. **Hard-codes three Buffer profile ids at lines 21, 37, 53** (same values as `SN_PROFILE_*`) | n/a | Snapshot with the ids masked (the recipe does this) |
| `bluelytics_database/schema/{core,notifications,views}.sql`, `initial_load/*.sql`, `currency_map.csv` (3.9 KB), `dolar.csv` (267 KB, 7,816 rows, 2011-01-03 to 2020-05-12), `currency_values.csv` (13.3 MB, 381,360 rows, 2014-03-01 to 2020-05-12) | 0644 | DDL, `\COPY` loaders, market data. No roles, passwords, tokens or personal data | n/a | Snapshot as-is (13.3 MB raw costs about 2.6 MB packed) |
| `blueimg/template_ig_story.html` (3,113 B) | 0644 | Untracked Instagram-story template; no secret patterns | No | Snapshot (otherwise lost) |
| mobile working-tree changes | | `package.json` (react 18.0.0 to 18.2.0, react-native 0.69.3 to 0.74.3, adds `@types/react`), `android/build.gradle` (SDK 33 to 34), regenerated `package-lock.json` | No | Save `package.json` + `build.gradle` as a 1.1 KB patch; the lockfile is regenerable |
| `android/local.properties` | | `sdk.dir` only | No | No |

On-disk credential-pattern scan of everything else outside `node_modules`, `bower_components`, `.git`, build dirs and the blueimg virtualenv: no further hits.

---

## 7. Recommendation and commands

### 7.1 Per repo

| Source | Choice | Notes |
|---|---|---|
| bluescraper | **(a)** full history to `legacy/bluescraper/` | History clean. AGPL-3.0. |
| blueimg | **(a)** full history to `legacy/blueimg/`, or **(b)** if `bluelytics_v2` will be public and you do not want to republish the commercial font | `fonts/gtwalsheim.*` is "GT Walsheim Pro Regular", name table: "Copyright (c) 2014 by Grilli Type. All rights reserved." It is already public in `sicarul/blueimg`. Scrub commands in 7.3. |
| bluelytics_frontend | **(a)** `master` only | `material` is an ancestor of master. Remote dependabot branches are noise. |
| bluelytics_mobile_v3 | **(a)** `master` only, through a `--no-local --single-branch` clone | `master` needs no scrubbing. Never import `refs/original`. |
| bluelytics_api | **(a)** `main` | Clean and tiny. |
| bluelytics_database | **(c)** snapshot | No git history exists. |
| bluelytics_notifiy | **(c)** snapshot with Buffer profile ids masked | |
| bluelytics_vpn | **Do not import** | Move to a password manager or destroy with the VPN. |

Trade-off of `git subtree add` (measured in the dry run): imported commits keep their original SHAs and their original root-relative paths. `git blame legacy/bluelytics_api/v2.go` resolves to the 4 original commits, but `git log -- legacy/bluelytics_api/v2.go` shows 1 commit unless `--follow` is added (then 4). If native path history matters more than SHA stability, use the path-rewrite variant in 7.3.

### 7.2 Recommended recipe (validated)

The same script (identical commands, slightly longer comments) is saved at `/tmp/claude-1000/-home-sicarul-dev-bluelytics/c994ac69-6f88-493d-ac11-54fc62a21d9d/scratchpad/research/build_bluelytics_v2.sh`. It was run with `DEST` and `WORK` pointed at scratch directories and produced: 191 commits, 230 tracked files, 17 MB working tree (13 MB of it the seed CSV), 5.7 MB `.git` after `gc --aggressive`, heap dump and ELF blobs absent, original HEAD SHAs present.

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC="${SRC:-/home/sicarul/dev/bluelytics}"
DEST="${DEST:-$SRC/bluelytics_v2}"
WORK="${WORK:-$(mktemp -d -t bluelytics-import.XXXXXX)}"
export GIT_OPTIONAL_LOCKS=0   # never refresh/lock the index of the original repos

[ ! -e "$DEST" ] || { echo "ABORT: $DEST already exists"; exit 1; }

# 1. clean throwaway clones
#    --no-local      : real object transfer, only objects reachable from the cloned branch are copied
#    --single-branch : never fetches refs/original/* (mobile); never use --mirror
clone() { # <repo> <branch>
  git clone --quiet --no-local --single-branch --no-tags --branch "$2" "$SRC/$1" "$WORK/$1"
  git -C "$WORK/$1" remote remove origin
}
clone bluescraper          master
clone blueimg              master
clone bluelytics_frontend  master
clone bluelytics_mobile_v3 master
clone bluelytics_api       main

# 2. safety assertions on the clones
HPROF=d539d0b9151a62179e983743c9aefc950489b191   # android/java_pid7522.hprof
APIELF=fe28e348669bc954b27e010749e388c5265ddfcb  # dangling 15 MB Go binary
! git -C "$WORK/bluelytics_mobile_v3" cat-file -e $HPROF 2>/dev/null || { echo "ABORT: hprof blob leaked into clone"; exit 1; }
! git -C "$WORK/bluelytics_api" cat-file -e $APIELF 2>/dev/null     || { echo "ABORT: dangling ELF leaked into clone"; exit 1; }
for r in bluescraper blueimg bluelytics_frontend bluelytics_mobile_v3 bluelytics_api; do
  [ -z "$(git -C "$WORK/$r" for-each-ref refs/original)" ] || { echo "ABORT: refs/original present in $r"; exit 1; }
  if git -C "$WORK/$r" log --all --name-only --format= | grep -Eiq '(^|/)(\.env|.*adminsdk.*\.json|test\.py|docker_run\.sh|.*\.ovpn|.*\.hprof|server\.key|buffer_apikeys\.py)$'; then
    echo "ABORT: secret-bearing path found in history of $r"; exit 1
  fi
done

# 3. new repo, secret guard rails first
git init --quiet -b main "$DEST"
cd "$DEST"
cat > .gitignore <<'EOF'
# --- secrets: never commit ---
.env
.env.*
!.env.example
*.pem
*.key
*.crt
*.p12
*.jks
*.keystore
*.ovpn
*.mobileprovision
*adminsdk*.json
*service-account*.json
buffer_apikeys.py
*.hprof
# --- build junk ---
node_modules/
bower_components/
dist/
.tmp/
.sass-cache/
__pycache__/
*.pyc
EOF
git add .gitignore
git commit --quiet -m "chore: initialize bluelytics_v2 monorepo (secret guard-rail .gitignore)"

# 4. import histories, oldest project first
imp() { # <repo> <branch> <origin-label>
  local sha; sha=$(git -C "$WORK/$1" rev-parse --short "$2")
  git subtree add --prefix="legacy/$1" "$WORK/$1" "$2" \
    -m "legacy: import $1 with full history (from $3 @ $sha)"
}
imp bluescraper          master github.com/Bluelytics/bluescraper
imp blueimg              master github.com/sicarul/blueimg
imp bluelytics_frontend  master github.com/Bluelytics/bluelytics_frontend
imp bluelytics_mobile_v3 master github.com/sicarul/bluelytics_mobile_v3
imp bluelytics_api       main   github.com/Bluelytics/bluelytics_api

# 5. snapshots of things that never had git history
mkdir -p legacy/bluelytics_database legacy/bluelytics_notifiy
cp -a "$SRC/bluelytics_database/schema" "$SRC/bluelytics_database/initial_load" legacy/bluelytics_database/
cp -a "$SRC/bluelytics_notifiy/update.py" legacy/bluelytics_notifiy/
# update.py hard-codes the 3 Buffer profile ids (same values as SN_PROFILE_* in bluescraper/.env): mask them
sed -E -i "s/(['\"])[0-9a-f]{24}\1/\1<BUFFER_PROFILE_ID>\1/g" legacy/bluelytics_notifiy/update.py
[ "$(grep -c '<BUFFER_PROFILE_ID>' legacy/bluelytics_notifiy/update.py)" = 3 ] || { echo "ABORT: profile-id masking did not match 3 lines"; exit 1; }
cp -a "$SRC/blueimg/template_ig_story.html" legacy/blueimg/
mkdir -p legacy/_wip
git -C "$SRC/bluelytics_mobile_v3" diff HEAD -- package.json android/build.gradle \
  > legacy/_wip/bluelytics_mobile_v3-rn074-upgrade.patch
# NEVER copy: bluelytics_vpn/*, bluescraper/{.env,test.py,docker_run.sh,bluelytics-mobile-firebase-adminsdk.json}
git add legacy/bluelytics_database legacy/bluelytics_notifiy legacy/blueimg/template_ig_story.html legacy/_wip
git commit --quiet -m "legacy: snapshot non-git dirs (database, notifiy), untracked IG story template, mobile WIP patch"

# 6. follow-up cleanup commit (vendored junk; sizes in section 8)
git rm -r --quiet \
  legacy/blueimg/css legacy/blueimg/js \
  legacy/blueimg/fonts \
  legacy/bluescraper/src/alerts/css legacy/bluescraper/src/alerts/js \
  legacy/bluescraper/src/weekly_chart/css legacy/bluescraper/src/weekly_chart/js \
  legacy/bluelytics_frontend/package-lock.json \
  legacy/bluelytics_frontend/app/images/material-design \
  legacy/bluelytics_frontend/.travis.yml
# OPTIONAL, only if the mobile app is retired (these files are needed to BUILD it):
# git rm -r --quiet \
#   legacy/bluelytics_mobile_v3/package-lock.json legacy/bluelytics_mobile_v3/ios/Podfile.lock \
#   legacy/bluelytics_mobile_v3/Gemfile.lock legacy/bluelytics_mobile_v3/android/app/src/main/assets/fonts \
#   legacy/bluelytics_mobile_v3/android/gradle/wrapper/gradle-wrapper.jar legacy/bluelytics_mobile_v3/android/app/debug.keystore
git commit --quiet -m "legacy: drop vendored third-party assets and dead lockfile/CI config (still available in history)"

# 7. verification
echo "commits:        $(git rev-list --count HEAD)   (expect 191 = 1 init + 183 legacy + 5 subtree merges + 2 follow-ups)"
echo "tracked files:  $(git ls-files | wc -l)"
git cat-file -e $HPROF 2>/dev/null  && { echo "FAIL: hprof present"; exit 1; } || echo "hprof blob:     absent (ok)"
git cat-file -e $APIELF 2>/dev/null && { echo "FAIL: ELF present"; exit 1; }   || echo "ELF blob:       absent (ok)"
for c in 85fb03e 3b0376d 67687eb ca2cf88 555cf09; do git cat-file -e "$c^{commit}" || { echo "FAIL: missing original commit $c"; exit 1; }; done
echo "original SHAs:  preserved (ok)"
if git log --all --name-only --format= | grep -Eiq '(^|/)(\.env|.*adminsdk.*\.json|.*\.ovpn|.*\.hprof|server\.key)$'; then echo "FAIL: secret path in history"; exit 1; fi
echo "secret paths:   none in history (ok)"
git gc --quiet --aggressive --prune=now
echo ".git size:      $(du -sh .git | cut -f1)"
echo "DONE -> $DEST   (temp clones in $WORK can be deleted: rm -rf \"$WORK\")"
```

Independent re-check before the first push (expect exactly the two findings listed in 4.4):

```bash
cd /home/sicarul/dev/bluelytics/bluelytics_v2
docker run --rm --network none -v "$PWD":/repo:ro ghcr.io/gitleaks/gitleaks:latest \
  git /repo --log-opts="--all" --redact=100 --no-banner
```

### 7.3 Variants (b)

**Scrub the commercial font from blueimg history.** Run on the throwaway clone, before step 4. Built-in variant, tested: 8 commits remain, no `gtwalsheim` path in any commit, font blob gone after gc; commits up to `38da147` keep their SHAs, `75ec881` and `3b0376d` get new ones.

```bash
cd "$WORK/blueimg"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch \
  --index-filter 'git rm -q --cached --ignore-unmatch "fonts/gtwalsheim.*"' --prune-empty -- --all
git for-each-ref --format='%(refname)' refs/original | xargs -r -n1 git update-ref -d
git reflog expire --expire=now --all && git gc --quiet --prune=now
```

filter-repo equivalent (untested here): `git filter-repo --invert-paths --path-glob 'fonts/gtwalsheim.*'`, run before `git remote remove origin` or with `--force`.

`template.html:11-17` and `template_ig_story.html:11-17` declare the `@font-face`, so legacy rendering falls back to another font afterwards. The v2 image design should use an openly licensed font anyway.

**Path-rewritten history** (every old commit already lives under `legacy/<name>/`, so plain `git log -- legacy/<name>/file` works; original SHAs are lost). Built-in variant, tested on bluelytics_api (8 commits, `log -- legacy/bluelytics_api/v2.go` = 4) and bluelytics_frontend (69 commits incl. merges, `log -- legacy/bluelytics_frontend/app/index.html` = 36, same as original):

```bash
r=bluelytics_api; b=main            # repeat per repo/branch, on the throwaway clone
cd "$WORK/$r"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter '
  git ls-files -s | sed "s-\t\"*-&legacy/'$r'/-" | GIT_INDEX_FILE=$GIT_INDEX_FILE.new git update-index --index-info &&
  if [ -f "$GIT_INDEX_FILE.new" ]; then mv "$GIT_INDEX_FILE.new" "$GIT_INDEX_FILE"; else rm -f "$GIT_INDEX_FILE"; fi' -- --all
git for-each-ref --format='%(refname)' refs/original | xargs -r -n1 git update-ref -d
cd "$DEST"
git fetch --quiet "$WORK/$r" "$b"
git merge --quiet --allow-unrelated-histories --no-edit \
  -m "legacy: import $r (paths rewritten under legacy/$r)" FETCH_HEAD
```

filter-repo equivalent (untested here), on a fresh `--no-local --single-branch` clone that still has its `origin`:

```bash
git filter-repo --to-subdirectory-filter legacy/bluelytics_mobile_v3
# belt and braces for mobile, although master is already clean:
git filter-repo --force --invert-paths --path-glob '*.hprof'
# optional identity normalisation:
git filter-repo --force --mailmap /path/to/mailmap
```

**(c) snapshot only**, if history is not wanted for a repo: `git -C "$SRC/<repo>" archive --format=tar --prefix=legacy/<repo>/ <branch> | tar -x -C "$DEST"`. `git archive` exports tracked files only, so no ignored secret can slip in.

---

## 8. Vendored junk in the legacy trees

Deleting in a follow-up commit tidies the working tree and search results; it does **not** shrink the repo (the blobs stay in history). The whole imported history is under 3 MB packed, so size is not the reason to scrub.

Removed by step 6 (41 files, 2,250,001 bytes):

| Path under `legacy/` | Bytes | What |
|---|---:|---|
| `blueimg/css/` (6 files) | 533,650 | Bootstrap 3.1.1 dist incl. source maps |
| `blueimg/js/` (2 files) | 84,368 | Bootstrap 3.1.1 JS |
| `blueimg/fonts/glyphicons-halflings-regular.*` (4) | 147,862 | Bootstrap glyphicons |
| `blueimg/fonts/gtwalsheim.*` (4) | 260,129 | GT Walsheim Pro, **commercial font** |
| `bluescraper/src/alerts/css`, `…/alerts/js` (3) | 142,256 | Bootstrap 3.1.1 min |
| `bluescraper/src/weekly_chart/css`, `…/js` (5) | 608,262 | Bootstrap 4.5.0, jQuery 3.2.1, d3 v5, d3-annotation |
| `bluelytics_frontend/package-lock.json` | 294,127 | Grunt/Bower-era lockfile (Dependabot noise) |
| `bluelytics_frontend/app/images/material-design/*.svg` (15) | 179,237 | Material icon sprites |
| `bluelytics_frontend/.travis.yml` | 110 | Dead CI config (node 0.10) |

After the cleanup: `legacy/blueimg` 7 files / 24,341 B; `legacy/bluescraper` 25 files / 100,383 B; `legacy/bluelytics_frontend` 64 files / 217,339 B; `legacy/bluelytics_api` 10 files / 25,078 B.

Mobile candidates, **delete only if the app is retired** (they are needed to build it):

| Path under `legacy/bluelytics_mobile_v3/` | Bytes |
|---|---:|
| `android/app/src/main/assets/fonts/*.ttf` (16 icon fonts from react-native-vector-icons) | 1,984,216 |
| `package-lock.json` | 427,164 |
| `android/gradle/wrapper/gradle-wrapper.jar` | 58,695 |
| `ios/Podfile.lock` | 30,206 |
| `android/app/debug.keystore` (public RN template) | 2,257 |

Never committed, exist only on disk, must not be copied: `bluelytics_frontend/{node_modules 161M, bower_components 21M, .tmp 4.0M, .sass-cache 3.5M, dist 2.0M}`, `blueimg/{lib 17M, out 5.5M, bin, include, local}`, `bluelytics_mobile_v3/{node_modules 613M, android build output (dir is 1.2G), .gradle, .idea}`, `bluescraper/src/__pycache__`.

Compiled or oversized objects: the 15 MB Go ELF (api, dangling) and the 436 MB heap dump (mobile, `refs/original`); both excluded by the recipe.

---

## 9. Secret rotation checklist (owner)

Ordered by severity. Names and locations only.

| # | Credential (key names) | Where it lives | Rotate / act in |
|---|---|---|---|
| 1 | **AWS IAM access key**: `AWS_ACCESS_KEY_ID` (long-lived `AKIA…` user key), `AWS_SECRET_ACCESS_KEY` | `bluescraper/.env` (0644). Used for S3 uploads to `S3_BUCKET`, SNS publish, probably ECR pushes. Also check `~/.aws/credentials` and `~/.s3cfg` (frontend `build.sh` uses `s3cmd`); not inspected. | AWS Console, IAM, Users, Security credentials: create a new key, deploy, deactivate then delete the old one; review "last used" and CloudTrail. In v2 prefer OIDC or Pulumi-managed secrets over static keys. |
| 2 | **Postgres credentials**: `PG_PASSWORD` (short, alphanumeric only: weak), with `PG_USER`, `PG_HOSTNAME`, `PG_DB`, `PG_SSLMODE` | `bluescraper/.env`; the same variable names are read by `bluelytics_api/v2.go:22-25`, so the API deployment shares them | `ALTER ROLE … PASSWORD` on the production Postgres with a generated 32+ character password; update the env of both the API and the scraper tasks. |
| 3 | **Firebase Admin SDK service-account key**: `private_key_id`, `private_key`, `client_email` (project `bluelytics-mobile`) | `bluescraper/bluelytics-mobile-firebase-adminsdk.json` (0644) **and inside every `bluelytics_scraper` image layer** in ECR and local Docker caches (`bluescraper/Dockerfile:18`) | Google Cloud Console, IAM & Admin, Service Accounts, `firebase-adminsdk-…@bluelytics-mobile`, Keys: add a new key, delete the old key id. Delete old ECR images. In v2 inject it as a runtime secret, never `COPY`. |
| 4 | **OpenVPN PKI**: server private key, client private key, CA/server/client certificates, client profile | `bluelytics_vpn/server.key`, `sicarul.bluelytics.com.ar.key`, `ca.crt`, `server.crt`, `sicarul.bluelytics.com.ar.crt`, `bluelytics.ovpn` | If the VPN disappears with the migration: shut the server down and destroy the PKI. Otherwise re-issue server key/cert, revoke the client cert (CRL), issue a new client. Move the files out of the project tree into a password manager. Confirm where `ca.key` is. |
| 5 | **Android upload-keystore passwords**: `BLUELYTICS_UPLOAD_STORE_PASSWORD`, `BLUELYTICS_UPLOAD_KEY_PASSWORD` (also `…_STORE_FILE`, `…_KEY_ALIAS`) | Defined outside the repos (Gradle user properties). Present in the heap-dump blob `d539d0b9…` in the **local** `bluelytics_mobile_v3/.git` via `refs/original/refs/heads/master`. Never pushed. | Do not import (recipe guarantees it). If that `.git` folder was ever backed up or synced anywhere, change the passwords (`keytool -storepasswd`, `keytool -keypasswd`) or request an upload-key reset in Play Console. Optionally purge locally (section 5). |
| 6 | **Buffer access token**: `BUFFER_API_KEY` (130 chars); profile ids `SN_PROFILE_INSTAGRAM`, `SN_PROFILE_FACEBOOK`, `SN_PROFILE_TWITTER`, `SN_PROFILE_LINKEDIN` | `bluescraper/.env`; three profile ids also hard-coded in `bluelytics_notifiy/update.py:21,37,53` | Buffer is being dropped: revoke the token / delete the Buffer developer app, disconnect the social profiles, close the account. The ids die with it. |
| 7 | **Meta (Facebook/Instagram) app credentials**: `app_id`, `app_key` (App Secret), `access_token` (app token) | `bluescraper/test.py` (0644) | developers.facebook.com, the app, Settings, Basic, App Secret, Reset (invalidates app tokens). Issue fresh tokens for the v2 Instagram poster and keep them in secret storage. |
| 8 | **Open Exchange Rates App ID**: `OPENEX_API_KEY` | `bluescraper/.env` | openexchangerates.org account, App IDs: create a new one, delete the old. |
| 9 | **Firebase client API key** (`current_key` / `API_KEY`), OAuth client ids | Tracked: `bluelytics_mobile_v3/android/app/google-services.json:32`, `ios/GoogleService-Info.plist:12`; in mobile history since `a22853e` | Public by design, no rotation needed. Google Cloud Console, APIs & Services, Credentials: restrict to Android package `com.bluelytics.mobileapp` + signing SHA-1 and the iOS bundle id, and to the Firebase APIs actually used. Do this before the mobile history becomes public. |
| 10 | AWS account id, ECR repository names, SNS topic name, region `us-west-2` | `bluelytics_api/redeploy.sh:2,4,5`, `bluescraper/redeploy.sh`, `bluescraper/README.md`, `bluescraper/src/buffer.py:20`; already public on GitHub | Identifiers, not credentials. No rotation; make sure nothing relies on them being private. |
| 11 | S3 bucket names, Google Analytics id | `S3_BUCKET` env, `bluelytics_frontend/build.sh:4`, `bluelytics_frontend/app/index.html:220` | Public. Review bucket policies when the buckets are retired. |
| 12 | Commit author e-mails (gmail.com, sicarul.com, auth0.com on 2 commits) | git metadata of all repos; four are already public | Optional `.mailmap` (display only) or `--mailmap` rewrite (changes SHAs). |

Housekeeping regardless of rotation: `chmod 600` the three bluescraper secret files or move them out of the tree; add a `.dockerignore` to anything built with `COPY . .` (as `bluelytics_api/Dockerfile` does).

---

## 10. Gotchas for the rewrite

1. `git clone <local path>` hardlinks the entire object directory, including dangling objects and anything behind `refs/original`. Verified: a plain local clone of `bluelytics_api` contains the dangling ELF blob, a `--no-local` clone does not. Always `--no-local`, never `--mirror`, never `cp -a` a legacy `.git`.
2. `git subtree add` leaves old commits with root-relative paths: use `git log --follow` or the path-rewrite variant. Do not pass `--squash` if history is wanted.
3. A history-only import silently loses `blueimg/template_ig_story.html` (untracked) and the mobile RN 0.74.3 / SDK 34 upgrade in progress (uncommitted). The recipe captures both.
4. `bluelytics_database/initial_load/*.csv` ends on **2020-05-12**. Everything since exists only in the production Postgres; export it before any decommissioning.
5. `bluelytics_notifiy/update.py` imports `dolar_blue.models`, `dolar_blue.calculations` and `buffer_apikeys`: it belonged to an older Django backend that is not among these directories.
6. Licensing is inconsistent: bluelytics_frontend and bluescraper carry AGPL-3.0, the other three have no license file, and three of the five are public. Every commit is by one author, so relicensing the unified repo is the owner's call. Vendored third-party code keeps its own licenses; GT Walsheim Pro is proprietary.
7. Legacy manifests under `legacy/` (`package.json`, `bower.json`, the mobile `package-lock.json`, `go.mod` on Go 1.14) will feed GitHub's dependency graph and may generate Dependabot alerts for code that is never deployed. Workspace globs, linters, formatters and CI in v2 must exclude `legacy/**`.
8. GitHub push protection may stop the first push because of the Google API key in `google-services.json`; it is the public Firebase client key (item 9) and can be allowed.
9. The mobile remote is private/404 while the other four are public: a public `bluelytics_v2` publishes the mobile source and Firebase client config for the first time.
10. `bluelytics_frontend`'s remote has 16 unmerged dependabot branches and 36 PR refs; none are imported.
11. The scraper image embeds the Firebase Admin key, and `PG_HOSTNAME` is a bare alias resolved through `--add-host` in `docker_run.sh`: the database appears to be reached over the VPN. The new infra must not depend on either.

---

## 11. Open questions

1. Will `bluelytics_v2` be public or private? Decides the font scrub, the Firebase key restriction timing and the license.
2. Is the mobile app staying alive (the RN 0.74.3 / SDK 34 work suggests yes)? If so, keep its build files and plan to move it out of `legacy/`.
3. Where are the Android upload keystore and the `BLUELYTICS_UPLOAD_*` Gradle properties stored, and are they backed up? They are in none of the legacy directories.
4. Was `bluelytics_mobile_v3/.git` (with the heap dump) ever copied to a backup or another machine?
5. Should `refs/original` be purged from the legacy mobile repo now?
6. Is there another legacy repo (the Django `dolar_blue` backend, `buffer_apikeys.py`) that should be archived or audited too?
7. Which GitHub owner hosts the new repo (`Bluelytics` org or `sicarul`), and should the five old repos be archived with a pointer?
8. Subtree import (original SHAs) or path-rewritten import (native `git log` per path)?
9. Normalise the two author-name spellings and three e-mail domains with a `.mailmap`?
