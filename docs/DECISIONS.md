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
