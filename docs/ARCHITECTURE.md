# Architecture

Describes what exists now. Planned components are in [PLAN.md](PLAN.md) and move here as they land.

## Packages

- `server` — Fastify 5 API. Requests and responses are validated with zod through `fastify-type-provider-zod`, which also produces the OpenAPI 3.1 document at runtime via `@fastify/swagger`. Entry points: `src/main.ts` (listen), `src/app.ts` (`buildApp`, used by both main and tests), `src/openapi.ts` (writes the document to the contract package).
- `packages/api-contract` — `openapi.json` emitted by the server, `src/schema.d.ts` generated from it by `openapi-typescript`, and `createProjektorClient`, a thin wrapper over `openapi-fetch` that injects a bearer token on every request. This is the only way clients written in TypeScript talk to the server; Kotlin and Swift clients will be generated from the same `openapi.json`.
- `web` — placeholder until sub-phase 1.19.

## Configuration and data directory

`server/src/config.ts` parses the environment with zod into a `Config` and creates the `DATA_DIR` layout (`projektor.sqlite`, `images/`, `subtitles/`, `transcode/`). `buildApp` takes a `Config`, opens the database, and decorates the Fastify instance with `config` and `db` so routes reach both through `app`. Tests get an isolated `Config` in a temp directory from `test-utils.ts`.

## Authentication

`server/src/auth/` holds the pieces. `pin.ts` hashes PINs with Argon2id. `tokens.ts` generates 32-byte random bearer tokens and hashes them with SHA-256 for storage, so a leaked database does not leak usable tokens. `service.ts` is `AuthService`: setup, profile listing, login with the failed-attempt counter and lockout, token resolution, and session revocation. `plugin.ts` registers the service on `app.auth`, adds an `onRequest` hook that rejects any `/api` request without a valid token unless the route sets `config.public`, and exposes `app.requireAdmin` as a preHandler for admin-only routes. Routes live in `routes/auth.ts`.

Login is rate limited per IP with `@fastify/rate-limit` (registered with `global: false`, applied only where a route sets `config.rateLimit`). Lockout is per profile: five wrong PINs lock it for fifteen minutes.

## Libraries and scanning

`server/src/library/service.ts` is `LibraryService`: create (validates every path is a directory, stores resolved and de-duplicated paths), list, get, delete. `walker.ts` is an async generator that walks a root breadth-first, yields files whose extension is in `VIDEO_EXTENSIONS`, skips dot-files and dot-directories, and reports unreadable directories through a callback instead of aborting. `scanner.ts` reconciles a library: for every walked file it inserts a new `media_files` row or, when size or mtime differ, updates the row and clears `probedAt` so the file is probed again; rows whose file was not seen are flagged `missing`, and a flagged row whose file reappears is unflagged. The scan returns counts plus the ids of files that need probing. Routes are in `routes/libraries.ts`; mutations require admin.

## Probing

`server/src/media/ffprobe.ts` runs `ffprobe -print_format json -show_format -show_streams` through execa with an argument array (never a shell string) and a 60 second timeout, validates the JSON with zod, and normalises it: a canonical container name (ffprobe reports demuxer lists like `matroska,webm`, so the file extension breaks ties), duration in milliseconds, overall bitrate, and one entry per video, audio, or subtitle stream with codec, language (`und` becomes null), title, default and forced flags, dimensions, and channel count. Attached-picture streams (cover art) are dropped. `probe-service.ts` probes a list of file ids with a concurrency limit of 4, writes the result to `media_files` and replaces the file's `streams` rows in one transaction. A file ffprobe cannot read still gets `probedAt` set, with the error kept in `probeJson`, so broken files are not re-probed on every scan; a later change to the file clears `probedAt` through the scanner and it is tried again.

## Identification

`server/src/identify/scene-parser.ts` turns a file name plus its folder names into a `ParsedName`: kind (movie or episode), title, year, season, episode, and an `episodeEnd` for multi-episode files. Episode markers are matched first with our own patterns (`S01E02`, `S01E02-E03`, `S01.E02`, `1x05`, `Season 1 Episode 5`); `parse-torrent-title` then supplies titles and years and strips release tags. Folder hints fill gaps: a `Season NN` or `Specials` parent makes the grandparent the show title, and a Plex style `Title (Year)` parent overrides a bare movie file name. Every result carries a `confidence` that is `low` when it had to guess.

