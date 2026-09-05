# Projektor: a self-hosted Plex-style media server and clients

## Context

The repo is empty. The goal is a from-scratch media server that runs on a Linux box, indexes downloaded movies and TV shows, fetches artwork and metadata online, pulls subtitles, and streams to five clients: a browser app, an Android phone app, an Android TV app, an iPad app for iPadOS 15.8.8, and a Samsung TV app for two TVs (RU7100 from 2019 on Tizen 5.0, Q70B from 2022 on Tizen 6.5).

Decisions already made with the user:

- Server in TypeScript/Node.
- Fully native clients: web (browser + Tizen), Kotlin for Android phone + TV, Swift for iPad.
- Intel iGPU on the server, so hardware transcoding via VAAPI (Quick Sync).
- LAN only for v1. No remote access, no HTTPS termination in scope.
- Media folders are loosely named, so filename parsing must work from scene-style names and there must be a manual "fix match" flow.
- iPad installs via a free Apple ID from Xcode (7-day resign cycle).
- Artwork and fetched subtitles live in the server data directory, never beside the media files. Media folders are mounted read-only.
- Household users log in by picking a profile and entering a numeric PIN.
- Client order after the MVP: Android phone + TV, then Live TV (IPTV), then Samsung TV, then iPad.

The design borrows the proven approach of Jellyfin: ffmpeg-driven HLS with on-demand segment generation, TMDB for metadata, OpenSubtitles for subtitles, and a per-device capability profile that the server uses to choose direct play, remux, or transcode.

## Core player behaviour (every client)

The owner's main reason for building this: skipping should move by an amount they choose, not a fixed ten seconds. Every player, on every client, has two controls in its bottom bar:

- **Skip amount**: a selector offering +3, +4, +5, +6, +7, +8, +9, +10, and +15 seconds. The forward and back buttons, and the arrow keys or remote left/right, jump by exactly that amount.
- **Speed**: 0.5×, 0.75×, normal, 1.25×, 1.5×, 1.75×, 2×.

Both choices persist per device across sessions.

Every client also ships with the server's fixed LAN address (`http://192.168.100.20:8096`) baked in as the default, so a fresh install never needs it typed; the address stays editable. The web player has them from Phase 1; the Android, Tizen, and iPad players must ship with them, not add them later. Live TV catch-up playback uses the same controls.

## Scope boundaries

In: movies, TV shows, and anime as three separate libraries and three separate sections in every client (anime never appears under TV), multiple household users, watch progress and resume, posters/backdrops/episode stills, subtitles (embedded extraction + online fetch), LAN playback on all five clients.

Out for v1: remote access, live TV, music, photos, DLNA/Chromecast, user-uploaded metadata edits beyond "fix match", parental controls.

## Repository layout

Single repo. pnpm workspace for the TypeScript parts; native apps live alongside.

```
Projektor/
  package.json, pnpm-workspace.yaml, tsconfig.base.json
  packages/api-contract/   OpenAPI 3.1 spec (generated from zod schemas in server) + generated TS client
  server/                  Fastify, better-sqlite3 + Drizzle, ffmpeg/ffprobe, chokidar
  web/                     React 18 + Vite + TypeScript, TanStack Query, react-router, hls.js
  tizen/                   Tizen packaging of web/ (config.xml, icons, AVPlay adapter, build script)
  android/                 Gradle: :core, :player, :app-mobile, :app-tv (Kotlin, Compose, Media3)
  ios/                     Xcode project, SwiftUI, AVPlayer, deployment target iOS 15.0
  deploy/                  Dockerfile, docker-compose.yml, example .env
  scripts/                 make-fixtures.sh (synthetic media via ffmpeg), release helpers
  docs/                    setup guides per platform (API keys, Tizen cert, iPad sideload)
```

## Server design (`server/`)

