# Pawify Docker/Dapr Deployment Notes

This repo is configured for a single Linux VPS running Docker Compose with a Pawify app container, a Dapr sidecar container, and Redis. Your VPS-level tunnel or reverse proxy should point at the host-local ports below.

## Host Routes

These match the current tunnel routes:

| Environment | Public hostname | Host service |
| --- | --- | --- |
| Production | `pawify-api.chi-chi.vip` | `http://127.0.0.1:3001` |
| Test | `test-pawify-api.chi-chi.vip` | `http://127.0.0.1:3101` |

`3001` and `3101` are configured through `PAWIFY_HOST_PORT`. Pawify listens on port `10000` inside each container, so Docker maps `127.0.0.1:3001 -> prod:10000` and `127.0.0.1:3101 -> test:10000`. Dapr and Redis ports stay internal to each Compose project.

VPS Redis persistence stays enabled with `PAWIFY_REDIS_PERSISTENCE=true`. Local Docker can set `PAWIFY_REDIS_PERSISTENCE=false` to keep Redis ephemeral while still exercising Dapr Redis state and lock behavior.

Container log rotation is configured in Compose with `PAWIFY_LOG_MAX_SIZE=10m` and `PAWIFY_LOG_MAX_FILE=3`, so Pawify logs do not grow without bound on the VPS.

The Compose stack also sets container resource caps for a small VPS. Production gets the larger budget, while test is intentionally small so both stacks can coexist on a 2GB server with swap:

| Environment | App | Dapr | Redis container | Redis maxmemory |
| --- | --- | --- | --- | --- |
| Production | `640m` memory, `1.25` CPUs | `192m`, `0.5` CPUs | `256m`, `0.5` CPUs | `160mb` |
| Test | `320m` memory, `0.5` CPUs | `128m`, `0.25` CPUs | `96m`, `0.25` CPUs | `48mb` |

Redis uses `REDIS_MAXMEMORY_POLICY=allkeys-lru`, so cache pressure evicts old cache entries instead of letting Redis grow until the host is unhealthy. The app also sets `PAWIFY_NODE_OPTIONS=--max-old-space-size=384` in production and `--max-old-space-size=192` in test.

## Environment Files

Create one or both of these ignored files from the examples:

```bash
cp .env.prod.example .env.prod
cp .env.test.example .env.test
```

Edit each file and set at least:

- `REDIS_PASSWORD`
- Firebase config: `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_JSON`
- `NOTIFY_API_KEY`
- Sentry values, if enabled

Keep `DAPR_APP_ID=pawify-api` unless you also update `dapr/components/resiliency.yaml` scopes.

## Secret Files

Create these ignored directories and files as needed:

```text
secrets/prod/dapr-secrets.json
secrets/prod/firebase-service-account.json
secrets/test/dapr-secrets.json
secrets/test/firebase-service-account.json
```

`dapr-secrets.json` shape:

```json
{
  "gmail-email": "your-gmail@gmail.com",
  "gmail-password": "your-gmail-app-password",
  "discogs-token": "optional-discogs-token",
  "genius-access-token": "optional-genius-token"
}
```

`REDIS_PASSWORD` lives only in the environment file. Redis uses it when starting, and the Dapr sidecar reads the same env var through `dapr/components/env-secrets.yaml` for the Redis state and lock components. Use separate passwords and Firebase projects/credentials for prod and test.

Recommended permissions:

```bash
chmod 700 secrets secrets/prod secrets/test
chmod 600 secrets/prod/* secrets/test/*
```

## Automatic Deploys

Pushes to `develop` deploy the test stack. Pushes to `main` deploy the production stack. Pull requests into either branch run CI but do not deploy.

Deployment waits for CI to pass first:

```text
npm ci
npm run build
npm test --if-present
docker build
```

For pushes to `develop` and `main`, GitHub Actions builds the Docker image on the GitHub runner and pushes it to GitHub Container Registry. The VPS then pulls that immutable image by SHA instead of building on the server. This keeps deploy-time memory and disk pressure much lower on a small VPS.

Image tags:

```text
ghcr.io/<owner>/<repo>:sha-<commit-sha>
ghcr.io/<owner>/<repo>:test
ghcr.io/<owner>/<repo>:prod
```

The workflow is [deploy.yml](/home/princesslighty/Code/Pawify/.github/workflows/deploy.yml). Configure these GitHub secrets:

- `PAWIFY_VPS_HOST`: VPS hostname or IP.
- `PAWIFY_VPS_USER`: SSH user on the VPS.
- `PAWIFY_VPS_SSH_KEY`: private SSH key for that user.
- `PAWIFY_VPS_PORT`: optional SSH port. Defaults to `22` when empty.

Configure these GitHub repository variables if needed:

- `PAWIFY_REPO_URL`: optional. Defaults to `https://github.com/<owner>/<repo>.git`.
- `PAWIFY_INSTALL_DOCKER`: optional. Set to `true` only if you want the workflow to install Docker.
- `PAWIFY_PROD_SECRET_SOURCE_DIR`: optional. Defaults to `/root/pawify-prod-secrets`.
- `PAWIFY_TEST_SECRET_SOURCE_DIR`: optional. Defaults to `/root/pawify-test-secrets`.

