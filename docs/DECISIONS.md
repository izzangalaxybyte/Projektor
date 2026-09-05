# Decisions

Dated log of choices that are not obvious from the code. Newest last.

## 2026-09-05 — Build from scratch, borrowing Jellyfin's approach

Rather than fork Jellyfin, build a smaller system in TypeScript with the same proven techniques: ffmpeg-driven HLS with on-demand segments, TMDB metadata, OpenSubtitles, and per-device capability profiles. Reason: full control over the client experience on five platforms and a codebase the owner can hold in their head.

## 2026-09-05 — Fully native clients

Web for browsers and Samsung Tizen, Kotlin/Compose for Android phone and TV, SwiftUI/AVPlayer for iPad. Chosen over a single wrapped web app for best codec support and playback on each device. Cost: three client codebases, mitigated by generating every client SDK from one OpenAPI document.

## 2026-09-05 — Anime is its own library type

`anime` sits beside `movie` and `tv`, shares the show/season/episode tables, and is excluded from every TV query and UI section. Fansub names are parsed with an Anitomy port and matched against AniList, with absolute episode numbers mapped onto TMDB seasons. Reason: the owner wants anime separate, and anime naming and numbering conventions differ enough to need their own parser and metadata source.

## 2026-09-05 — PIN login per profile

Users pick a profile and enter a 4 to 6 digit PIN. Weak by design because TV remotes make passwords painful and the server is LAN only. Mitigations: Argon2id hashing, per-user and per-IP rate limits with lockout, bind to the LAN interface by default.

## 2026-09-05 — Artwork and subtitles live in the server data directory

Media folders are mounted read-only. Nothing is written beside the media files. Reason: portability and safety; the cache can be rebuilt from TMDB and OpenSubtitles.

## 2026-09-05 — Client order: Android, then Samsung TV, then iPad

Owner's preference. Android phone and TV share one Gradle project, so they come together.

## 2026-09-05 — TypeScript pinned to 6.x

typescript-eslint does not support TypeScript 7. Revisit when it does.

## 2026-09-05 — Fastify 5 with zod, not Fastify 4

The plan said Fastify 4; Fastify 5 is current and `fastify-type-provider-zod` 7 requires it. No downside for a new codebase.

## 2026-09-05 — Documentation is part of every sub-phase

`docs/PROGRESS.md`, `ARCHITECTURE.md`, `DEV.md`, `API.md`, and this file are updated in the same PR as the code. A sub-phase is not done until its docs are.

## 2026-09-05 — SQLite through better-sqlite3 and Drizzle

Single-file database, synchronous driver, no server process to run on the Linux box. Drizzle gives typed queries and SQL migrations generated from the schema file, applied automatically on start. WAL mode so the scanner can write while clients read. Chosen over Prisma (heavier runtime, its own engine binary) and raw SQL (no types).

## 2026-09-05 — Missing files are flagged, not deleted

`media_files.missing` is set when a scan no longer finds a file. The row and any playback state stay. Reason: renames and folder moves are common with downloaded media, and losing watch history for them is worse than a stale row.

## 2026-09-05 — Lockout numbers and status codes

Five wrong PINs lock a profile for fifteen minutes; login is also capped at twenty attempts per minute per IP. A four-digit PIN has ten thousand combinations, so these limits make online guessing take weeks. Locked profiles answer 423 Locked rather than 401 so clients can show a specific message. Unknown profile ids answer 401 with the same message as a wrong PIN, and the server still runs an Argon2 verify so timing does not reveal which it was.

## 2026-09-05 — Tokens are stored hashed

Sessions hold a SHA-256 of the bearer token, never the token. Tokens are 32 random bytes so a fast hash is enough; Argon2 is reserved for the low-entropy PINs.

## 2026-09-05 — Scan compares size and mtime, not hashes

A file is "unchanged" when its size and mtime match the last scan. Hashing a multi-gigabyte library on every scan is not worth it; the rare false negative (same size, same mtime, different content) is corrected by a manual rescan after a rename.

## 2026-09-05 — Probe failures are recorded, not retried every scan

A file ffprobe rejects gets `probedAt` set and the error stored in `probeJson`. Retrying it on every scan would waste time on files that will never play. The scanner clears `probedAt` when size or mtime change, so a repaired or replaced file is probed again.

## 2026-09-05 — Fixture files with subtitles use `-t`, not `-shortest`

`-shortest` ends the output at the shortest input, and a subtitle input ends at its last cue. The anime and TV fixtures were 8 seconds long instead of 30 until this was caught by the probe tests.