**Stack.** Fastify 4, TypeScript, zod for request/response schemas with `fastify-type-provider-zod` producing the OpenAPI document. better-sqlite3 with Drizzle ORM and migrations. `execa` to spawn ffmpeg/ffprobe with argument arrays (never shell strings). `sharp` for image resizing. `pino` logging. Config from env plus a `DATA_DIR` for the SQLite file, artwork cache, subtitle cache, and transcode temp.

**Data model.** `users`, `sessions` (tokens), `libraries` (path, type movie|tv|anime), `media_files` (path, size, mtime, ffprobe json, library_id), `movies`, `shows`, `seasons`, `episodes` (each with tmdb_id, titles, overview, air dates, artwork keys), `streams` (per file: video/audio/subtitle tracks from ffprobe), `subtitles` (source embedded|external|opensubtitles, language, path to cached .vtt), `playback_state` (user_id, item_id, position_ms, watched, updated_at). Items link to files one-to-many so multiple versions of a movie are allowed. Indexes on `(library_id, path)`, `(show_id, season_no, episode_no)`, `(user_id, updated_at)`.

**Scanner.** Walks configured library folders, filters by video extensions, skips unchanged files by size+mtime, runs ffprobe with a concurrency limit of 4, and parses filenames with `parse-torrent-title` to get title/year/season/episode. TV detection: a filename with SxxExx or folder hints becomes an episode; otherwise a movie. Unmatched files still appear in the UI under their cleaned filename with a placeholder poster so nothing is hidden. chokidar watches library roots for adds and removes with debounce. A manual scan endpoint exists too.

**Anime library.** Anime is a distinct library type, stored in the same `shows`/`seasons`/`episodes` tables but tagged `kind = anime` so it is filtered out of every TV query and has its own browse, search, home rows, and Continue Watching section. Fansub filenames like `[Group] Title - 13 [1080p][HEVC].mkv` do not fit `parse-torrent-title`, so anime libraries parse with `anitomyscript` (a port of Anitomy) to get title, absolute episode number, release group, and version tag. Matching uses AniList's public GraphQL API (no key required) for the canonical title, romaji/english names, cover art, episode count, and the TMDB id when AniList has it; TMDB then supplies per-episode titles and stills. Absolute episode numbers are mapped onto TMDB seasons by cumulative episode counts, with a per-show override in the fix-match UI because the two sites often disagree on season splits. Anime files commonly carry dual audio (Japanese and English) and styled ASS subtitles, so the player exposes an audio track picker with a per-user default language, and ASS tracks are converted to WebVTT (positioning and karaoke styling are dropped; that is stated in the UI).

**Metadata (TMDB).** User supplies a TMDB API key in settings. Search with title+year, take the top hit above a confidence threshold, otherwise mark as "needs review". Fetch details, credits (top cast), and images. Download poster, backdrop, and episode stills once into `DATA_DIR/images/<sha>/`, resize into fixed widths (w300, w780, w1280) with sharp, and serve with long cache headers. Only URLs on the TMDB image host are fetched. "Fix match" endpoint: client sends a TMDB id, server relinks and refetches.

**Subtitles.** On scan, embedded text subtitle tracks (srt, ass, subrip, mov_text) are listed from ffprobe and extracted lazily on first request via ffmpeg to WebVTT and cached. Sidecar `.srt` files beside media are picked up and converted. OpenSubtitles: the REST API at api.opensubtitles.com needs an API key and a user login, and the free tier caps downloads per day, so online fetch is on demand from the player's subtitle menu, not on scan. Search by file moviehash plus TMDB id, download the .srt, convert to VTT, store in `DATA_DIR/subtitles/<file_id>/<lang>.vtt`. Bitmap subtitles (PGS/VobSub) are out of scope for v1 and are listed as "unsupported" in the UI.

**Playback decision.** Every client sends a device profile: supported containers, video codecs, audio codecs, max width, max bitrate, and which HLS segment container it wants (ts or fmp4). The server returns one of:

