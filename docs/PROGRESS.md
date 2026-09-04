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

| Sub-phase                                        | Status | Landed in | Check |
| ------------------------------------------------ | ------ | --------- | ----- |
| 1.1 Database + config                            | todo   |           |       |
| 1.2 Auth + setup wizard                          | todo   |           |       |
| 1.3 Library CRUD + file walk                     | todo   |           |       |
| 1.4 ffprobe + streams                            | todo   |           |       |
| 1.5 Scene filename parsing                       | todo   |           |       |
| 1.6 Fansub filename parsing                      | todo   |           |       |
| 1.7 TMDB matching + artwork                      | todo   |           |       |
| 1.8 AniList matching + season mapping            | todo   |           |       |
| 1.9 Fix-match endpoint                           | todo   |           |       |
| 1.10 Watcher + manual scan                       | todo   |           |       |
| 1.11 Direct play                                 | todo   |           |       |
| 1.12 Playback decision                           | todo   |           |       |
| 1.13 HLS remux                                   | todo   |           |       |
| 1.14 HLS transcode + seek restart                | todo   |           |       |
| 1.15 VAAPI path                                  | todo   |           |       |
| 1.16 Embedded + sidecar subtitles                | todo   |           |       |
| 1.17 Progress + continue watching + next episode | todo   |           |       |
| 1.18 Contract freeze                             | todo   |           |       |
| 1.19 Web shell + auth                            | todo   |           |       |
| 1.20 Browse screens                              | todo   |           |       |
| 1.21 Player                                      | todo   |           |       |
| 1.22 Settings + fix-match UI                     | todo   |           |       |
| 1.23 Docker + deploy                             | todo   |           |       |

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
