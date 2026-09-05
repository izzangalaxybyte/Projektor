# Progress

One row per sub-phase from [PLAN.md](PLAN.md). Status is `todo`, `in progress`, or `done`. The check column records how the sub-phase's exit check was actually run.

## Phase 0 — Scaffold and contract

| Sub-phase           | Status | Landed in | Check                                                                                                           |
| ------------------- | ------ | --------- | --------------------------------------------------------------------------------------------------------------- |
| 0.1 Repo skeleton   | done   | `cb426bb` | `pnpm install` succeeds                                                                                         |
| 0.2 Tooling         | done   | `a2cfef6` | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` all green                                       |
| 0.3 Fixtures script | done   | `f726a3c` | `scripts/make-fixtures.sh` ran; ffprobe showed expected streams on all four files                               |
| 0.4 Contract v0     | done   | `0c6e243` | server typecheck green; `GET /api/health` returned 200 over HTTP; generated client compiles and its test passes |

## Phase 1 — Server + browser app (MVP)

| Sub-phase                                        | Status | Landed in             | Check                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 Database + config                            | done   | PR #2                 | fresh `DATA_DIR` start created the SQLite file with 13 tables and the layout dirs; second start applied no migrations; `db/index.test.ts` covers both                                                                                                                                                                                                                                                 |
| 1.2 Auth + setup wizard                          | done   | PR #3, merged via #8  | `routes/auth.test.ts`: 401 without token, setup creates admin, PIN login, fifth wrong PIN locks (423) and the right PIN stays locked, revoke and logout invalidate tokens, per-IP 429; same flow repeated with curl against a real server                                                                                                                                                             |
| 1.3 Library CRUD + file walk                     | done   | PR #4, merged via #8  | `library/scanner.test.ts` (temp tree: video-only, hidden skipped, idempotent, modified/missing/returned, unreadable dir) and `routes/libraries.test.ts` (admin 403, bad path 400, CRUD, scan of `fixtures/` records 4 files then 0 changed, delete cascades)                                                                                                                                          |
| 1.4 ffprobe + streams                            | done   | PR #5, merged via #9  | `media/ffprobe.test.ts`: anime fixture reports h264 + jpn/eng aac + ass, tv fixture hevc/ac3/subrip, mp4 movie, junk file throws; `media/probe-service.test.ts`: 4 probed / 1 failed, streams replaced not duplicated; scan endpoint reports `filesProbed: 4`                                                                                                                                         |
| 1.5 Scene filename parsing                       | done   | PR #6, merged via #9  | `identify/scene-parser.test.ts`: 56-name table (30 episode, 26 movie) incl. multi-episode, 1x05, folder hints, Plex folders; `identify/identifier.test.ts`: grouping by title+year, shows/seasons/episodes, duplicates share a row, broken files skipped, idempotent; `routes/items.test.ts`: scan links 4 fixtures, list/filter/search/paginate, show → season → episode with streams                |
| 1.6 Fansub filename parsing                      | done   | PR #7, merged via #10 | `identify/fansub-parser.test.ts`: 36-name table (groups, absolute numbers, v2, ranges, `2nd Season`/`S2`/`Part 2`, `(2022) (Season 1)`, underscores, folder hints, no number); `identifier.test.ts` anime case; `routes/items.test.ts`: anime fixture becomes show `Sample Anime` with episode 13 listed by absolute number, jpn + eng audio                                                          |
| 1.7 TMDB matching + artwork                      | done   | PR #11                | `metadata/score.test.ts` ranking rules; `metadata/matcher.test.ts` against a fake TMDB: movie matched with genres/runtime/poster cached, weak match stays in review with attempt recorded, show fills only seasons with local files, anime skipped, rejected key counted as failure; settings PATCH + masked GET and images 404 checked with curl                                                     |
| 1.8 AniList matching + season mapping            | done   | PR #12                | `metadata/season-map.test.ts` uneven seasons, specials ignored, offsets, out of range; `metadata/anime-matcher.test.ts` against fake AniList + fake TMDB: 37-episode show maps 1/12/13/37 onto S1/S2 with titles, 99 stays unmapped, offset 12 shifts to S2, no TMDB key keeps absolute numbering, weak match attempted once                                                                          |
| 1.9 Fix-match endpoint                           | done   | PR #13                | `routes/fix-match.test.ts` over the fixtures with fake TMDB + AniList injected through `buildApp({ fetch })`: scan auto-matches Sample Movie/Show/Anime and leaves the loose file in review; candidates for it rank Heat first; applying tmdbId 101 clears review; anime seasonOffset 12 remaps ep 13 to S2E13; anilistId accepted; 400/403/404 cases                                                 |
| 1.10 Watcher + manual scan                       | done   | PR #14                | `library/watcher.test.ts`: copying a fixture into a watched folder produces an item with no manual scan and removing it flags the file missing; two POSTs during a run coalesce into one rerun; existing route tests moved to queue-and-poll via `scanAndWait`                                                                                                                                        |
| 1.11 Direct play                                 | done   | PR #15                | `routes/files.test.ts`: `parseRange` table; whole file 200 with size and `video/x-matroska`; `bytes=0-99` → 206 with EBML magic; suffix range; 416; HEAD; `?access_token=` accepted on GET only; 404. Live: `curl -I`, ranged GET, and `ffprobe` reading the stream over HTTP                                                                                                                         |
| 1.12 Playback decision                           | done   | PR #16                | `playback/decision.test.ts` matrix: direct, remux (container only), remux + audio transcode, transcode with audio copy, transcode both, width/bitrate limits, default vs requested audio track, case-insensitive codecs, no video; `routes/playback.test.ts` over fixtures: mp4 direct for Chrome, hevc mkv transcode for Chrome with a session, remux for Safari, dual-audio switch remuxes, 400/404 |
| 1.13 HLS remux                                   | done   | PR #17                | `playback/ffmpeg-args.test.ts` exact argument arrays; `routes/hls.test.ts` over the hevc/ac3 fixture: mpegts and fmp4 sessions play back through the API, playlists sum to ~30s, segments ffprobe as hevc + ac3 (or aac when re-encoded), 404s, DELETE removes the directory, idle sweep, transcode sessions answer 501 until 1.14                                                                    |
| 1.14 HLS transcode + seek restart                | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.15 VAAPI path                                  | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.16 Embedded + sidecar subtitles                | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.17 Progress + continue watching + next episode | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.18 Contract freeze                             | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.19 Web shell + auth                            | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.20 Browse screens                              | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.21 Player                                      | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.22 Settings + fix-match UI                     | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.23 Docker + deploy                             | todo   |                       |                                                                                                                                                                                                                                                                                                                                                                                                       |

## Phase 2 — Android phone + Android TV

| Sub-phase                   | Status | Landed in | Check |
| --------------------------- | ------ | --------- | ----- |
| 2.1 Gradle skeleton         | todo   |           |       |
| 2.2 Generated client + auth | todo   |           |       |
| 2.3 Device profile          | todo   |           |       |
| 2.4 ExoPlayer wrapper       | todo   |           |       |
| 2.5 Mobile browse           | todo   |           |       |
| 2.6 Mobile player           | todo   |           |       |
| 2.7 TV browse               | todo   |           |       |
| 2.8 TV player               | todo   |           |       |

## Phase 3 — TV shell + Tizen

| Sub-phase              | Status | Landed in | Check |
| ---------------------- | ------ | --------- | ----- |
| 3.1 TV shell scaffold  | todo   |           |       |
| 3.2 TV screens         | todo   |           |       |
| 3.3 TV player controls | todo   |           |       |
| 3.4 Tizen build target | todo   |           |       |
| 3.5 Tizen packaging    | todo   |           |       |
| 3.6 AVPlay adapter     | todo   |           |       |
| 3.7 RU7100 bring-up    | todo   |           |       |
| 3.8 OpenSubtitles      | todo   |           |       |

## Phase 4 — iPad

| Sub-phase             | Status | Landed in | Check |
| --------------------- | ------ | --------- | ----- |
| 4.1 Xcode project     | todo   |           |       |
| 4.2 API client + auth | todo   |           |       |
| 4.3 Browse screens    | todo   |           |       |
| 4.4 Player            | todo   |           |       |
| 4.5 Cross-client pass | todo   |           |       |