1. Direct play: byte-range serving of the original file at `/api/files/:id/stream` (by id, never by path).
2. Remux to HLS: ffmpeg copies video and audio into segments without re-encoding, when codecs are supported but the container is not (the common MKV-on-iPad case).
3. Transcode to HLS: video to H.264 via `h264_vaapi` (decode with `-hwaccel vaapi`), audio to AAC stereo or copied if supported, falling back to `libx264` if VAAPI initialization fails at startup. Max 2 concurrent hardware transcodes, 1 software.

**HLS session manager.** Segment length 6s. The full VOD playlist is generated up front from the known duration, so seeking works before segments exist. ffmpeg is forced to keyframe at segment boundaries with `-force_key_frames expr:gte(t,n_forced*6)` so segment N always covers the same time range. When a client requests a segment more than a few segments ahead of the current ffmpeg position, the process is killed and restarted with `-ss` at that segment. Sessions die after 60s without a segment request. Subtitle tracks are exposed as WebVTT media playlists in the master playlist so AVPlayer and ExoPlayer render them natively; the web player renders VTT cues itself in an overlay (see web section).

**Auth.** Household users pick a profile from a list and enter a 4 to 6 digit PIN, which is what TV remotes can handle. PINs are Argon2id hashed. Because a PIN is weak, login is rate limited per user and per IP with a lockout after repeated failures, and the server binds only to the LAN interface by default. Login returns a bearer token stored in `sessions` with a device name; tokens are revocable from settings. Login endpoint is rate limited. First run creates an admin through a setup wizard. Everything under `/api` except login and setup requires a token.

**API surface (summary).** `/api/auth/*`, `/api/libraries`, `/api/items` (browse, search, details, fix-match), `/api/items/:id/next` (next episode), `/api/playback/decide`, `/api/playback/sessions/:id/{master.m3u8,index.m3u8,seg-N.ts}`, `/api/files/:id/stream`, `/api/subtitles/*`, `/api/images/:key`, `/api/progress`, `/api/users`, `/api/settings`. The OpenAPI document is emitted at build time to `packages/api-contract/openapi.json` and is the source of truth for all client SDKs.

**Deployment.** Multi-stage Dockerfile on `debian:bookworm-slim` with Node 20, ffmpeg, `intel-media-va-driver-non-free`, and `vainfo`. compose file maps `/dev/dri`, the media folders read-only, and `DATA_DIR`. Startup runs a VAAPI self-test and logs which encoder path is active.

## Web app (`web/`)

React 18, Vite, TypeScript, TanStack Query, react-router, generated API client from `packages/api-contract`. One codebase with two shells chosen at boot:

Top-level navigation in both shells is Home, Movies, TV Shows, Anime, Search, Settings. Home shows separate Continue Watching and Recently Added rows per library kind.

- **Pointer shell** for desktop and mobile browsers: responsive grid, hover details, mouse/touch.
- **TV shell** for 10-foot use: large tiles, row-based browsing, D-pad focus via `@noriginmedia/norigin-spatial-navigation`, on-screen keyboard for search, back-key handling. Activated automatically on Tizen and available in browsers via `?tv=1` for development.

**Player.** A `Player` interface with two implementations: `HtmlVideoPlayer` (native `<video>` for direct play, hls.js for HLS) and `AvPlayPlayer` (Tizen `webapis.avplay`). Subtitles render through our own overlay component that parses WebVTT and shows cues by current time, so behavior is identical across browsers and both TVs and we avoid AVPlay's external-subtitle limitations. Device profile is built from `MediaCapabilities`/`canPlayType` in browsers and from a static profile on Tizen.

**Build targets.** The browser build targets modern evergreen browsers. The Tizen build uses Vite `build.target: 'chrome63'` (Tizen 5.0 on the RU7100) with core-js polyfills. Style rules enforced by a lint check: no flexbox `gap` (Chrome 84+), no container queries, no `:has`. Grid `gap` is fine. Long lists are virtualized and images are requested at the smallest width that fits, because the RU7100 has little memory.

## Samsung TV (`tizen/`)

