#!/usr/bin/env bash
set -Eeuo pipefail

# Pawify Docker + Dapr + Redis VPS deployment bootstrapper.
#
# Cloudflare Tunnel / reverse proxy is intentionally outside this Docker stack.
# Existing host routes should point to:
#   prod: http://127.0.0.1:3001
#   test: http://127.0.0.1:3101
#
# Branch mapping:
#   main    -> prod -> http://127.0.0.1:3001
#   develop -> test -> http://127.0.0.1:3101
#
# Repo URL and branch can come from CLI flags or environment variables. This
# keeps GitHub Actions calls short while still allowing overrides.

APP_DIR=""
APP_USER="pawify"
ENVIRONMENT=""
REPO_URL="${PAWIFY_REPO_URL:-https://github.com/zig-zag-zig/Pawify.git}"
REPO_BRANCH="${PAWIFY_DEPLOY_BRANCH:-${GITHUB_REF_NAME:-}}"
PROD_BRANCH="${PAWIFY_PROD_BRANCH:-main}"
TEST_BRANCH="${PAWIFY_TEST_BRANCH:-develop}"
INSTALL_DOCKER="false"
START_STACK="false"
FORCE_SECRET_OVERWRITE="false"
ENV_FILE_SOURCE=""
DAPR_SECRETS_FILE_SOURCE=""
FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE=""
SECRETS_SOURCE_DIR=""
PREBUILT_IMAGE="${PAWIFY_DEPLOY_IMAGE:-}"
IMAGE_REGISTRY="${PAWIFY_IMAGE_REGISTRY:-}"
IMAGE_REGISTRY_USER="${PAWIFY_IMAGE_REGISTRY_USER:-}"
IMAGE_REGISTRY_TOKEN="${PAWIFY_IMAGE_REGISTRY_TOKEN:-}"
REDIS_PASSWORD_INPUT="${REDIS_PASSWORD:-}"

log() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<USAGE
Usage: $0 [options]

Default branch mapping:
  ${PROD_BRANCH} -> prod  -> http://127.0.0.1:3001
  ${TEST_BRANCH} -> test  -> http://127.0.0.1:3101

Options:
  --repo-branch BRANCH          Git branch to checkout/pull. Defaults to
                                PAWIFY_DEPLOY_BRANCH, then GITHUB_REF_NAME.
  --repo-url URL                Git repo URL. Defaults to PAWIFY_REPO_URL, then
                                https://github.com/zig-zag-zig/Pawify.git.
  --environment ENV             prod or test. Usually inferred from branch.
  --app-dir PATH                Default: /srv/pawify-prod or /srv/pawify-test.
  --app-user USER               Linux user that owns/runs the app. Default: pawify.
  --install-docker              Install Docker Engine + Compose plugin.
  --start                       Build and start the selected Compose stack.
  --prebuilt-image IMAGE        Use this already-built app image and pull it
                                instead of building on the VPS.
  --force-secret-overwrite      Overwrite env/secret files from provided sources/templates.
  --env-file PATH               Copy this file to .env.prod or .env.test.
  --dapr-secrets-file PATH      Copy this file to secrets/prod|test/dapr-secrets.json.
  --firebase-service-account-file PATH
                                Copy this file to secrets/prod|test/firebase-service-account.json.
  --secrets-source-dir DIR      Read source files from DIR:
                                  DIR/.env or DIR/.env.prod|.env.test
                                  DIR/dapr-secrets.json
                                  DIR/firebase-service-account.json
  --help                        Show this help.

Environment variables:
  PAWIFY_REPO_URL               Optional repo URL override.
  PAWIFY_DEPLOY_BRANCH          Optional branch override.
  GITHUB_REF_NAME               Used as branch when running from GitHub Actions.
  PAWIFY_PROD_BRANCH            Optional prod branch name. Default: main.
  PAWIFY_TEST_BRANCH            Optional test branch name. Default: develop.
  PAWIFY_DEPLOY_IMAGE           Optional prebuilt app image. Usually set by CI.
  PAWIFY_IMAGE_REGISTRY         Optional registry for docker login, e.g. ghcr.io.
  PAWIFY_IMAGE_REGISTRY_USER    Optional registry username.
  PAWIFY_IMAGE_REGISTRY_TOKEN   Optional registry token. Avoid printing this.
  REDIS_PASSWORD                If set, used when creating a missing env file.

