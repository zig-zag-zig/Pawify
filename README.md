# Pawify API

Pawify API is the backend for the Pawify mobile app. It connects Firebase-authenticated users with artist following, release lookup, cached background tasks, email OTP flows, and Expo push notifications for new music.

For non-technical readers: this service does the heavy lifting behind the app. It asks music providers for metadata, caches expensive results, remembers followed artists, and tells phones when new releases are found.

## Features

- Firebase-authenticated REST API under `/v1`.
- Artist search, artist details, following, and unfollowing.
- Release, release-group, and new-release lookup.
- Background task results for heavier artwork/profile/lyrics work.
- Redis-backed caching and notification locking through Dapr.
- Expo push notification delivery.
- Email OTP support through a Dapr SMTP binding.
- GitHub/scheduler-friendly new-release notification endpoint.
- Structured logging, request IDs, and centralized HTTP errors.

## Tech Stack

- Node.js 22
- TypeScript
- Express
- Firebase Admin SDK
- Dapr self-hosted sidecar
- Redis through Dapr state and lock components
- Expo push API through Dapr HTTPEndpoint
- Sentry support

## Related Repositories

- [PawifyApp](https://github.com/zig-zag-zig/PawifyApp) - Expo/React Native mobile app
- [PawifyModule](https://github.com/zig-zag-zig/PawifyModule) - shared music-domain types and helpers

## Local Development

Install dependencies:

```bash
npm install
```

For a bare Node run, create a local environment file from the Docker local example and point credentials at host paths instead of container paths:

```bash
cp .env.local.example .env.local
```

Start the API after Dapr and Redis are available:

```bash
set -a
. ./.env.local
set +a
npm run dev
```

The local server uses `PORT`, defaulting to `10000`.

Health check:

```bash
curl http://localhost:10000/v1/keep-alive
```

## Local Docker

Local Docker uses the same Compose, Redis, and Dapr wiring as the VPS, but with a separate Compose project and a local host port:

```bash
cp .env.local.example .env.local
mkdir -p secrets/local
```

Create `secrets/local/dapr-secrets.json`:

```json
{
  "gmail-email": "your-gmail@gmail.com",
  "gmail-password": "your-gmail-app-password",
  "discogs-token": "",
  "genius-access-token": ""
}
```

Put a Firebase service account at:

```text
secrets/local/firebase-service-account.json
```

Then run:

```bash
docker compose --env-file .env.local up -d --build
curl http://127.0.0.1:10000/v1/keep-alive
```

The VPS keeps using `3001` for production and `3101` for test. Local Docker uses `PAWIFY_HOST_PORT=10000` from `.env.local`, so it does not change the VPS tunnel setup.

Local Redis persistence is disabled by default through `PAWIFY_REDIS_PERSISTENCE=false`. That keeps local cache/lock behavior realistic without local AOF/RDB files mattering. To stop local Docker:

```bash
docker compose --env-file .env.local down
```

## Environment

Use the environment-specific examples as the source of truth:

- `.env.local.example` for local Docker.
- `.env.test.example` for the VPS test stack.
- `.env.prod.example` for the VPS production stack.

Production-like runs need values for:

- `DAPR_HTTP_PORT` or `DAPR_HTTP_ENDPOINT`
- `FIREBASE_DATABASE_URL`
- `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`
- `NOTIFY_API_KEY`
- `REDIS_PASSWORD` in the environment file
- a Dapr file secret store containing `gmail-email`, `gmail-password`, `discogs-token`, and `genius-access-token`

Common optional values:

- `MUSICBRAINZ_USER_AGENT`
- `KEEP_ALIVE_URL`
- Cache TTL and task tuning values from the matching `.env.*.example` file.

Never commit Firebase service accounts, API keys, Gmail app passwords, Redis credentials, Dapr secret files, or `.env` files.

## Branching And Releases

Protected branches:

- `develop` is the integration branch and deploys to the test VPS stack.
- `main` is the production branch and deploys to the production VPS stack.

Working branches:

- `feature/<short-name>` for new behavior.
- `fix/<short-name>` for normal bug fixes.
- `hotfix/<short-name>` for urgent production fixes based from `main`.

Normal flow:

```bash
git switch develop
git pull --rebase origin develop
git switch -c feature/<short-name>
```

Open pull requests from `feature/*` or `fix/*` into `develop`. When merged, GitHub Actions runs CI and deploys test from `develop`.

Production promotion is a pull request from `develop` into `main`. When merged, GitHub Actions runs CI and deploys production from `main`.

Hotfix flow:

```bash
git switch main
git pull --ff-only origin main
git switch -c hotfix/<short-name>
```

Open the hotfix pull request into `main`. After it reaches production, bring that fix back to `develop` with a follow-up pull request or by cherry-picking the production commit onto a `fix/*` branch from `develop`.

## Testing

Run tests:

```bash
npm test
```

Compile TypeScript:

```bash
npm run build
```

Tests should focus on local Pawify logic: request validation, release filtering/grouping, notification decisions, task serialization, cache helper behavior, and upstream-error handling. Firebase, Dapr, Redis, email, Expo push delivery, and external music providers should be mocked unless an explicit emulator/integration command is added.

## Firebase Emulators

Firebase has a Local Emulator Suite for Auth, Firestore, Realtime Database, and related products. Use it for integration tests that need Firebase behavior without production writes.

Example direction:

```bash
firebase emulators:exec --only auth,database,firestore "npm test"
```

The default test suite should remain safe to run without live Firebase, Dapr, or Redis writes.

## Upstream Rate Limits

Pawify depends on third-party music data. If artist search, release details, cover art, or lyrics are slow, the bottleneck may be the provider, not your API server.

| Provider | Used For | Operational Note |
| --- | --- | --- |
| MusicBrainz | Artist, release, relationship, and track metadata | Keep traffic polite; MusicBrainz publishes a strict per-IP request-rate policy. |
| Cover Art Archive | Release and release-group cover art | Cache aggressively and tolerate missing art. |
| Discogs | Optional artist image fallback | Watch provider rate-limit headers when enabled. |
| Genius | Optional lyrics lookup | Treat `429` and transient failures as provider throttling. |

Pawify keeps provider concurrency and provider-specific rate-limit backoff in app code. Dapr resiliency owns provider retry, timeout, and circuit-breaker execution.

## API Overview

Public endpoints:

- `GET /v1/keep-alive`
- `POST /v1/sendOtp`
- `POST /v1/verifyOtp`

Scheduled/admin endpoint:

- `GET /v1/notifyNewReleases` with `x-api-key`

Authenticated endpoints expect:

```http
Authorization: Bearer <firebase-id-token>
```

Common authenticated routes:

- Account: `GET /v1/revokeToken`, `POST /v1/changeEmail`, `POST /v1/deleteUserAccount`
- Artists: `GET /v1/getFollowing`, `POST /v1/searchArtists`, `POST /v1/getArtistDetails`, `POST /v1/followArtist`, `POST /v1/unfollowArtist`, `POST /v1/unfollowArtists`
- Releases: `GET /v1/getNewReleases`, `POST /v1/removeNewReleases`, `POST /v1/getArtistReleases`, `POST /v1/getReleaseGroupReleases`, `POST /v1/getRelease`, `POST /v1/verifyReleaseExistence`
- Push tokens: `POST /v1/savePushToken`, `POST /v1/deletePushToken`
- Tasks: `POST /v1/getTaskResult`

## Deployment

- Pull requests run build, tests, and Docker image validation.
- Pushes to `develop` build and push a GHCR image, then deploy the test stack at `http://127.0.0.1:3101`.
- Pushes to `main` build and push a GHCR image, then deploy the production stack at `http://127.0.0.1:3001`.
- Use the Docker Compose stack in this repo for the single-VPS deployment.
- Dapr components live in `dapr/components`; secret files are mounted from `secrets/<environment>`.
- Redis is local to each Compose network, password-protected, and configured with AOF plus RDB snapshots.
- Use `scripts/backup-redis-docker.sh` for Redis backups.
- Trigger `GET /v1/notifyNewReleases` from a trusted scheduler with `x-api-key: <NOTIFY_API_KEY>`.
- Keep origin-only secrets out of mobile apps and public repositories.

## Project Layout

```text
src/api/              Versioned route registration
src/common/           HTTP, logging, request, and utility code
src/config/           Runtime configuration
src/features/         Auth, artists, releases, notifications, push tokens, tasks
src/infrastructure/   Firebase, monitoring, and provider adapters
src/services/         Music APIs, cache, email, tasks, notifications
src/utils/            Helpers and shared types
```

## License

This project is licensed under the 0BSD license.