Tizen web app that loads the Tizen build of `web/`. `config.xml` declares internet, `tv.inputdevice` (for color/media keys), and the AVPlay privilege. Segment container `ts` in the device profile, since fMP4 HLS on Tizen 5.0 is unreliable. Build script produces a `.wgt`; install uses Tizen Studio CLI (`tizen package`, `sdb connect <tv-ip>`, `tizen install`). Both TVs need Developer Mode enabled with the Mac's IP, and a Samsung author + distributor certificate that includes each TV's DUID (documented in `docs/tizen.md`). Bring up the Q70B first (Chromium 85, forgiving), then the RU7100.

## Android (`android/`)

Kotlin, Gradle with version catalog, minSdk 24 for mobile, 26 for TV.

- `:core` — Retrofit + kotlinx.serialization client generated from the OpenAPI doc via openapi-generator, auth/token store, repository layer, playback-decision request building from `MediaCodecList` capabilities.
- `:player` — Media3 ExoPlayer wrapper: direct play of MKV/MP4 over HTTP, HLS, sideloaded VTT subtitles, progress reporting every 10s and on pause/stop.
- `:app-mobile` — Compose Material 3, bottom nav (Home, Movies, TV, Anime, Search) with Settings under the profile menu, detail screens, fullscreen player with gesture seek and audio/subtitle track pickers.
- `:app-tv` — Compose for TV (`androidx.tv:tv-material`), `LEANBACK_LAUNCHER` intent, banner asset, D-pad focus, player with remote-key handling. Shares view models with mobile through `:core`.

## iPad (`ios/`)

