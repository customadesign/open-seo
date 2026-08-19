#!/usr/bin/env bash
#
# Build and deploy the current commit to the self-hosted NAS.
#
# Two failure modes this exists to prevent, both of which happened:
#
# 1. Silent rollback. Several feature branches deploy to this one box. Deploying
#    a branch that does not contain what is already live reverts it with no
#    warning -- the tag changes, the app comes up, and the missing work is only
#    noticed later. The box now records the deployed commit and this script
#    refuses to move to a commit that is not a descendant of it.
#
# 2. Image drift. Images used to be built FROM the previously deployed image,
#    so an image accumulated files from every branch ever deployed and matched
#    no single commit. A clean rebuild then silently dropped whatever the
#    current branch happened to be missing. Here the base is built from
#    Dockerfile.selfhost at the target commit, so the image is reproducible
#    from that sha alone; Docker's layer cache, not the last image, provides
#    the speed.
#
# Usage:
#   deploy/nas/deploy.sh                 # deploy HEAD
#   deploy/nas/deploy.sh --force         # deploy anyway (rollbacks, hotfixes)
#   deploy/nas/deploy.sh --rollback      # return to the previous image tag
#
# Requires a TTY: docker on the NAS needs sudo.
set -euo pipefail

NAS_HOST="${NAS_HOST:-murphyconsulting@192.168.50.197}"
NAS_DIR="${NAS_DIR:-/volume1/docker/open-seo}"
# Tailscale MagicDNS resolves too, but the NAS restricts SSH to "Local network
# access only", so the LAN address is the one that authenticates.
STAMP="$NAS_DIR/.deployed-sha"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yaml}"
PLATFORM="linux/amd64"

FORCE=0
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

remote() { ssh -o BatchMode=yes "$NAS_HOST" "$@"; }

if ! remote "true" 2>/dev/null; then
  echo "Cannot reach $NAS_HOST over SSH." >&2
  echo "SSH on this NAS is restricted to the local network, so the tailnet" >&2
  echo "hostname will not authenticate -- use the LAN address." >&2
  exit 1
fi

# docker on the NAS needs sudo, and sudo needs somewhere to read a password
# from. Without this check the script builds and ships ~800MB before dying at
# the last step, so fail here instead.
if ! remote "sudo -n true" 2>/dev/null && [ ! -t 0 ]; then
  echo "docker on the NAS needs sudo, and this shell has no terminal for the" >&2
  echo "password prompt. Run this from an interactive terminal, or grant" >&2
  echo "passwordless sudo for docker on the NAS." >&2
  exit 1
fi

if [ "$ROLLBACK" = 1 ]; then
  previous="$(remote "cat '$NAS_DIR/.previous-image' 2>/dev/null || true" | tr -d '[:space:]')"
  previous_sha="$(remote "cat '$NAS_DIR/.previous-sha' 2>/dev/null || true" | tr -d '[:space:]')"
  if [ -z "$previous" ]; then
    echo "No previous image recorded on the NAS; nothing to roll back to." >&2
    exit 1
  fi
  echo "Rolling back to $previous"
  # The stamp has to move back with the image. Leaving it pointing at the
  # rolled-back commit makes the guard compare against something that is not
  # running -- worse than no guard, because it reads as authoritative.
  ssh -t "$NAS_HOST" "cd '$NAS_DIR' \
    && sed -i 's|^OPEN_SEO_IMAGE=.*|OPEN_SEO_IMAGE=$previous|' .env \
    && sudo docker compose -f '$COMPOSE_FILE' up -d \
    && printf '%s' '$previous_sha' > '$STAMP'"
  if [ -z "$previous_sha" ]; then
    echo "WARNING: no previous commit was recorded, so the stamp is now empty." >&2
    echo "The next deploy cannot check for a rollback. Deploy through this" >&2
    echo "script to restore it." >&2
  fi
  exit 0
fi

# A dirty tree means the image would contain code that no sha describes -- the
# exact drift this script exists to prevent.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash before deploying." >&2
  exit 1
fi

sha="$(git rev-parse HEAD)"
short="$(git rev-parse --short HEAD)"
tag="open-seo:nas-$short"
tarball="open-seo-nas-$short.tar"

deployed="$(remote "cat '$STAMP' 2>/dev/null || true" | tr -d '[:space:]')"

