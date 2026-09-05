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

## Server address

The clients default to `http://192.168.100.20:8096` (`DEFAULT_SERVER_URL` in `android/core/.../ProjektorClient.kt` and `web/src/config.ts`). The browser build ignores it because the server serves the page itself; the Tizen build and the Android apps use it.

## Web app

```bash
cd web
pnpm dev        # Vite on http://localhost:5173, proxies /api to localhost:8096
pnpm build      # writes web/dist
```

In production the server serves `web/dist` itself: set `WEB_DIST=/path/to/web/dist` and every non-API path falls back to `index.html` so client routes deep-link. Run the API (`cd server && pnpm dev`) alongside Vite during development.

## End-to-end tests

```bash
pnpm e2e
```

Builds the web app, starts the API on port 8099 against a throwaway `DATA_DIR` serving `web/dist` together with a fake IPTV provider on port 8098 (`server/src/live/fake-xtream-server.ts`; username `alice`, password `secret`; the live channels loop the sample movie), and runs Playwright through the real UI in installed Google Chrome (Playwright's own Chromium lacks H.264/AAC, so the playback tests need the branded browser). Tests seed libraries from `fixtures/` through the API, so run `scripts/make-fixtures.sh` first. `npx playwright test --ui` opens the inspector; traces are kept on failure under `test-results/`. To try Live TV by hand, run `node e2e/start-server.mjs`, open `http://127.0.0.1:8099`, and enter `http://127.0.0.1:8098` with those credentials under Settings → Metadata.

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

## Hardware transcoding

On the Linux box, confirm the GPU path after starting the server:

```bash
curl -s http://localhost:8096/api/health
```

`encoder` should be `h264_vaapi`. If it is `libx264`, `encoderReason` says why: usually the render node is not mapped into the container or the Intel media driver is missing. `vainfo` inside the container lists the supported profiles, and `intel_gpu_top` on the host shows the Video engine busy during a transcode.

## Metadata

Matching needs a TMDB credential. Create one at https://www.themoviedb.org/settings/api (a free account is enough) and store it:

```bash
curl -X PATCH http://localhost:8096/api/settings -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"tmdbApiKey":"<v3 key or v4 token>"}'
```

Scans match new items automatically once the key is set. Artwork lands in `DATA_DIR/images/`.

## Docker

```bash
docker build -f deploy/Dockerfile -t projektor .
docker run --rm -p 8096:8096 -v $PWD/data:/data -v $PWD/fixtures:/media:ro projektor
```

The image compiles the server (`server/dist`), builds the web app, and installs ffmpeg with the Intel VAAPI drivers (amd64 only; an arm64 build on a Mac gets ffmpeg alone and transcodes in software). See [server.md](server.md) for the compose setup on the Linux box.

## Workflow

Every sub-phase in [PLAN.md](PLAN.md) lands as a PR into `main` together with its documentation updates. Run the four checks before pushing. Update [PROGRESS.md](PROGRESS.md) as the last step of each sub-phase.

Sub-phases depend on each other, so their PRs are stacked: each branch starts from the previous one and its PR targets that branch. To merge a stack, for each PR in order: retarget it to `main` with `gh pr edit N --base main`, confirm with `gh pr view N --json baseRefName`, then `gh pr merge N --merge`. GitHub does not retarget stacked PRs by itself: merging without retargeting lands the PR into its still-existing base branch (this happened with #12 to #20 and needed catch-up PR #21), and deleting a base branch closes the PRs stacked on it for good (#3, #5, #7, replaced by #8 to #10). Delete branches only after the whole stack is merged. Use merge commits, not squash: squashing makes the next PR's diff include the previous one again.