Examples:
  sudo ./scripts/deploy_pawify_docker_dapr.sh \\
    --repo-branch main \\
    --install-docker \\
    --start

  sudo ./scripts/deploy_pawify_docker_dapr.sh \\
    --repo-branch develop \\
    --start
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --app-user) APP_USER="$2"; shift 2 ;;
    --environment|--env) ENVIRONMENT="$2"; shift 2 ;;
    --repo-url) REPO_URL="$2"; shift 2 ;;
    --repo-branch|--branch) REPO_BRANCH="$2"; shift 2 ;;
    --install-docker) INSTALL_DOCKER="true"; shift ;;
    --start) START_STACK="true"; shift ;;
    --prebuilt-image) PREBUILT_IMAGE="$2"; shift 2 ;;
    --force-secret-overwrite) FORCE_SECRET_OVERWRITE="true"; shift ;;
    --env-file) ENV_FILE_SOURCE="$2"; shift 2 ;;
    --dapr-secrets-file) DAPR_SECRETS_FILE_SOURCE="$2"; shift 2 ;;
    --firebase-service-account-file) FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE="$2"; shift 2 ;;
    --secrets-source-dir) SECRETS_SOURCE_DIR="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 2 ;;
  esac
done

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing required command: $1"; exit 1; }
}

as_root_or_sudo() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "Run this script as root, for example with sudo."
    exit 1
  fi
}

sha_file() {
  if [[ -f "$1" ]]; then sha256sum "$1" | awk '{print $1}'; else echo ""; fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n'
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64
  fi
}

copy_source_file() {
  local src="$1"
  local dest="$2"
  local mode="$3"
  local owner="$4"

  if [[ ! -f "$src" ]]; then
    err "Source file does not exist: $src"
    exit 1
  fi

  mkdir -p "$(dirname "$dest")"

  if [[ -f "$dest" && "$(sha_file "$src")" == "$(sha_file "$dest")" ]]; then
    log "unchanged from source: $dest"
    chmod "$mode" "$dest" || true
    chown "$owner" "$dest" || true
    return 0
  fi

  if [[ -f "$dest" ]]; then
    cp -a "$dest" "$dest.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    log "updated from source with backup: $dest"
  else
    log "created from source: $dest"
  fi

  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dest"
}

write_file() {
  local path="$1"
  local mode="$2"
  local owner="$3"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"

  mkdir -p "$(dirname "$path")"

  if [[ -f "$path" ]]; then
    if [[ "$(sha_file "$path")" == "$(sha_file "$tmp")" ]]; then
      log "unchanged: $path"
      rm -f "$tmp"
      chmod "$mode" "$path" || true
      chown "$owner" "$path" || true
      return 0
    fi
    cp -a "$path" "$path.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    log "updated with backup: $path"
  else
    log "created: $path"
  fi

  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$path"
  rm -f "$tmp"
}

replace_or_append_env() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

read_env_value() {
  local file="$1"
  local key="$2"
  if [[ -f "$file" ]]; then
    grep "^${key}=" "$file" | head -n1 | cut -d= -f2-
  fi
}

install_docker() {
  log "Installing Docker Engine and Compose plugin from Docker apt repository"
  export DEBIAN_FRONTEND=noninteractive
  rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources
  apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc >/dev/null 2>&1 || true
  apt-get update
  apt-get install -y ca-certificates curl gnupg git openssl rsync
  install -m 0755 -d /etc/apt/keyrings

  local codename arch docker_os
  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-}" in
    ubuntu)
      docker_os="ubuntu"
      codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
      ;;
    debian)
      docker_os="debian"
      codename="${VERSION_CODENAME:-}"
      ;;
    *)
      case " ${ID_LIKE:-} " in
        *" ubuntu "*)
          docker_os="ubuntu"
          codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
          ;;
        *" debian "*)
          docker_os="debian"
          codename="${VERSION_CODENAME:-}"
          ;;
        *)
          err "Unsupported OS for Docker apt repo: ${PRETTY_NAME:-unknown}. Install Docker manually or update this script."
          exit 1
          ;;
      esac
      ;;
  esac

  if [[ -z "$codename" ]]; then
    err "Could not detect ${docker_os} codename for Docker apt repo."
    exit 1
  fi

  curl -fsSL "https://download.docker.com/linux/${docker_os}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  arch="$(dpkg --print-architecture)"
  cat > /etc/apt/sources.list.d/docker.sources <<EOF_REPO