if [ -n "$deployed" ]; then
  if ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
    echo "NAS reports commit $deployed, which does not exist locally." >&2
    echo "Fetch it, or pass --force if you mean to overwrite it." >&2
    [ "$FORCE" = 1 ] || exit 1
  elif [ "$deployed" = "$sha" ]; then
    echo "NAS already runs $short. Nothing to do."
    exit 0
  elif ! git merge-base --is-ancestor "$deployed" "$sha"; then
    echo "REFUSING: $short does not contain what is deployed ($(git rev-parse --short "$deployed"))." >&2
    echo "Deploying it would revert:" >&2
    git log --oneline "$sha..$deployed" | sed 's/^/  /' >&2
    echo "Merge or rebase first, or pass --force if the revert is intended." >&2
    [ "$FORCE" = 1 ] || exit 1
  fi
else
  echo "WARNING: the NAS has no recorded commit (first guarded deploy)."
  echo "Cannot prove this moves forward. Continuing; the stamp starts here."
fi

echo "==> Building client + server bundle at $short"
pnpm run build

echo "==> Building base image from Dockerfile.selfhost at $short"
docker build --platform "$PLATFORM" -f Dockerfile.selfhost -t "$tag-base" .

# The repo .dockerignore excludes **/dist (correct for the source image, whose
# entrypoint builds at start). Staging dist in its own context ships a prebuilt
# bundle so the container starts in seconds instead of minutes.
echo "==> Layering prebuilt bundle"
ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
cp -R dist "$ctx/dist"
: > "$ctx/.dockerignore"

# docker-entrypoint.sh rebuilds unless dist/.openseo-build-env matches a hash of
# the build-relevant container env, because vite inlines those values into the
# bundle. Shipping dist without the marker means every start rebuilds and the
# prebuilt layer buys nothing -- which is exactly what happened on the first
# real deploy: ~230s to become healthy, and compose gave up waiting.
#
# Reproduce the entrypoint's fingerprint from the env the container will
# actually see: the values compose sets literally, plus matching keys from the
# NAS .env. Keep the key list in sync with docker-entrypoint.sh. A mismatch is
# safe -- the entrypoint just rebuilds, the same as having no marker at all.
echo "==> Computing build fingerprint"
#
# compose sets AUTH_MODE and VITE_SHOW_DEVTOOLS literally, and those win over
# env_file, so they are excluded from the .env-derived half to avoid emitting a
# key twice. `sort` (not `sort -u`) matches the entrypoint exactly.
fingerprint="$(
  {
    echo "AUTH_MODE=local_noauth"
    echo "VITE_SHOW_DEVTOOLS=false"
    remote "grep -E '^(VITE_|BYPASS_EMAIL_VERIFICATION|POSTHOG_PUBLIC_KEY|POSTHOG_HOST|TURNSTILE_SITE_KEY|POSTHOG_SOURCEMAPS)=' '$NAS_DIR/.env' 2>/dev/null | grep -vE '^VITE_SHOW_DEVTOOLS=' || true"
  } | sort | shasum -a 256 | cut -d' ' -f1
)"
printf '%s' "$fingerprint" > "$ctx/dist/.openseo-build-env"

cat > "$ctx/Dockerfile" <<DOCKERFILE
FROM $tag-base
WORKDIR /app
RUN rm -rf /app/dist
COPY dist/ /app/dist/
DOCKERFILE
docker build --platform "$PLATFORM" -t "$tag" "$ctx"

echo "==> Exporting and copying to $NAS_HOST"
docker save "$tag" -o "$ctx/$tarball"
checksum="$(shasum -a 256 "$ctx/$tarball" | cut -d' ' -f1)"
# SFTP is disabled on this NAS, and modern scp speaks SFTP, so it fails with a
# misleading "No such file or directory" on a path that plainly exists. Piping
# through ssh needs no subsystem and no scp -O support.
ssh -o BatchMode=yes "$NAS_HOST" "cat > '$NAS_DIR/$tarball'" < "$ctx/$tarball"

# ~800MB over a pipe: verify before loading, so a truncated transfer fails here
# rather than as a confusing docker load error.
remote_sum="$(remote "sha256sum '$NAS_DIR/$tarball' | cut -d' ' -f1" | tr -d '[:space:]')"
if [ "$checksum" != "$remote_sum" ]; then
  echo "Transfer corrupted: expected $checksum, got $remote_sum" >&2
  remote "rm -f '$NAS_DIR/$tarball'"
  exit 1
