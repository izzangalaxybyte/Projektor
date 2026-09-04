# API guide

The source of truth is [`packages/api-contract/openapi.json`](../packages/api-contract/openapi.json), regenerated from the server's zod schemas (see [DEV.md](DEV.md)). This page is the short prose version.

## Conventions

- Base path `/api`. JSON in and out. Errors use `ErrorResponse` (`statusCode`, `error`, `message`).
- Authentication is a bearer token from `POST /api/auth/login`. Not enforced yet; lands in sub-phase 1.2.
- Ids are opaque strings. Timestamps are ISO 8601 UTC. Durations and positions are integer milliseconds.
- List endpoints take `offset` and `limit` (max 200) and return `{ items, total, offset, limit }`.

## Routes available now

| Route             | Purpose                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `GET /api/health` | Liveness. Returns `status`, server `version`, and current `time`. No auth. |

## Schemas defined for upcoming routes

Grouped by the sub-phase that will route them.

- **Auth (1.2)** — `SetupStatus`, `SetupRequest`, `LoginRequest`, `LoginResponse`, `Profile`, `Session`. Login is profile id plus a 4 to 6 digit PIN and a device name.
- **Libraries (1.3, 1.10)** — `Library`, `CreateLibraryRequest`, `ScanStatus`.
- **Items (1.7 to 1.9, 1.17)** — `ItemSummary`, `ItemDetail`, `MediaFile`, `StreamInfo`, `ItemsQuery`, `FixMatchRequest`, `ProgressState`.
- **Playback (1.11 to 1.14)** — `DeviceProfile`, `PlaybackDecideRequest`, `PlaybackDecision`, `PlaybackMethod`, `ProgressUpdateRequest`.

Each of these appears twice in `components.schemas`, once as `Name` (output) and once as `NameInput` (input). That is how `fastify-type-provider-zod` emits schemas; clients should use the plain `Name` variant for responses and `NameInput` for request bodies.