Types: deb
URIs: https://download.docker.com/linux/${docker_os}
Suites: ${codename}
Components: stable
Architectures: ${arch}
Signed-By: /etc/apt/keyrings/docker.asc
EOF_REPO

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  systemctl enable --now containerd
}

validate_args() {
  if [[ -z "$REPO_BRANCH" ]]; then
    err "--repo-branch, PAWIFY_DEPLOY_BRANCH, or GITHUB_REF_NAME is required."
    exit 2
  fi

  if [[ -z "$REPO_URL" ]]; then
    err "--repo-url or PAWIFY_REPO_URL is required."
    exit 2
  fi

  if [[ -z "$ENVIRONMENT" ]]; then
    case "$REPO_BRANCH" in
      "$PROD_BRANCH") ENVIRONMENT="prod" ;;
      "$TEST_BRANCH") ENVIRONMENT="test" ;;
      *)
        err "Cannot infer environment from branch '$REPO_BRANCH'."
        err "Expected '$PROD_BRANCH' for prod or '$TEST_BRANCH' for test, or pass --environment explicitly."
        exit 2
        ;;
    esac
  fi

  case "$ENVIRONMENT" in
    prod|test) ;;
    *)
      err "--environment must be prod or test, got: $ENVIRONMENT"
      exit 2
      ;;
  esac

  if [[ "$ENVIRONMENT" == "prod" && "$REPO_BRANCH" != "$PROD_BRANCH" ]]; then
    err "Refusing prod deploy from branch '$REPO_BRANCH'. Expected '$PROD_BRANCH'."
    exit 2
  fi

  if [[ "$ENVIRONMENT" == "test" && "$REPO_BRANCH" != "$TEST_BRANCH" ]]; then
    err "Refusing test deploy from branch '$REPO_BRANCH'. Expected '$TEST_BRANCH'."
    exit 2
  fi

  if [[ -z "$APP_DIR" ]]; then
    APP_DIR="/srv/pawify-${ENVIRONMENT}"
  fi
}

set_environment_defaults() {
  case "$ENVIRONMENT" in
    prod)
      ENV_FILE=".env.prod"
      ENV_EXAMPLE=".env.prod.example"
      SECRETS_SUBDIR="prod"
      HOST_PORT="3001"
      APP_PORT="10000"
      COMPOSE_PROJECT="pawify-prod"
      IMAGE_NAME="pawify:prod"
      PUBLIC_HOSTNAME="pawify-api.chi-chi.vip"
      SENTRY_ENVIRONMENT="production"
      APP_ENV_VALUE="production"
      APP_MEMORY_LIMIT="640m"
      APP_MEMORY_SWAP_LIMIT="1g"
      APP_MEMORY_RESERVATION="256m"
      APP_CPUS="1.25"
      APP_PIDS_LIMIT="256"
      DAPR_MEMORY_LIMIT="192m"
      DAPR_MEMORY_SWAP_LIMIT="256m"
      DAPR_MEMORY_RESERVATION="96m"
      DAPR_CPUS="0.5"
      DAPR_PIDS_LIMIT="128"
      REDIS_MEMORY_LIMIT="256m"
      REDIS_MEMORY_SWAP_LIMIT="256m"
      REDIS_MEMORY_RESERVATION="64m"
      REDIS_CPUS="0.5"
      REDIS_PIDS_LIMIT="128"
      NODE_OPTIONS_VALUE="--max-old-space-size=384"
      REDIS_MAXMEMORY_VALUE="160mb"
      REDIS_MAXMEMORY_POLICY_VALUE="allkeys-lru"
      ;;
    test)
      ENV_FILE=".env.test"
      ENV_EXAMPLE=".env.test.example"
      SECRETS_SUBDIR="test"
      HOST_PORT="3101"
      APP_PORT="10000"
      COMPOSE_PROJECT="pawify-test"
      IMAGE_NAME="pawify:test"
      PUBLIC_HOSTNAME="test-pawify-api.chi-chi.vip"
      SENTRY_ENVIRONMENT="test"
      APP_ENV_VALUE="test"
      APP_MEMORY_LIMIT="320m"
      APP_MEMORY_SWAP_LIMIT="512m"
      APP_MEMORY_RESERVATION="128m"
      APP_CPUS="0.5"
      APP_PIDS_LIMIT="192"
      DAPR_MEMORY_LIMIT="128m"
      DAPR_MEMORY_SWAP_LIMIT="192m"
      DAPR_MEMORY_RESERVATION="64m"
      DAPR_CPUS="0.25"
      DAPR_PIDS_LIMIT="96"
      REDIS_MEMORY_LIMIT="96m"
      REDIS_MEMORY_SWAP_LIMIT="96m"
      REDIS_MEMORY_RESERVATION="32m"
      REDIS_CPUS="0.25"
      REDIS_PIDS_LIMIT="96"
      NODE_OPTIONS_VALUE="--max-old-space-size=192"
      REDIS_MAXMEMORY_VALUE="48mb"
      REDIS_MAXMEMORY_POLICY_VALUE="allkeys-lru"
      ;;
  esac

  if [[ -n "$PREBUILT_IMAGE" ]]; then
    IMAGE_NAME="$PREBUILT_IMAGE"
  fi
}