## 2026-09-05 — Items exist before metadata

Files are linked to locally created movies, shows, seasons, and episodes as soon as they are parsed, flagged `needsReview`. Metadata matching later fills in TMDB and AniList data and clears the flag. Reason: the library is browsable and playable immediately after a scan, even with no API keys configured, and nothing is hidden because a match failed.

## 2026-09-05 — Multi-episode files link to the first episode

`S01E01-E02` parses with `episodeEnd = 2` but the file links only to episode 1. Storing the range in the database is deferred until a client needs to show it.

## 2026-09-05 — Own fansub parser instead of anitomyscript

The plan named `anitomyscript`, an Emscripten port of Anitomy. Its WASM loader is broken on current Node (it detects the global `fetch` and tries to fetch a filesystem path, then aborts) and the package has not been updated to fix it. A focused TypeScript parser with a 36-name test table covers the conventions fansub groups actually use and is easier to extend when a new pattern shows up. The dependency was removed.

## 2026-09-05 — Season phrases split into title and searchTitle

`Jujutsu Kaisen 2nd Season - 05` groups under the show `Jujutsu Kaisen`, season 2, episode 5 in our database, but AniList lists `Jujutsu Kaisen 2nd Season` as its own entry. The parser keeps both forms so grouping and metadata search each get the name they need.

## 2026-09-05 — Unmatched items are searched once, not every scan

`movies.match_attempted_at` and `shows.match_attempted_at` record the attempt. An item TMDB could not match stays in the needs-review list until someone fixes it by hand; re-searching it on every scan would spend API calls to reach the same answer.

## 2026-09-05 — Artwork variants are produced on demand

Originals are downloaded once at TMDB's `w780` or `w1280`; the 300/780/1280 JPEG variants are created the first time a client asks for that width and cached. Resizing everything at scan time would triple the work for images most clients never request at that size.

## 2026-09-05 — Stacked PRs are merged with merge commits, branches deleted last

See DEV.md. Learned the hard way when `--delete-branch` on the first PR in the stack closed the rest.

## 2026-09-05 — AniList then TMDB for anime, not "TMDB id from AniList"

The plan assumed AniList exposes a TMDB id. It does not (only a MyAnimeList id), so the anime matcher searches TMDB by the AniList titles and year and accepts only a confident match. The AniList step alone is enough to make a show browsable; the TMDB step adds season structure and episode titles.

## 2026-09-05 — Season offset is added to the absolute number

`shows.season_offset` is a plain integer added before mapping. Offset 12 makes a sequel entry whose fansub numbering restarts at 1 land on TMDB season 2 of a 12-episode first season. Simple to reason about and enough for the fix-match UI to expose as one field.

## 2026-09-05 — One injectable outbound fetch on the app

`app.httpFetch` is the only way server code reaches TMDB, AniList, or artwork. Tests inject a router over the fake servers and exercise real routes end to end. Mocking modules or spying on `globalThis.fetch` would have been more fragile and would not have covered the wiring in the scan route.

## 2026-09-05 — A folder change triggers a full library reconcile, not a per-file update

The watcher only tells the runner "this library changed". The scan then walks the whole library, which the size+mtime check makes cheap, and probes only what changed. Per-file handling would duplicate the reconcile logic and get the missing-file case wrong for renames.

## 2026-09-05 — Scans are serialised

One scan at a time across all libraries. ffprobe already runs four wide inside a scan, and two libraries probing at once would only fight for disk. Requests during a run coalesce into a single rerun.

## 2026-09-05 — Token in the query string for read-only media requests

`<video>`, `<img>`, and some TV players cannot set headers, so GET and HEAD under `/api` accept `?access_token=`. It is refused on every other method, so a leaked URL can at most read what the profile could already read. Jellyfin uses the same pattern with `api_key`.

## 2026-09-05 — Device profiles are declared by the client, not sniffed by the server

Each client sends what it can play. User-agent sniffing is unreliable on TVs and the client is the only place that can ask the platform (MediaCapabilities, MediaCodecList, AVPlayer) what it supports. Profiles for our own clients live in the client code.

## 2026-09-05 — Subtitles never influence the playback decision

Text subtitles are delivered as WebVTT beside the stream (1.16), so the choice between direct, remux, and transcode depends only on container, video, and audio. Burn-in is out of scope for v1.

## 2026-09-05 — Remux playlists are written by ffmpeg, transcode playlists by us

