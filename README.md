# Pawify API

Pawify API is the backend for the Pawify mobile app. It connects Firebase-authenticated users with artist following, release lookup, cached background tasks, email OTP flows, and Expo push notifications for new music.

For non-technical readers: this service does the heavy lifting behind the app. It asks music providers for metadata, caches expensive results, remembers followed artists, and tells phones when new releases are found.

## Features

- Firebase-authenticated REST API under `/v1`.
- Artist search, artist details, following, and unfollowing.
- Release, release-group, and new-release lookup.
- Background task results for heavier artwork/profile/lyrics work.
- Redis-backed caching and request de-duplication.
- Expo push notification delivery.
- Email OTP support through Nodemailer.
- GitHub/scheduler-friendly new-release notification endpoint.
- Structured logging, request IDs, and centralized HTTP errors.

## Tech Stack

- Node.js 22
- TypeScript
- Express
- Firebase Admin SDK
- Redis via ioredis
- Expo Server SDK
- Nodemailer
- Sentry support

## Related Repositories

- [PawifyApp](https://github.com/zig-zag-zig/PawifyApp) - Expo/React Native mobile app
- [PawifyModule](https://github.com/zig-zag-zig/PawifyModule) - shared music-domain types and helpers

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Start the API:

```bash
npm run dev
```

The local server uses `PORT`, defaulting to `10000`.

Health check:

```bash
curl http://localhost:10000/v1/keep-alive
```

## Environment

Use `.env.example` as the source of truth. Production-like runs need values for:

- `REDIS`
- `FIREBASE_DATABASE_URL`
- `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`
- `NOTIFY_API_KEY`
- `GMAIL_EMAIL`
- `GMAIL_PASSWORD`

Common optional values:

- `MUSICBRAINZ_USER_AGENT`
- `GENIUS_ACCESS_TOKEN`
- `DISCOGS_TOKEN`
- `KEEP_ALIVE_URL`
- Cache TTL and task tuning values from `.env.example`

Never commit Firebase service accounts, API keys, Gmail app passwords, Redis credentials, or `.env` files.

## Testing

Run tests:

```bash
npm test
```

Compile TypeScript:

```bash
npm run build
```

Tests should focus on local Pawify logic: request validation, release filtering/grouping, notification decisions, task serialization, cache helper behavior, and upstream-error handling. Firebase, Redis, email, Expo push delivery, and external music providers should be mocked unless an explicit emulator/integration command is added.

## Firebase Emulators

Firebase has a Local Emulator Suite for Auth, Firestore, Realtime Database, and related products. Use it for integration tests that need Firebase behavior without production writes.

Example direction:

```bash
firebase emulators:exec --only auth,database,firestore "npm test"
```

The default test suite should remain safe to run without live Firebase or Redis writes.

## Upstream Rate Limits

Pawify depends on third-party music data. If artist search, release details, cover art, or lyrics are slow, the bottleneck may be the provider, not your API server.

| Provider | Used For | Operational Note |
| --- | --- | --- |
| MusicBrainz | Artist, release, relationship, and track metadata | Keep traffic polite; MusicBrainz publishes a strict per-IP request-rate policy. |
| Cover Art Archive | Release and release-group cover art | Cache aggressively and tolerate missing art. |
| Discogs | Optional artist image fallback | Watch provider rate-limit headers when enabled. |
| Genius | Optional lyrics lookup | Treat `429` and transient failures as provider throttling. |

Keep application-level backoff/caching even if Cloudflare rate limits protect your public API edge.

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

- Run `npm run build` before deploying.
- Start compiled output with `npm start`.
- Set `NODE_ENV=production`.
- Run Redis separately and point `REDIS` at it.
- Provide secrets through the host, process manager, or private environment files.
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
