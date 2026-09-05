# Developing Projektor

## Prerequisites

- Node 20 or newer (24 is what development uses) and pnpm 11. The repo pins `packageManager` in `package.json`, so `corepack enable` is enough.
- ffmpeg and ffprobe on `PATH`. On macOS: `brew install ffmpeg`.
- TypeScript stays on the 6.x line. typescript-eslint does not support 7.x yet; do not bump it.

## Install and check

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

`pnpm format` rewrites files with Prettier. All four checks run across every workspace package.

## Test media

```bash
./scripts/make-fixtures.sh
```

Writes four small synthetic files into `fixtures/` (gitignored). Re-running skips files that already exist. Set `FIXTURE_SECONDS` to change their length (default 30).

## Server

```bash
cd server
pnpm dev        # tsx watch, restarts on change
pnpm start      # single run
```

Listens on `0.0.0.0:8096` by default. `GET /api/health` is the liveness check.

Environment variables (all optional):

| Variable                       | Default              | Purpose                                     |
| ------------------------------ | -------------------- | ------------------------------------------- |
| `PORT`                         | `8096`               | Listen port                                 |
| `HOST`                         | `0.0.0.0`            | Bind address                                |
| `DATA_DIR`                     | `./data`             | Root for all server-owned state (see below) |
| `LOG_LEVEL`                    | `info`               | pino level                                  |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Binaries to spawn                           |

`DATA_DIR` is created on start with this layout: `projektor.sqlite` (plus WAL files), `images/`, `subtitles/`, `transcode/`. Delete the directory to reset everything.

## Database

Schema lives in `server/src/db/schema.ts` (Drizzle ORM over better-sqlite3). Migrations are SQL files in `server/drizzle/` and run automatically on every start; a start with nothing pending is a no-op. After changing the schema:

```bash
cd server && pnpm db:generate
```

Commit the new file under `server/drizzle/` together with the schema change. Never edit an existing migration that has shipped.

## API contract

The OpenAPI document is generated from the server's zod schemas, and the TypeScript client is generated from that document. After changing any route or schema:

```bash
cd server && pnpm emit-openapi
cd ../packages/api-contract && pnpm generate
```

Commit both `packages/api-contract/openapi.json` and `packages/api-contract/src/schema.d.ts`.

## Layout

```
server/                 Fastify API, zod schemas, ffmpeg integration
web/                    React app (browser and Tizen builds)
packages/api-contract/  openapi.json, generated types, createProjektorClient
scripts/                make-fixtures.sh and other helpers
docs/                   this documentation
```

## Metadata

Matching needs a TMDB credential. Create one at https://www.themoviedb.org/settings/api (a free account is enough) and store it:

```bash
curl -X PATCH http://localhost:8096/api/settings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"tmdbApiKey":"<v3 key or v4 token>"}'
```

Scans match new items automatically once the key is set. Artwork lands in `DATA_DIR/images/`.

## Workflow

Every sub-phase in [PLAN.md](PLAN.md) lands as a PR into `main` together with its documentation updates. Run the four checks before pushing. Update [PROGRESS.md](PROGRESS.md) as the last step of each sub-phase.

Sub-phases depend on each other, so their PRs are stacked: each branch starts from the previous one and its PR targets that branch. To merge a stack, go in order with `gh pr merge N --merge` and **do not delete branches until the whole stack is merged**. Deleting a base branch closes the PRs stacked on it, and a closed PR whose base is gone cannot be reopened (this happened with #3, #5, #7, replaced by #8 to #10). Use merge commits, not squash: squashing makes the next PR's diff include the previous one again.
