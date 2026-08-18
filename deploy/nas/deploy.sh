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

if [ "$ROLLBACK" = 1 ]; then
  previous="$(remote "cat '$NAS_DIR/.previous-image' 2>/dev/null || true")"
  if [ -z "$previous" ]; then
    echo "No previous image recorded on the NAS; nothing to roll back to." >&2
    exit 1
  fi
  echo "Rolling back to $previous"
  remote "cd '$NAS_DIR' && sudo sed -i 's|^OPEN_SEO_IMAGE=.*|OPEN_SEO_IMAGE=$previous|' .env && sudo docker compose up -d"
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
cat > "$ctx/Dockerfile" <<DOCKERFILE
FROM $tag-base
WORKDIR /app
RUN rm -rf /app/dist
COPY dist/ /app/dist/
DOCKERFILE
docker build --platform "$PLATFORM" -t "$tag" "$ctx"

echo "==> Exporting and copying to $NAS_HOST"
docker save "$tag" -o "$ctx/$tarball"
scp -q "$ctx/$tarball" "$NAS_HOST:$NAS_DIR/$tarball"

echo "==> Loading and restarting (sudo password may be requested)"
current="$(remote "grep '^OPEN_SEO_IMAGE=' '$NAS_DIR/.env' | cut -d= -f2-" | tr -d '[:space:]')"
ssh -t "$NAS_HOST" "cd '$NAS_DIR' \
  && sudo docker load -i '$tarball' \
  && printf '%s' '$current' | sudo tee .previous-image >/dev/null \
  && sudo sed -i 's|^OPEN_SEO_IMAGE=.*|OPEN_SEO_IMAGE=$tag|' .env \
  && sudo docker compose up -d \
  && printf '%s' '$sha' | sudo tee '$STAMP' >/dev/null \
  && rm -f '$tarball'"

echo "==> Waiting for health"
for _ in $(seq 1 60); do
  status="$(remote "sudo -n docker inspect --format '{{.State.Health.Status}}' open-seo 2>/dev/null || true" | tr -d '[:space:]')"
  case "$status" in
    healthy) echo "open-seo healthy on $tag"; exit 0 ;;
    unhealthy) echo "open-seo reports unhealthy. Roll back: $0 --rollback" >&2; exit 1 ;;
  esac
  sleep 5
done

echo "Timed out waiting for health. Check: ssh $NAS_HOST 'sudo docker compose -f $NAS_DIR/compose.yaml logs --tail=50'" >&2
exit 1
