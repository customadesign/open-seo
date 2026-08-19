#!/bin/sh
# Self-host container entrypoint. vite build inlines the envPrefix'd client
# envs (see vite.config.ts) into the bundle, so the build must run at container
# start — but the output stays valid until those envs or the image change.
# Fingerprint them and skip the build when the last start's output matches; an
# image update lands a fresh container with no build output, so new code always
# rebuilds.
set -e

echo 'OpenSEO sends an anonymous usage heartbeat (counts only). Disable: OPENSEO_TELEMETRY_DISABLED=1. Details: docs/SELF_HOSTING_DOCKER.md#telemetry'

# The preflight validates env BEFORE the slow steps, so misconfiguration fails
# in seconds with the exact fix instead of after a multi-minute build.
pnpm exec tsx scripts/selfhost-preflight.ts

# Wrangler skips its confirmation prompt in CI/non-interactive environments.
# Set CI explicitly because detached Docker containers do not imply it.
CI=true pnpm run db:migrate:local

# POSTHOG_SOURCEMAPS (CI sourcemap uploads) moves vite's outDir; keep the
# fingerprint marker beside the output it describes.
if [ "${POSTHOG_SOURCEMAPS:-}" = "true" ]; then OUT_DIR=dist-sourcemaps; else OUT_DIR=dist; fi
FP_FILE="$OUT_DIR/.openseo-build-env"
PREVIEW_CONFIG=".wrangler/deploy/config.json"

# Everything that changes build output: the envPrefix prefixes from
# vite.config.ts (keep in sync) plus POSTHOG_SOURCEMAPS.
FINGERPRINT="$(env | grep -E '^(VITE_|AUTH_MODE|BYPASS_EMAIL_VERIFICATION|DISABLE_PUBLIC_SIGNUP|DISABLE_SOCIAL_LOGIN|SINGLE_TENANT|POSTHOG_PUBLIC_KEY|POSTHOG_HOST|TURNSTILE_SITE_KEY|POSTHOG_SOURCEMAPS)' | sort | sha256sum | cut -d' ' -f1)"
# A missing sha256sum would yield an empty, always-matching fingerprint and
# silently disable rebuilds — fail loudly instead.
test -n "$FINGERPRINT"

# Vite preview also needs the Wrangler deployment pointer. It lives on the
# persistent .wrangler volume, not in dist, so a fresh volume paired with a
# prebuilt image can have a matching fingerprint but still be unstartable.
# The fingerprint alone cannot see that, so also require the server bundle it
# points at; when only the pointer is missing, write it instead of paying for a
# full rebuild.
if [ -f "$FP_FILE" ] && [ "$(cat "$FP_FILE")" = "$FINGERPRINT" ] && [ -f "$OUT_DIR/server/wrangler.json" ]; then
  if [ ! -f "$PREVIEW_CONFIG" ]; then
    mkdir -p "$(dirname "$PREVIEW_CONFIG")"
    printf '{"configPath":"../../%s/server/wrangler.json","auxiliaryWorkers":[]}\n' "$OUT_DIR" > "$PREVIEW_CONFIG"
  fi
  echo "Reusing existing build (build-relevant env unchanged)."
else
  echo "Building client + server (first start, changed build env, incomplete build, or new image)..."
  rm -f "$FP_FILE"
  pnpm run build
  printf '%s' "$FINGERPRINT" > "$FP_FILE"
fi

# Miniflare's local explorer (/cdn-cgi/explorer) reads and writes D1, KV, and
# R2 with no authentication, and @cloudflare/vite-plugin turns it on by
# default. Self-hosts run with app auth disabled, so default it off here too —
# compose sets it as well, but a plain `docker run` would otherwise ship it on.
export X_LOCAL_EXPLORER="${X_LOCAL_EXPLORER:-false}"

exec pnpm exec vite preview --host 0.0.0.0 --port "${PORT:-3001}"