For a private repository, prefer setting `PAWIFY_REPO_URL` to an SSH URL such as `git@github.com:zig-zag-zig/Pawify.git` and install the matching deploy key on the VPS, because the VPS performs the clone/pull.

The workflow uses `GITHUB_TOKEN` to push and pull GHCR images, so no separate container registry token is needed for the normal GitHub Actions deploy path. Repository workflow permissions must allow packages write access.

The SSH user must be able to run the deploy script with `sudo`. The cleanest setup is either root SSH for deploys or passwordless sudo for this command.

In GitHub, create environments named `test` and `production`. Add required reviewers to `production` if you want `main` deploys to wait for manual approval after CI passes.

Create the VPS source secret directories once:

```text
/root/pawify-prod-secrets/.env
/root/pawify-prod-secrets/dapr-secrets.json
/root/pawify-prod-secrets/firebase-service-account.json

/root/pawify-test-secrets/.env
/root/pawify-test-secrets/dapr-secrets.json
/root/pawify-test-secrets/firebase-service-account.json
```

The deploy script copies those into the active checkout as `.env.prod`/`.env.test` and `secrets/prod`/`secrets/test`.
The GitHub workflow treats those source directories as canonical and overwrites the checkout copies on each deploy, keeping backups before replacing files.

## Manual Deploys

The deploy script infers environment from branch:

- `main` -> production
- `develop` -> test

`--repo-url` is optional because the script has a public repo URL default, but passing it is still useful if the VPS should use an SSH repo URL.

Production deploy:

```bash
sudo ./scripts/deploy_pawify_docker_dapr.sh \
  --repo-url https://github.com/zig-zag-zig/Pawify.git \
  --repo-branch main \
  --secrets-source-dir /root/pawify-prod-secrets \
  --install-docker \
  --start
```

Test deploy:

```bash
sudo ./scripts/deploy_pawify_docker_dapr.sh \
  --repo-url https://github.com/zig-zag-zig/Pawify.git \
  --repo-branch develop \
  --secrets-source-dir /root/pawify-test-secrets \
  --start
```

By default, production deploys to `/srv/pawify-prod` and test deploys to `/srv/pawify-test`. This keeps branches, env files, Redis volumes, and Docker Compose projects separate.

Manual commands inside an already prepared checkout:

Production:

```bash
cd /srv/pawify-prod
docker compose --env-file .env.prod build pawify
docker compose --env-file .env.prod up -d
docker compose --env-file .env.prod logs -f --tail=100 pawify pawify-dapr redis
```

Test:

```bash
cd /srv/pawify-test
docker compose --env-file .env.test build pawify
docker compose --env-file .env.test up -d
docker compose --env-file .env.test logs -f --tail=100 pawify pawify-dapr redis
```

Manual deploys build on the VPS by default. To use a prebuilt image manually, pass `--prebuilt-image`:

```bash
sudo ./scripts/deploy_pawify_docker_dapr.sh \
  --repo-url https://github.com/zig-zag-zig/Pawify.git \
  --repo-branch develop \
  --secrets-source-dir /root/pawify-test-secrets \
  --prebuilt-image ghcr.io/zig-zag-zig/pawify:sha-<commit-sha> \
  --start
```

## Health Checks

Production:

```bash
cd /srv/pawify-prod
docker compose --env-file .env.prod ps
curl http://127.0.0.1:3001/v1/keep-alive
docker compose --env-file .env.prod exec redis redis-cli -a "$(grep '^REDIS_PASSWORD=' .env.prod | cut -d= -f2-)" ping
docker compose --env-file .env.prod exec pawify-dapr wget -qO- http://localhost:3500/v1.0/metadata
```

Test:

```bash
cd /srv/pawify-test
docker compose --env-file .env.test ps
curl http://127.0.0.1:3101/v1/keep-alive
docker compose --env-file .env.test exec redis redis-cli -a "$(grep '^REDIS_PASSWORD=' .env.test | cut -d= -f2-)" ping
docker compose --env-file .env.test exec pawify-dapr wget -qO- http://localhost:3500/v1.0/metadata
```

## Redis Backup

Production:

```bash
cd /srv/pawify-prod
PAWIFY_ENV_FILE=.env.prod ./scripts/backup-redis-docker.sh
```

Test:

```bash
cd /srv/pawify-test
PAWIFY_ENV_FILE=.env.test ./scripts/backup-redis-docker.sh
```

Suggested cron:

```cron
15 3 * * * cd /srv/pawify-prod && PAWIFY_ENV_FILE=.env.prod ./scripts/backup-redis-docker.sh >> /srv/pawify-prod/backups/redis-backup.log 2>&1
45 3 * * * cd /srv/pawify-test && PAWIFY_ENV_FILE=.env.test ./scripts/backup-redis-docker.sh >> /srv/pawify-test/backups/redis-backup.log 2>&1
```