`identifier.ts` links probed files to items. Movies group by library, normalised title (`sortKey`: lowercase, articles and punctuation removed), and year. Episodes group by show, season, and episode number; a file with no episode number gets its own row so it is visible for review. Seasons and shows are created on demand. Everything created here has `needsReview = true` until a metadata match confirms it. Files whose probe failed are left unlinked. The scan endpoint runs walk, probe, identify in that order.

`items/service.ts` is the read model behind `/api/items`: it maps the four tables to `ItemSummary` and `ItemDetail`, handles browsing by library kind, kind, parent, search, and review flag, and attaches files with their streams to movies and episodes.

## Data model

SQLite via better-sqlite3 with Drizzle ORM. WAL journal, foreign keys on. Text UUID primary keys, ISO 8601 UTC timestamps, milliseconds for durations.

| Table                          | Holds                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `users`                        | Profiles: name, Argon2id PIN hash, admin flag, avatar colour, failed-attempt counter and lockout time      |
| `sessions`                     | Bearer tokens (stored as SHA-256 hashes) with device name and last-seen time                               |
| `libraries`, `library_paths`   | A library has a kind (`movie`, `tv`, `anime`) and one or more folder paths                                 |
| `movies`                       | One row per movie item with TMDB metadata and artwork keys                                                 |
| `shows`, `seasons`, `episodes` | TV and anime share these; `shows.season_offset` and `episodes.absolute_number` exist for anime mapping     |
| `media_files`                  | One row per video file: path, size, mtime, probe results, `missing` flag, and a link to a movie or episode |
| `streams`                      | ffprobe video, audio, and subtitle tracks per file                                                         |
| `subtitles`                    | Embedded, sidecar, or OpenSubtitles tracks and the path of their cached WebVTT                             |
| `playback_state`               | Per user, per item position, duration, and watched flag                                                    |
| `settings`                     | Key-value store for TMDB and OpenSubtitles credentials and other admin settings                            |

Items link to files one-to-many, so several versions of a movie or episode are allowed. Files that vanish are flagged `missing` rather than deleted so watch state survives a move.

## API shape

All routes live under `/api`. Every named zod schema in `server/src/schemas/` carries a `meta({ id })` and is emitted under `components.schemas`, so the contract already shows the v0 shapes for auth, libraries, items, playback, and progress even though only `/api/health` is routed today. The document declares a `bearerAuth` security scheme; enforcement arrives in sub-phase 1.2.

Schemas in brief:

- `common` — `LibraryKind` (`movie | tv | anime`), `ItemKind` (`movie | show | season | episode`), pagination helpers, `ErrorResponse`.
- `auth` — `Profile`, `SetupStatus`, `SetupRequest`, `LoginRequest` (profile id + 4 to 6 digit PIN + device name), `LoginResponse`, `Session`.
- `libraries` — `Library` with one or more paths and a kind, `CreateLibraryRequest`, `ScanStatus`.
- `items` — `ItemSummary`, `ItemDetail` (with `files`, `children`, TMDB and AniList ids), `MediaFile` and `StreamInfo` from ffprobe, `ItemsQuery`, `FixMatchRequest` with an anime `seasonOffset`.
- `playback` — `DeviceProfile` (containers, codecs, max width and bitrate, `ts | fmp4` HLS segments), `PlaybackDecideRequest`, `PlaybackDecision` (`direct | remux | transcode`, URL, session id, reason, subtitle URLs), `ProgressUpdateRequest`.

## Test fixtures

`scripts/make-fixtures.sh` generates deterministic media with ffmpeg so integration tests never depend on real downloads:

| File                                                               | Purpose                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| `movies/Sample Movie (2019)/Sample Movie (2019).mp4`               | h264 + aac, Plex naming, direct play everywhere         |
| `tv/Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv`                     | hevc + ac3 + embedded srt, scene naming, transcode case |
| `movies/some.random.download.2021.x264-NOGROUP.mp4`                | no episode markers, needs-review case                   |
| `anime/[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv` | fansub naming, jpn + eng audio, embedded ASS            |
