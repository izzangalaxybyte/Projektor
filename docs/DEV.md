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

Listens on `0.0.0.0:8096` by default; override with `PORT` and `HOST`. `GET /api/health` is the liveness check.

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

## Workflow

Every sub-phase in [PLAN.md](PLAN.md) lands as a PR into `main` together with its documentation updates. Run the four checks before pushing. Update [PROGRESS.md](PROGRESS.md) as the last step of each sub-phase.