SwiftUI with deployment target iOS 15.0, so `NavigationView` not `NavigationStack`, and any iOS 16+ API is wrapped in `if #available`. AVPlayer handles HLS with subtitle renditions natively and direct-plays MP4/MOV; MKV goes through the server remux path. API client generated with `swift-openapi-generator` (or hand-written `URLSession` + `Codable` if the generator's iOS 15 support is a problem). Screens: Home, Movies, TV Shows, and Anime grids, detail, player with Picture-in-Picture and audio/subtitle track pickers. Progress reported on a timer and on background. Signed with a free Apple ID; `docs/ipad.md` explains the 7-day reinstall.

## Documentation

Documentation is part of every sub-phase, not a later cleanup. A sub-phase is not done until its check passes and these files reflect it:

- `docs/PROGRESS.md` — one row per sub-phase with status (todo, in progress, done), the commit or PR that landed it, and how its check was run. Updated at the end of every sub-phase.
- `docs/ARCHITECTURE.md` — the current shape of the system: packages, data flow, data model, playback decision, HLS session lifecycle. Updated whenever a sub-phase adds or changes a component.
- `docs/DEV.md` — how to install, run, test, and regenerate the API client on a dev machine. Updated whenever a command or prerequisite changes.
- `docs/API.md` — short prose guide to the API grouped by area, pointing at `packages/api-contract/openapi.json` as the source of truth. Updated whenever routes or schemas change.
- `docs/DECISIONS.md` — dated log of design decisions and the reasoning, so later phases do not re-argue them. Appended whenever a non-obvious choice is made.
- Platform guides (`docs/server.md`, `docs/android.md`, `docs/tizen.md`, `docs/ipad.md`) — created in the sub-phase that first targets the platform and kept current after that.
- Code comments only where the code cannot say it: ffmpeg argument choices, platform quirks, workarounds with a link to the upstream issue.

Each doc states what is true now. Superseded content is removed, not struck through; history lives in git. The PR for a sub-phase includes its doc updates in the same PR.

## Phases and order

Each phase ends with something usable on its own. Sub-phases are sized to a few hours to a day each, and every one ends with a check you can run. Nothing in a later sub-phase is started until the earlier one's check passes and its documentation (see Documentation above) is updated. Every sub-phase lands as a PR into `main`.

### Phase 0 — Scaffold and contract

- **0.1 Repo skeleton.** `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/DEV.md`, `.gitignore`, `.editorconfig`, pnpm workspace with empty `server/`, `web/`, `packages/api-contract/`. Check: `pnpm install` succeeds. First commit.
- **0.2 Tooling.** Shared `tsconfig.base.json`, ESLint + Prettier, vitest wired in every TS package, root scripts `lint`, `typecheck`, `test`. Check: all three run green on empty packages.
- **0.3 Fixtures script.** `scripts/make-fixtures.sh` produces a 30s h264/aac mp4, a hevc+ac3 mkv with an embedded srt, a scene-named file, and a fansub-named mkv with two audio tracks and an embedded ASS track into `fixtures/` (gitignored). Check: ffprobe on each file shows the expected streams.
- **0.4 Contract v0.** zod schemas for auth, libraries, items, playback decision, progress; Fastify boots with `/api/health` and serves the OpenAPI doc; `packages/api-contract` regenerates `openapi.json` and a typed fetch client. Check: generated client compiles against a running server.

### Phase 1 — Server + browser app (MVP)

Server first, one capability at a time, each proven with integration tests against the fixtures. The web app starts once items exist to browse.

- **1.1 Database + config.** Drizzle schema for every table in the data model, migrations, `DATA_DIR` layout, env config. Check: fresh start creates the SQLite file and runs migrations; second start is a no-op.
- **1.2 Auth + setup wizard.** Profile list endpoint, Argon2id PIN hashes, bearer tokens in `sessions`, first-run admin creation, per-user and per-IP rate limit with lockout, auth hook on `/api`. Check: unauthenticated request is 401, PIN login works, sixth wrong PIN is locked out, token revoke works.
- **1.3 Library CRUD + file walk.** Create movie/tv/anime libraries; walker lists video files with size/mtime and skips unchanged ones. Check: scan of `fixtures/` records four files; rescan records zero changes.
- **1.4 ffprobe + streams.** Probe each file with concurrency 4, persist video/audio/subtitle tracks. Check: the dual-audio fixture shows two audio and one ASS track.
- **1.5 Scene filename parsing.** `parse-torrent-title` wrapper, movie vs episode detection, unmatched items kept with a cleaned title. Check: unit table of 50+ scene names passes.
- **1.6 Fansub filename parsing.** `anitomyscript` wrapper for anime libraries: title, absolute episode, group, version. Check: unit table of 30+ fansub names passes.
- **1.7 TMDB matching + artwork.** Search with confidence threshold, "needs review" flag, details and credits, poster/backdrop/still download to `DATA_DIR/images`, sharp resize to three widths, `/api/images/:key` with cache headers, TMDB-host-only fetch guard. Check: fixture movie gets a poster; a nonsense filename lands in needs-review.
- **1.8 AniList matching + season mapping.** AniList GraphQL search, canonical titles and cover, TMDB id passthrough, absolute-to-season mapping by cumulative counts, per-show offset override. Check: unit test with uneven season lengths maps correctly; override changes the result.
- **1.9 Fix-match endpoint.** Relink an item to a TMDB or AniList id and refetch. Check: relinking the needs-review item clears its flag and fetches art.
- **1.10 Watcher + manual scan.** chokidar on library roots with debounce, `/api/libraries/:id/scan`. Check: dropping a file into `fixtures/` shows up without a manual scan.
- **1.11 Direct play.** `/api/files/:id/stream` with byte ranges, id-only lookup. Check: `curl -r` returns 206 with correct `Content-Range`; a bad id is 404.
- **1.12 Playback decision.** Device profile schema, decision matrix returning direct/remux/transcode plus the reason. Check: unit matrix of profile × fixture covers all three outcomes.
- **1.13 HLS remux.** Session manager, VOD playlist from duration, ffmpeg `-c copy` into 6s segments, idle kill after 60s. Check: master and index playlists validate; segment 0 decodes with ffprobe.
- **1.14 HLS transcode + seek restart.** `libx264` + AAC path, forced keyframes at segment boundaries, restart with `-ss` on far-ahead segment requests, concurrency caps. Check: request segment 0 then 40; ffmpeg restarted exactly once and both segments decode.
- **1.15 VAAPI path.** Startup self-test, `h264_vaapi` encode with `-hwaccel vaapi`, fallback to software with a logged warning. Check: on the Linux box `intel_gpu_top` shows video engine load during a transcode; on the Mac the fallback is logged.
- **1.16 Embedded + sidecar subtitles.** Lazy ffmpeg extraction to WebVTT, ASS to VTT with styling dropped, sidecar `.srt` pickup, `/api/subtitles/*`, subtitle renditions in the HLS master playlist. Check: the fixture srt and ASS tracks both come back as valid VTT.
- **1.17 Progress + continue watching + next episode.** `/api/progress` upsert, watched threshold, per-kind Continue Watching queries, `/api/items/:id/next`. Check: posting 95% marks watched and the next episode is returned.
- **1.18 Contract freeze.** Review every schema, bump to v1, regenerate the client, tag. Check: `openapi.json` diff is empty on a clean rebuild.
- **1.19 Web shell + auth.** Vite + React app, generated client, login and setup screens, token storage, route guard. Check: Playwright logs in and lands on an empty Home.
- **1.20 Browse screens.** Home with per-kind rows, Movies, TV Shows, Anime grids, Search, detail pages for movie/show/season/episode. Check: Playwright reaches a fixture episode detail page from Home.
- **1.21 Player.** `Player` interface, `HtmlVideoPlayer` with native video and hls.js, device profile from `MediaCapabilities`, VTT overlay renderer, audio and subtitle pickers, progress reporting. Check: Playwright starts playback, seeks, toggles a subtitle, and progress appears in the API.
- **1.22 Settings + fix-match UI.** Library management, TMDB key entry, users and tokens, needs-review list with TMDB/AniList search and season offset override. Check: fixing a needs-review item from the UI updates its poster.
- **1.23 Docker + deploy.** Multi-stage Dockerfile with ffmpeg and Intel drivers, compose with `/dev/dri` and read-only media, `.env.example`, `docs/server.md`. Check: container runs on the Linux box, scans a real folder, plays in a browser on the LAN.

### Phase 2 — Android phone + Android TV

- **2.1 Gradle skeleton.** Version catalog, `:core`, `:player`, `:app-mobile`, `:app-tv` modules, min SDKs. Check: `./gradlew assembleDebug` builds two empty apps.
- **2.2 Generated client + auth.** openapi-generator into `:core`, token store, login flow. Check: unit test hits a local server and lists libraries.
- **2.3 Device profile.** `MediaCodecList` inspection into a decision request. Check: emulator without AC3 receives a transcode decision for the ac3 fixture.
- **2.4 ExoPlayer wrapper.** Direct play, HLS, sideloaded VTT, progress reporting. Check: instrumented test plays a fixture for 10s and posts progress.
- **2.5 Mobile browse.** Bottom nav with Home, Movies, TV, Anime, Search; grids and detail screens. Check: emulator reaches an episode detail from Home.
- **2.6 Mobile player.** Fullscreen player, gesture seek, track pickers, resume, skip-amount and speed selectors (see Core player behaviour). Check: manual run on a phone plays, seeks, and resumes.
- **2.7 TV browse.** Compose for TV rows, leanback launcher, banner, D-pad focus. Check: Android TV emulator navigates Home to detail by D-pad.
- **2.8 TV player.** Remote-key controls and pickers; left/right jump by the chosen skip amount; speed selector. Check: full episode on the Android TV emulator with subtitles.

### Phase 3 — Live TV (IPTV)

The owner has an IPTV subscription at `https://playshare.co:8080/` (Xtream Codes API: server URL, username, password). It is integrated server-side so credentials live once in Settings, devices stay provider-agnostic, and streams can be remuxed for browsers. Live channels get their own section in every client, separate from Movies, TV Shows, and Anime.

- **3.1 Provider client + settings.** Xtream client for `player_api.php` (login/account info, live categories, live streams, VOD categories/streams, series) and `xmltv.php` (guide); credentials under Settings → Metadata, masked like TMDB, default URL `https://playshare.co:8080/`. New tables `live_channels`, `live_categories`, `live_programmes`; a refresh job on start and every 6 hours. Routes `GET /api/live/categories`, `GET /api/live/channels?category=`, `GET /api/live/guide?channel=&from=&to=`. Check: unit tests against a fake Xtream server; with real credentials entered, the channel list and today's guide load.
- **3.2 Stream relay.** `GET /api/live/{id}/stream` relays the provider's live stream through the server (credentials never reach the client), with the decision endpoint extended for live: `direct` (raw MPEG-TS for Android, Tizen, ExoPlayer) or `hls` (ffmpeg copy into a sliding-window live playlist for browsers and AVPlayer). Reuses the HLS manager with a live mode. Check: a channel plays in Chrome through HLS and the relay drops when the client disconnects.
- **3.3 Web Live section.** A Live tab: categories, channel list with now/next from the guide, a guide grid for the selected channel, and playback in the existing player with channel up/down and number-key entry; no seek bar while live. Check: Playwright against the fake provider: pick a category, open a channel, see now/next, switch channel with the keyboard.
- **3.4 Catch-up.** Where the provider marks a channel as having archive, past programmes in the guide play via `timeshift.php` through the same relay; these are seekable, so the skip-amount and speed controls work exactly as for files. Check: a past programme from the fake provider plays and +N skipping moves by the chosen amount.
- **3.5 Provider movies and series.** Xtream VOD and series appear as "IPTV Movies" and "IPTV Series" sections, matched through TMDB by title and year like local files, and playable through the relay (remux or direct). Check: fake provider VOD shows up matched with artwork and plays.
- **3.6 Android Live tab.** Phone and TV apps gain Live: categories, channels with now/next, playback via ExoPlayer taking raw TS; catch-up uses the same player with skip and speed. Check: emulator UI test opens a channel from the fake provider.

Nothing here is written to the frozen contract's existing shapes; new routes and schemas are added alongside (additive, per API.md).

### Phase 4 — TV shell + Tizen

- **4.1 TV shell scaffold.** `?tv=1` switch, spatial navigation provider, focusable tile and row primitives, back-key handling. Check: Playwright with arrow keys moves focus across a row and into detail.
- **4.2 TV screens.** Home, Movies, TV Shows, Anime, detail, on-screen keyboard search. Check: every pointer-shell route has a TV equivalent reachable by keys only.
- **4.3 TV player controls.** Remote-key transport (play/pause, seek by the chosen skip amount, back), track pickers and the skip/speed selectors as focusable menus, resume prompt. Check: keyboard-only Playwright playback test passes.
- **4.4 Tizen build target.** Vite config with `chrome63` target and core-js, style lint forbidding flex `gap`, `:has`, container queries, list virtualization, small image widths. Check: bundle builds and the lint rule catches a deliberate flex `gap`.
- **4.5 Tizen packaging.** `tizen/config.xml`, icons, static device profile with `ts` segments, `.wgt` build script, `docs/tizen.md` for developer mode and certificates. Check: `.wgt` installs and launches on the Q70B and reaches Home.
- **4.6 AVPlay adapter.** `AvPlayPlayer` implementing the `Player` interface, HTML5 video fallback flag. Check: h264 mp4 direct and hevc mkv transcode both play on the Q70B with seek and subtitles.
- **4.7 RU7100 bring-up.** Install on the RU7100, fix Chromium 63 breakages, profile memory. Check: 15 minutes of browsing and one full episode without a crash.
- **4.8 OpenSubtitles.** API key and login settings, moviehash computation, search by hash + TMDB id, on-demand download from the player menu, cache to `DATA_DIR/subtitles`. Check: a fixture with no subtitles gets one from the player menu on both TVs.

### Phase 5 — iPad

- **5.1 Xcode project.** SwiftUI app, iOS 15.0 deployment target, free-ID signing, `docs/ipad.md`. Check: empty app installs and launches on the iPad.
- **5.2 API client + auth.** Generated or hand-written `Codable` client, keychain token store, login. Check: unit test lists libraries from a local server.
- **5.3 Browse screens.** `NavigationView` based Home, Movies, TV Shows, Anime, detail. Check: reach an episode detail on the device.
- **5.4 Player.** AVPlayer with HLS subtitle renditions, direct play for mp4, remux for mkv, track pickers, skip-amount and speed selectors, PiP, progress on timer and background. Check: mkv fixture plays with subtitles and PiP; progress shows in the web app.
- **5.5 Cross-client pass.** Start on web, resume on Android TV, finish on iPad. Check: watched state matches everywhere.

Phases 2 to 5 depend on the frozen contract from 1.18; Phase 3 extends it additively. Order was chosen by the user: Android, then Live TV, then Samsung TV, then iPad.

## Verification

- **Unit (vitest):** filename parser against a table of 50+ real-world scene names and 30+ fansub names (groups, absolute numbers, v2 tags, batch folders); absolute-to-season mapping against a show with uneven season lengths; playback decision matrix (profile × file → direct/remux/transcode); HLS playlist math (segment count, seek-to-segment mapping); VTT conversion.
- **Integration (vitest + fixtures):** start server against `scripts/make-fixtures.sh` output, scan, assert items and streams; request an HLS session, fetch segment 0 and segment 40, assert ffmpeg restarted once and both segments decode with ffprobe; extract embedded srt and assert VTT output.
- **Hardware:** on the Linux box, `vainfo` inside the container, then a transcode session and `intel_gpu_top` showing video engine load. Log line confirms `h264_vaapi` chosen.
- **Web:** Playwright smoke test (login, browse, open detail, start playback, seek, subtitle toggle) for both shells using `?tv=1` and simulated arrow keys. Manual check in Chrome, Firefox, Safari.
- **Tizen:** run on both TVs; check playback of h264 mp4 direct, hevc mkv (transcode), seek, subtitles, back key, resume from Continue Watching. Watch memory on the RU7100 after 15 minutes of browsing.
- **Android:** unit tests in `:core`; run on an Android TV emulator image and a phone emulator; confirm D-pad on TV and touch on phone; verify AC3 source triggers audio transcode on a device that reports no AC3 decoder.
- **iPad:** build for the real iPad (iOS 15 simulator runtimes may not be downloadable in current Xcode, so the device is the primary test target); verify MKV remux path plays with subtitle renditions, PiP works, progress syncs to the web app.
- **Cross-client:** start a show on the web, resume on Android TV, finish on iPad; watched state consistent everywhere.

## Risks and mitigations

- **Scope.** Five clients is a lot. The phase gates and the frozen API contract keep each client independent; the MVP is Phase 1 alone.
- **Intel driver generation.** Newer iGPUs need the non-free media driver; older ones use i965. The container ships both and the startup self-test picks one, falling back to libx264 with a visible warning.
- **OpenSubtitles quota.** On-demand fetch only, cached forever, embedded subtitles preferred.
- **RU7100 memory and Chromium 63.** Separate Vite target, style lint, virtualized lists, small images. If AVPlay proves flaky on Tizen 5.0, HTML5 `<video>` with TS HLS is the fallback.
- **Free Apple ID.** 7-day expiry is a known annoyance, not a blocker; documented.
- **Anime season mapping.** AniList and TMDB split seasons differently for long-running shows, so a wrong automatic mapping is likely for some titles. The per-show season offset override in fix-match is the escape hatch, and the "Needs review" list flags shows where the episode counts do not reconcile.
- **Filename parsing quality.** Anything below the confidence threshold is surfaced in a "Needs review" list with one-click TMDB search, so bad guesses never silently pollute the library.

## Resolved questions

1. Artwork and fetched subtitles: server data directory.
2. Client order after the MVP: Android, then Live TV, then Samsung TV, then iPad.
3. Login: numeric PIN per profile, with rate limiting and lockout.