When streams are copied, segment boundaries fall on the source's keyframes, which are unknown until ffmpeg has written the segment, so the remux path serves ffmpeg's event playlist as it grows. Remuxing is I/O bound and finishes a feature film in well under a minute, so seeking beyond the written part only waits briefly. Transcoding forces keyframes every 6 seconds, which makes the playlist predictable and lets a seek restart ffmpeg at the right segment.

## 2026-09-05 — Playback sessions live in memory

Sessions are ephemeral: a restart drops them and clients simply ask for a new decision. Persisting them would add a table and a cleanup problem for no user-visible benefit.

## 2026-09-05 — Seeks restart ffmpeg at the requested segment

Rather than transcode a whole film ahead of the viewer, ffmpeg runs from the current position and is restarted whenever a request lands more than three segments ahead of what exists, behind the run's start, or after the run finished. Forced keyframes make segment boundaries deterministic, so segments from earlier runs stay valid and are served from disk. This is the same shape as Jellyfin's transcoding, without its keyframe extraction step because we do not remux this way.

## 2026-09-05 — CRF for software, QP or bitrate for VAAPI

libx264 uses CRF 23 with an optional `maxrate` from the profile; `h264_vaapi` has no CRF, so it uses `qp 23` when the profile sets no bitrate and constant bitrate when it does.

## 2026-09-05 — Hardware encoding is decided once at startup

A one-frame `h264_vaapi` encode at boot tells us whether the GPU path works. Deciding per session would repeat the probe for every viewer and make failures harder to see; deciding at boot gives one log line and one health field to check after deploy. The setting can still force either path.

## 2026-09-05 — Subtitles are one WebVTT "segment" in HLS

Each subtitle rendition's media playlist lists the whole track as a single segment spanning the media duration. Apple's spec allows it, hls.js, AVPlayer, and ExoPlayer accept it, and it avoids splitting VTT cues on segment boundaries. Web browsers get the same VTT through `/api/subtitles/{id}.vtt` and render it with our own overlay.

## 2026-09-05 — Playlists carry the query token when the client used one

Players resolve `seg-0.ts` relative to the playlist URL without its query string, so a token passed as `?access_token=` would be lost on segment requests. The server appends it to every URI in playlists it serves when, and only when, the request itself used a query token. Header-authenticated clients see clean playlists.

## 2026-09-05 — Watched is sticky at 90%

An item counts as watched once a position at or past 90% of its duration is reported, and stays watched when replayed from the beginning. Credits make "100%" unreliable, and un-watching something because a viewer skimmed the opening again is worse than leaving it marked. Explicit unwatch removes the state.

## 2026-09-05 — Progress rides on every summary

`ItemSummary.progress` is filled per caller by the items service rather than fetched from a separate endpoint. Every client screen that shows a poster also shows a progress bar, so one round trip instead of two on every list.

## 2026-09-05 — Stacked PRs must be retargeted by hand before each merge

See DEV.md. GitHub retargets nothing on its own; the catch-up PR #21 was the cost of assuming it would.

## 2026-09-05 — Contract 1.0.0 is frozen; changes are additive

The Android, Tizen, and iPad clients generate their SDKs from `openapi.json`. Freezing it now lets them start without waiting for the web app. A test compares the committed document with the live server so drift cannot ship unnoticed. Booleans in query strings are parsed from the literals `true`/`false`; zod's `coerce.boolean` treats any non-empty string as true, which silently broke `needsReview=false`.

## 2026-09-05 — React 19, one server in production

The plan said React 18; React 19 is current, `@vitejs/plugin-react` and TanStack Query support it, and there is no code to migrate. The server serves the built web app itself (`WEB_DIST`) so the Linux box runs one process and one port, and the browser talks to the API same-origin with no CORS.

## 2026-09-05 — End-to-end tests run the real server, not mocks

Playwright drives the built app against the actual API with a temporary data directory and the fixture media. Mocking the API in the browser would have missed the wiring bugs this project has actually had (auth hooks, playlist tokens, serializer schemas).

## 2026-09-05 — Subtitles are rendered by our own overlay, not native tracks

The web player fetches the WebVTT and draws the active cues itself. Native `<track>` rendering differs between browsers, is poor on the 2019 Samsung TV, and cannot be styled consistently; one overlay component gives identical results everywhere and doubles as the TV implementation.

## 2026-09-05 — Playback tests run in branded Chrome

Playwright's Chromium has no proprietary codecs, so a passing test there would prove nothing about H.264 playback. The e2e config uses `channel: 'chrome'`.