fi

echo "==> Loading and restarting (sudo password may be requested)"
current="$(remote "grep '^OPEN_SEO_IMAGE=' '$NAS_DIR/.env' | cut -d= -f2-" | tr -d '[:space:]')"
current_sha="$(remote "cat '$STAMP' 2>/dev/null || true" | tr -d '[:space:]')"
# Start the app alone first. The scheduler declares depends_on
# condition: service_healthy, and compose waits only briefly -- on a start that
# needs minutes (migrations, or a bundle rebuild when the fingerprint misses)
# compose reports "dependency failed to start", exits non-zero, and everything
# chained after it is skipped. That is how the first real deploy left the stamp
# unwritten and the scheduler down while the app itself came up fine.
# `set -e` must not kill us here. .env has already been repointed at $tag by the
# time compose runs, so an abort would leave the box on the new tag with the old
# container gone and never reach the rollback hint below. Capture the status.
started=0
ssh -t "$NAS_HOST" "cd '$NAS_DIR' \
  && sudo docker load -i '$tarball' \
  && printf '%s' '$current' > .previous-image \
  && printf '%s' '$current_sha' > .previous-sha \
  && sed -i 's|^OPEN_SEO_IMAGE=.*|OPEN_SEO_IMAGE=$tag|' .env \
  && sudo docker compose -f '$COMPOSE_FILE' up -d open-seo \
  && rm -f '$tarball'" && started=1

if [ "$started" != 1 ]; then
  echo "Start failed. The image tag is already switched to $tag." >&2
  echo "  ssh $NAS_HOST \"cd $NAS_DIR && sudo docker compose -f $COMPOSE_FILE logs --tail=50 open-seo\"" >&2
  echo "Exit code 137 means the in-container build was OOM-killed: the image is" >&2
  echo "not prebuilt, or its fingerprint does not match this host's build env." >&2
  echo "Roll back: $0 --rollback" >&2
  exit 1
fi

# The container healthcheck would be the better signal, but reading it needs
# `docker inspect` and therefore sudo, which cannot be re-prompted here. The
# app's own health endpoint is served on loopback and needs neither.
echo "==> Waiting for health"
port="$(remote "grep '^PORT=' '$NAS_DIR/.env' | cut -d= -f2-" | tr -d '[:space:]')"
port="${port:-3001}"
# A cold start runs migrations and, on a fingerprint miss, a full bundle
# rebuild. 6 minutes covers the ~230s observed on the first real deploy with
# room to spare.
healthy=0
for _ in $(seq 1 72); do
  if remote "curl -sf --max-time 5 http://127.0.0.1:$port/api/health >/dev/null"; then
    healthy=1
    break
  fi
  sleep 5
done

if [ "$healthy" != 1 ]; then
  echo "Timed out waiting for health. Check:" >&2
  echo "  ssh $NAS_HOST \"cd $NAS_DIR && sudo docker compose -f $COMPOSE_FILE logs --tail=50\"" >&2
  echo "Roll back: $0 --rollback" >&2
  exit 1
fi

# The app is up, so record it before touching the sidecar: a scheduler that
# fails to start is worth reporting, but it does not change which commit is
# serving traffic, and a missing stamp disarms the guard on the next deploy.
remote "printf '%s' '$sha' > '$STAMP'"

echo "==> Starting scheduler"
ssh -t "$NAS_HOST" "cd '$NAS_DIR' && sudo docker compose -f '$COMPOSE_FILE' up -d open-seo-scheduler"

# Container processes are visible in the host process table, so this needs
# neither docker nor sudo.
if [ "$(remote "ps -eo args | grep -c '[s]elfhost-scheduler'" | tr -d '[:space:]')" = "0" ]; then
  echo "WARNING: open-seo is healthy on $tag, but the scheduler is not running." >&2
  echo "Scheduled rank checks, geo-grids and monthly reports will not fire." >&2
  echo "  ssh $NAS_HOST \"cd $NAS_DIR && sudo docker compose -f $COMPOSE_FILE up -d open-seo-scheduler\"" >&2
  exit 1
fi

echo "open-seo healthy on $tag, scheduler running"
