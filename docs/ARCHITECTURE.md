# Architecture

Describes what exists now. Planned components are in [PLAN.md](PLAN.md) and move here as they land.

## Packages

- `server` — Fastify 5 API. Requests and responses are validated with zod through `fastify-type-provider-zod`, which also produces the OpenAPI 3.1 document at runtime via `@fastify/swagger`. Entry points: `src/main.ts` (listen), `src/app.ts` (`buildApp`, used by both main and tests), `src/openapi.ts` (writes the document to the contract package).
- `packages/api-contract` — `openapi.json` emitted by the server, `src/schema.d.ts` generated from it by `openapi-typescript`, and `createProjektorClient`, a thin wrapper over `openapi-fetch` that injects a bearer token on every request. This is the only way clients written in TypeScript talk to the server; Kotlin and Swift clients will be generated from the same `openapi.json`.
- `web` — placeholder until sub-phase 1.19.

## Configuration and data directory

`server/src/config.ts` parses the environment with zod into a `Config` and creates the `DATA_DIR` layout (`projektor.sqlite`, `images/`, `subtitles/`, `transcode/`). `buildApp` takes a `Config`, opens the database, and decorates the Fastify instance with `config` and `db` so routes reach both through `app`. Tests get an isolated `Config` in a temp directory from `test-utils.ts`.

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