create_user_and_dirs() {
  as_root_or_sudo

  if ! id "$APP_USER" >/dev/null 2>&1; then
    log "Creating system user: $APP_USER"
    useradd --system --create-home --shell /bin/bash "$APP_USER"
  fi

  if command -v docker >/dev/null 2>&1; then
    usermod -aG docker "$APP_USER" || true
  fi

  mkdir -p "$APP_DIR" "$APP_DIR/backups/redis"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  chmod 750 "$APP_DIR/backups" "$APP_DIR/backups/redis" || true
}

login_to_image_registry() {
  if [[ -z "$IMAGE_REGISTRY_TOKEN" ]]; then
    return 0
  fi

  if [[ -z "$IMAGE_REGISTRY" || -z "$IMAGE_REGISTRY_USER" ]]; then
    err "PAWIFY_IMAGE_REGISTRY and PAWIFY_IMAGE_REGISTRY_USER are required when PAWIFY_IMAGE_REGISTRY_TOKEN is set."
    exit 2
  fi

  need_cmd docker
  log "Logging Docker in to $IMAGE_REGISTRY as $IMAGE_REGISTRY_USER"
  printf '%s\n' "$IMAGE_REGISTRY_TOKEN" \
    | sudo -u "$APP_USER" docker login "$IMAGE_REGISTRY" -u "$IMAGE_REGISTRY_USER" --password-stdin >/dev/null
}