## 2026-09-05 — HEVC remuxes are tagged hvc1

ffmpeg writes `hev1` sample entries for copied HEVC by default. Safari and browsers' MediaSource want `hvc1`, so remuxes add `-tag:v hvc1`. Found while getting the web player to play the HEVC fixture in Chrome.

## 2026-09-05 — One container, root by default, media read-only

The image bundles API, transcoder, and web app; the Linux box runs one thing. It runs as root so `/dev/dri` opens without host-specific group ids (the compose file shows how to run as a user with `group_add`). Media mounts are read-only because nothing is ever written beside the files. `tini` is PID 1 so killed ffmpeg processes do not linger as zombies.

## 2026-09-05 — Intel drivers are installed only on amd64

The image builds on an Apple Silicon Mac for testing, where the Intel packages do not exist. The Dockerfile installs them only when `dpkg --print-architecture` is amd64, which is what the Linux box is.

## 2026-09-05 — Skip amount is a first-class, persisted setting

The owner's primary reason for the app is that skipping moves by an amount they choose, not a fixed 10 seconds. The selector offers 3 to 15 seconds, the speed selector 0.5× to 2×, both persist per device, and both are required in every client's player rather than being a web nicety. Recorded in the plan under "Core player behaviour".

## 2026-09-05 — Never clear a p-limit queue mid-run

After a TMDB 401 the matcher used to call `clearQueue()` on its concurrency limiter. Tasks still queued then never settle, and the `Promise.all` waiting on them hung the scan in its matching phase forever. A `keyRejected` flag now makes queued items fail fast instead. Found by the e2e suite: a rescan after a bogus key never finished.

## 2026-09-05 — First remux playlist waits briefly for ENDLIST

hls.js treats a growing EVENT playlist as live and starts near its end unless told otherwise. The player now passes an explicit start position, and the server holds the first `index.m3u8` of a remux for up to 8 seconds so short and fast remuxes present as a finished VOD playlist. Long remuxes still stream as EVENT. Upstream TMDB and AniList requests also gained a 15 second timeout so a slow network can never stall a scan.

## 2026-09-05 — Android builds with Android Studio's JDK, not the system JDK

The Mac has JDK 25, which is newer than the Android Gradle Plugin certifies. The build instructions point `JAVA_HOME` at Android Studio's bundled JDK 21, and Kotlin/Java target 17 in every module so the byte code is unremarkable.

## 2026-09-05 — The Kotlin client is generated at build time, not committed

`:core` runs the OpenAPI Generator during the Gradle build and compiles the output from `build/`. Committing generated Kotlin would invite hand edits and drift from `openapi.json`; generating on every build costs a few seconds and keeps one source of truth. Requests default to Ktor's OkHttp engine; tests inject a MockEngine.

## 2026-09-05 — Media source construction is a pure function over strings

`mediaSpecFor` returns URIs and MIME types as strings so it is unit tested without Android; a one-line extension turns it into a `MediaItem`. Direct play sideloads WebVTT tracks, HLS relies on the master playlist's renditions, both with the token in the query because ExoPlayer's data source cannot be given per-request headers from the decision alone.

## 2026-09-05 — Nulls are sent explicitly from the Android client

The contract marks nullable fields as required. Omitting `maxWidth: null` made zod reject the decision request with a 400 that the generated client then tried to parse as a decision. `explicitNulls` stays on, and `bodyOrThrow()` surfaces the server's error message for every non-2xx response.

## 2026-09-05 — TV focus is requested from inside the focused component

Requesting focus on a tile from the screen level raced the lazy list and failed silently, leaving the remote on the first focusable element instead. Tiles and the Play button now request focus from their own composition, which cannot run before they exist. The same applies to the first profile card and the PIN field on the sign-in screen.

## 2026-09-05 — TV tests use remote keys, and adb reverse for the dev server

tv-material controls ignore Compose's touch-style `performClick`, so TV UI tests press D-pad keys through UiAutomator, which is also what a real remote does. The Android TV emulator image cannot reach the host via `10.0.2.2`; `adb reverse` maps the server port into the emulator instead.

## 2026-09-05 — Left and Right on the remote are the skip keys

While the TV player's controls are hidden, Left/Right jump by the chosen skip amount rather than scrubbing a timeline, because that is the whole point of the app for its owner. The control bar appears on Up/Down, so seeking the slider is still possible, and the media keys behave as expected at all times. The next episode starts on its own after a ten-second countdown, since a TV viewer usually has the remote out of reach by then.