clone_or_update_repo() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    if [[ -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
      err "$APP_DIR is not empty and has no .git. Choose another --app-dir or clean it up."
      exit 1
    fi

    log "Cloning $REPO_URL branch $REPO_BRANCH into $APP_DIR"
    sudo -u "$APP_USER" git clone --recurse-submodules --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
  else
    log "Updating git repo in $APP_DIR to branch $REPO_BRANCH"
    sudo -u "$APP_USER" git -C "$APP_DIR" remote set-url origin "$REPO_URL" || true
    sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin "$REPO_BRANCH" --prune
    sudo -u "$APP_USER" git -C "$APP_DIR" checkout "$REPO_BRANCH"
    sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"
  fi

  if [[ -f "$APP_DIR/.gitmodules" ]]; then
    log "Updating git submodules"
    sudo -u "$APP_USER" git -C "$APP_DIR" submodule sync --recursive
    sudo -u "$APP_USER" git -C "$APP_DIR" submodule update --init --recursive
  fi
}

prepare_runtime_files() {
  local owner="$APP_USER:$APP_USER"
  local secrets_dir="$APP_DIR/secrets/$SECRETS_SUBDIR"
  local env_path="$APP_DIR/$ENV_FILE"
  local secret_path="$secrets_dir/dapr-secrets.json"
  local firebase_path="$secrets_dir/firebase-service-account.json"

  mkdir -p "$secrets_dir" "$APP_DIR/backups/redis"
  chown -R "$owner" "$APP_DIR/secrets" "$APP_DIR/backups"
  chmod 700 "$APP_DIR/secrets" "$secrets_dir" || true

  if [[ -n "$SECRETS_SOURCE_DIR" ]]; then
    if [[ -z "$ENV_FILE_SOURCE" ]]; then
      if [[ -f "$SECRETS_SOURCE_DIR/$ENV_FILE" ]]; then
        ENV_FILE_SOURCE="$SECRETS_SOURCE_DIR/$ENV_FILE"
      elif [[ -f "$SECRETS_SOURCE_DIR/.env" ]]; then
        ENV_FILE_SOURCE="$SECRETS_SOURCE_DIR/.env"
      else
        err "Missing env source in $SECRETS_SOURCE_DIR. Expected $ENV_FILE or .env."
        exit 1
      fi
    fi

    if [[ -z "$DAPR_SECRETS_FILE_SOURCE" ]]; then
      DAPR_SECRETS_FILE_SOURCE="$SECRETS_SOURCE_DIR/dapr-secrets.json"
    fi

    if [[ -z "$FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE" && -f "$SECRETS_SOURCE_DIR/firebase-service-account.json" ]]; then
      FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE="$SECRETS_SOURCE_DIR/firebase-service-account.json"
    fi
  fi

  if [[ -n "$ENV_FILE_SOURCE" ]]; then
    if [[ "$FORCE_SECRET_OVERWRITE" == "true" || ! -f "$env_path" ]]; then
      copy_source_file "$ENV_FILE_SOURCE" "$env_path" "0600" "$owner"
    else
      log "preserved existing env file: $env_path"
    fi
  elif [[ ! -f "$env_path" || "$FORCE_SECRET_OVERWRITE" == "true" ]]; then
    if [[ ! -f "$APP_DIR/$ENV_EXAMPLE" ]]; then
      err "Missing $APP_DIR/$ENV_EXAMPLE. Is the repo up to date?"
      exit 1
    fi
    copy_source_file "$APP_DIR/$ENV_EXAMPLE" "$env_path" "0600" "$owner"
  else
    log "preserved existing env file: $env_path"
    chmod 600 "$env_path" || true
    chown "$owner" "$env_path" || true
  fi

  replace_or_append_env "$env_path" "COMPOSE_PROJECT_NAME" "$COMPOSE_PROJECT"
  replace_or_append_env "$env_path" "PAWIFY_ENV_FILE" "$ENV_FILE"
  replace_or_append_env "$env_path" "PAWIFY_IMAGE" "$IMAGE_NAME"
  replace_or_append_env "$env_path" "PAWIFY_SECRETS_DIR" "./secrets/$SECRETS_SUBDIR"
  replace_or_append_env "$env_path" "PAWIFY_HOST_BIND_ADDRESS" "127.0.0.1"
  replace_or_append_env "$env_path" "PAWIFY_HOST_PORT" "$HOST_PORT"
  replace_or_append_env "$env_path" "APP_ENV" "$APP_ENV_VALUE"
  replace_or_append_env "$env_path" "NODE_ENV" "production"
  replace_or_append_env "$env_path" "PORT" "$APP_PORT"
  replace_or_append_env "$env_path" "DAPR_HTTP_PORT" "3500"
  replace_or_append_env "$env_path" "DAPR_GRPC_PORT" "50001"
  replace_or_append_env "$env_path" "DAPR_APP_ID" "pawify-api"
  replace_or_append_env "$env_path" "DAPR_SECRET_STORE_NAME" "pawify-secrets"
  replace_or_append_env "$env_path" "PAWIFY_LOG_MAX_SIZE" "10m"
  replace_or_append_env "$env_path" "PAWIFY_LOG_MAX_FILE" "3"
  replace_or_append_env "$env_path" "PAWIFY_APP_MEMORY_LIMIT" "$APP_MEMORY_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_APP_MEMORY_SWAP_LIMIT" "$APP_MEMORY_SWAP_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_APP_MEMORY_RESERVATION" "$APP_MEMORY_RESERVATION"
  replace_or_append_env "$env_path" "PAWIFY_APP_CPUS" "$APP_CPUS"
  replace_or_append_env "$env_path" "PAWIFY_APP_PIDS_LIMIT" "$APP_PIDS_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_DAPR_MEMORY_LIMIT" "$DAPR_MEMORY_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_DAPR_MEMORY_SWAP_LIMIT" "$DAPR_MEMORY_SWAP_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_DAPR_MEMORY_RESERVATION" "$DAPR_MEMORY_RESERVATION"
  replace_or_append_env "$env_path" "PAWIFY_DAPR_CPUS" "$DAPR_CPUS"
  replace_or_append_env "$env_path" "PAWIFY_DAPR_PIDS_LIMIT" "$DAPR_PIDS_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_REDIS_MEMORY_LIMIT" "$REDIS_MEMORY_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_REDIS_MEMORY_SWAP_LIMIT" "$REDIS_MEMORY_SWAP_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_REDIS_MEMORY_RESERVATION" "$REDIS_MEMORY_RESERVATION"
  replace_or_append_env "$env_path" "PAWIFY_REDIS_CPUS" "$REDIS_CPUS"
  replace_or_append_env "$env_path" "PAWIFY_REDIS_PIDS_LIMIT" "$REDIS_PIDS_LIMIT"
  replace_or_append_env "$env_path" "PAWIFY_NODE_OPTIONS" "$NODE_OPTIONS_VALUE"
  replace_or_append_env "$env_path" "REDIS_MAXMEMORY" "$REDIS_MAXMEMORY_VALUE"
  replace_or_append_env "$env_path" "REDIS_MAXMEMORY_POLICY" "$REDIS_MAXMEMORY_POLICY_VALUE"
  replace_or_append_env "$env_path" "SENTRY_ENVIRONMENT" "$SENTRY_ENVIRONMENT"
  replace_or_append_env "$env_path" "GOOGLE_APPLICATION_CREDENTIALS" "/var/pawify/secrets/firebase-service-account.json"

  local redis_password
  redis_password="$REDIS_PASSWORD_INPUT"
  if [[ -z "$redis_password" ]]; then
    redis_password="$(read_env_value "$env_path" "REDIS_PASSWORD")"
  fi
  if [[ -z "$redis_password" || "$redis_password" == replace-with-* ]]; then
    redis_password="$(random_secret)"
  fi
  replace_or_append_env "$env_path" "REDIS_PASSWORD" "$redis_password"

  if [[ -n "$DAPR_SECRETS_FILE_SOURCE" ]]; then
    if [[ "$FORCE_SECRET_OVERWRITE" == "true" || ! -f "$secret_path" ]]; then
      copy_source_file "$DAPR_SECRETS_FILE_SOURCE" "$secret_path" "0600" "$owner"
    else
      log "preserved existing Dapr secret file: $secret_path"
    fi
  elif [[ ! -f "$secret_path" || "$FORCE_SECRET_OVERWRITE" == "true" ]]; then
    write_file "$secret_path" "0600" "$owner" <<EOF_SECRETS
{
  "gmail-email": "CHANGE_ME_GMAIL_EMAIL",
  "gmail-password": "CHANGE_ME_GMAIL_APP_PASSWORD",
  "discogs-token": "",
  "genius-access-token": ""
}
EOF_SECRETS
  else
    log "preserved existing Dapr secret file: $secret_path"
    chmod 600 "$secret_path" || true
    chown "$owner" "$secret_path" || true
  fi

  if [[ -n "$FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE" ]]; then
    if [[ "$FORCE_SECRET_OVERWRITE" == "true" || ! -f "$firebase_path" ]]; then
      copy_source_file "$FIREBASE_SERVICE_ACCOUNT_FILE_SOURCE" "$firebase_path" "0600" "$owner"
    else
      log "preserved existing Firebase service account file: $firebase_path"
    fi
  elif [[ ! -f "$firebase_path" ]]; then
    warn "Firebase service account file is not present yet: $firebase_path"
  fi

  chmod 600 "$env_path" "$secret_path" 2>/dev/null || true
  chown -R "$owner" "$APP_DIR/secrets" "$env_path" || true
}

validate_before_start() {
  local env_path="$APP_DIR/$ENV_FILE"
  local secret_path="$APP_DIR/secrets/$SECRETS_SUBDIR/dapr-secrets.json"
  local redis_password

  redis_password="$(read_env_value "$env_path" "REDIS_PASSWORD")"
  if [[ -z "$redis_password" || "$redis_password" == replace-with-* ]]; then
    err "$env_path has an unset REDIS_PASSWORD."
    exit 1
  fi

  if [[ ! -f "$secret_path" ]]; then
    err "Missing Dapr secret file: $secret_path"
    exit 1
  fi

  if grep -q 'replace-with-.*notify-token' "$env_path"; then
    err "$env_path still contains the placeholder NOTIFY_API_KEY."
    exit 1
  fi

  local firebase_json
  local google_credentials
  firebase_json="$(read_env_value "$env_path" "FIREBASE_SERVICE_ACCOUNT_JSON")"
  google_credentials="$(read_env_value "$env_path" "GOOGLE_APPLICATION_CREDENTIALS")"
  if [[ -z "$firebase_json" && -n "$google_credentials" ]]; then
    local firebase_host_path="$APP_DIR/secrets/$SECRETS_SUBDIR/firebase-service-account.json"
    if [[ ! -f "$firebase_host_path" ]]; then
      err "$env_path uses GOOGLE_APPLICATION_CREDENTIALS, but the host Firebase credential file is missing: $firebase_host_path"
      exit 1
    fi
  fi
}

compose_cmd() {
  sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && docker compose --env-file '$ENV_FILE' $*"
}

start_stack() {
  need_cmd docker
  validate_before_start

  log "Validating Docker Compose config for $ENVIRONMENT"
  compose_cmd "config >/dev/null"

  if [[ -n "$PREBUILT_IMAGE" ]]; then
    log "Pulling prebuilt Pawify $ENVIRONMENT image: $PREBUILT_IMAGE"
    compose_cmd "pull pawify pawify-dapr redis"
    compose_cmd "up -d --no-build"
  else
    log "Building and starting Pawify $ENVIRONMENT stack"
    compose_cmd "build pawify"
    compose_cmd "up -d"
  fi

  compose_cmd "ps"

  log "Health check: http://127.0.0.1:$HOST_PORT/v1/keep-alive"
  sleep 3
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "http://127.0.0.1:$HOST_PORT/v1/keep-alive" >/dev/null; then
      log "Pawify $ENVIRONMENT health check succeeded"
    else
      warn "Pawify health check failed. Check: cd $APP_DIR && docker compose --env-file $ENV_FILE logs -f --tail=100 pawify pawify-dapr redis"
    fi
  else
    warn "curl is unavailable, skipped HTTP health check."
  fi
}

main() {
  validate_args
  set_environment_defaults
  as_root_or_sudo

  if [[ "$INSTALL_DOCKER" == "true" ]]; then
    install_docker
  fi

  need_cmd git
  create_user_and_dirs
  login_to_image_registry
  clone_or_update_repo
  prepare_runtime_files

  if [[ "$START_STACK" == "true" ]]; then
    start_stack
  fi

  cat <<NEXT_STEPS

Done. Pawify $ENVIRONMENT is prepared in:
  $APP_DIR

Branch:
  $REPO_BRANCH

Host route target:
  http://127.0.0.1:$HOST_PORT

Public hostname expected:
  $PUBLIC_HOSTNAME

Runtime files to review:
  $APP_DIR/$ENV_FILE
  $APP_DIR/secrets/$SECRETS_SUBDIR/dapr-secrets.json
  $APP_DIR/secrets/$SECRETS_SUBDIR/firebase-service-account.json

Deploy/start command:
  cd $APP_DIR
  docker compose --env-file $ENV_FILE up -d --build

Logs:
  cd $APP_DIR
  docker compose --env-file $ENV_FILE logs -f --tail=100 pawify pawify-dapr redis

NEXT_STEPS
}

main "$@"