## 2026-09-05 — The server address is baked in for now

The Linux box always has `192.168.100.20`, so `http://192.168.100.20:8096` is a constant in every client (`DEFAULT_SERVER_URL` in `:core` for Android, `web/src/config.ts` for the web and Tizen builds). Sign-in screens prefill it, so Continue is one press and a TV remote never has to spell an IP. The field stays editable for a different box or a later address change. Discovery over mDNS is the eventual replacement.

## 2026-09-05 — IPTV is integrated server-side through the Xtream Codes API

The owner's subscription (`http://playshare.co:8080/`) exposes the Xtream API. Credentials are stored once in server Settings; the server fetches channels, guide, VOD, and series, and relays streams so devices never see the provider or its credentials, browsers avoid cross-origin blocks, and streams can be remuxed for players that cannot take raw MPEG-TS. Catch-up programmes are seekable, so the skip-amount and speed controls apply to them. Live TV became Phase 3; Samsung TV and iPad moved to Phases 4 and 5.

## 2026-09-05 — Recordings are files the server makes from the live relay

A recording is the same ffmpeg copy that feeds a live viewer, written to `DATA_DIR/recordings` instead, so no second stream is pulled from the provider when both happen at once. Timed, until-programme-end, and manual stops all end the same process. Finished recordings are items of their own kind, so they get resume, skip amount, and speed for free, and they are kept on the server's disk rather than beside the owner's media. Remote triggering is deferred to a remote-access phase; scheduling from the guide covers recording while away.

## 2026-09-05 — The IPTV provider URL is a setting with an env default

The provider moves to a new address every few months and its HTTPS endpoint fails the TLS handshake, so the URL is plain HTTP and lives in two places that need no rebuild: `IPTV_URL` in the container environment supplies the default, and the admin can override it under Settings without touching the box. The web and Android clients never see the provider URL at all; they talk to the server's `/api/live` routes.

## 2026-09-05 — The guide is replaced wholesale on each refresh

Every six hours the server pulls the full XMLTV document and swaps the `live_programmes` table for it in one transaction, keeping only programmes for channels the provider still lists. Providers rewrite schedules freely and give no change feed, so a merge would keep stale entries. Channels and categories are upserted by provider id and dropped when they disappear, so channel ids stay stable for recordings and favourites. A failed refresh leaves the previous data in place and records the error on `/api/live/status`.

## 2026-09-05 — One provider connection per channel, fanned out

Xtream accounts allow one or two simultaneous connections, so the server never pulls a channel twice. A relay opens the provider stream once and copies each chunk to every subscriber; the direct TS route, the live HLS packager, and the recorder (3.7) are all just subscribers. The connection lingers five seconds after the last subscriber leaves so flipping back to a channel does not reconnect. The limit is enforced server-side with `LIVE_MAX_STREAMS` rather than discovered at play time from the provider's error.

## 2026-09-05 — Live HLS copies video and re-encodes audio to AAC

Browsers' MediaSource takes H.264 and HEVC but not the MP2 or AC-3 audio common on broadcast channels, and the server does not probe a live stream before packaging it. Audio is always re-encoded to stereo AAC at 160 kb/s, which costs a few percent of one core per viewer, while video is copied so no GPU is involved. The playlist is ffmpeg's own sliding window (six 4-second segments), served as written; there is no VOD playlist to precompute and no seek-restart logic, so live sessions have their own small manager rather than a mode inside the VOD one.

## 2026-09-05 — hls.js first, native HLS only without MediaSource

`HtmlVideoPlayer` used the browser's own HLS whenever `canPlayType` said `maybe`. Desktop Chrome 148 says `maybe` yet fails a live playlist with `MEDIA_ERR_SRC_NOT_SUPPORTED`, which cost an afternoon. Now hls.js is used wherever `Hls.isSupported()` (any browser with MediaSource, Safari included) and native HLS is the fallback for iOS-class browsers only. hls.js also gets a 30 s first-byte allowance on playlists because the server deliberately holds the first request until ffmpeg has produced a segment.

## 2026-09-05 — Live TV is a section with a remote-style player, not a library

Channels are not items: they have no files, progress, or artwork cache, and their metadata is a guide that changes hourly. So Live TV has its own routes, hooks, list page, and player. The player borrows the look of the file player but drops the seek bar and the skip and speed controls, which only make sense for catch-up (3.4). Channel up/down, digit entry, and a guide key mirror a TV remote so the same behaviour ports directly to the Android TV and Tizen clients.
