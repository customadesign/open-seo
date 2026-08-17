# Docker Self-Hosting

Run OpenSEO locally with Docker.

In Docker mode, OpenSEO uses `AUTH_MODE=local_noauth` (no auth checks, local admin user `admin@localhost`). Only expose it behind your own auth-protected reverse proxy, tunnel, or private network.

The default `compose.yaml` uses the published GHCR image:

- `ghcr.io/every-app/open-seo:latest`

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A DataForSEO API key (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md))

## Quickstart

```bash
cp .env.example .env
```

Set `DATAFORSEO_API_KEY` in `.env` using the [DataForSEO setup guide](./DATAFORSEO_API_KEY.md), then start OpenSEO:

```bash
docker compose up -d
```

Open `http://localhost:<PORT>` (default `3001`). The first start builds the app and may take 1-2 minutes; follow progress with `docker compose logs -f`.

Optional env values:

- `PORT` (defaults to `3001`)
- `ALLOWED_HOST` (single reverse-proxy hostname to allow in Vite preview)
- `AUTH_MODE=local_noauth` (already set in compose)
- `OPEN_SEO_IMAGE` (defaults to `ghcr.io/every-app/open-seo:latest`)
- `OPENROUTER_API_KEY` (required for AI features such as SAM; see [OpenRouter](https://openrouter.ai/settings/keys))

If you are putting Docker behind a reverse proxy or a temporary tunnel, remember that Docker self-hosting runs with app auth disabled. Only expose it behind your own auth-protected reverse proxy, tunnel, or private network, and add the public hostname before restarting:

```bash
ALLOWED_HOST=yourdomain.com docker compose up -d
```

You can also persist it in `.env`.

## Scheduled work

Cloudflare deployments run the cron triggers in `wrangler.jsonc` themselves. Docker self-hosts serve the same Worker through `vite preview` -> Miniflare, which never fires those triggers, so `compose.yaml` ships an `open-seo-scheduler` sidecar that drives them.

The sidecar waits for the app's health check, then every five minutes sends one `POST` to Miniflare's scheduled-handler endpoint on `127.0.0.1`. Each tick runs the stale-audit watchdog, scheduled rank checks, scheduled geo-grids, AI visibility, due monthly reports, report delivery, and report retention. Rank and AI admission loops stop after one minute each so work later in the tick cannot be starved. The sidecar waits for one request at a time and aborts its request after 270 seconds. A server handler may still finish after the client aborts, so every scheduler uses compare-and-set claims and can tolerate overlap. A failed tick is not retried before the next slot.

Without it, nothing scheduled ever runs, including rank checks, geo-grids, AI visibility, monthly reports, delivery, and retention. Confirm it is up:

```bash
docker compose ps open-seo-scheduler
docker compose logs -f open-seo-scheduler
```

Scheduled work spends DataForSEO credits. To turn it off, stop the sidecar (the app keeps working; on-demand runs are unaffected):

```bash
docker compose stop open-seo-scheduler
```

## Reverse-proxy rules

Miniflare serves its own control endpoints under `/cdn-cgi/`. They are unauthenticated and are not part of the app:

- `/cdn-cgi/handler/scheduled` runs the scheduled handlers, which spend DataForSEO credits.
- `/cdn-cgi/explorer` reads and writes your D1, KV, and R2 data.

Deny the entire `/cdn-cgi/` prefix at your proxy — never just the scheduled path, which would leave the explorer reachable. The sidecar shares the app container's network namespace, so it reaches the endpoint over loopback and never through the proxy.

nginx:

```nginx
location /cdn-cgi/ {
  deny all;
  return 404;
}
```

Caddy:

```caddyfile
@cdncgi path /cdn-cgi/*
respond @cdncgi 404
```

`compose.yaml` and the container entrypoint also set `X_LOCAL_EXPLORER=false`, which stops Miniflare from mounting the explorer at all. Leave it off: `@cloudflare/vite-plugin` enables the explorer by default, and self-hosts run with app auth disabled.

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. Telemetry also includes failed setup check names and statuses, never values or error messages. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in `.env`, then run `docker compose up -d --force-recreate open-seo`.

## Pin to a specific image tag

Set `OPEN_SEO_IMAGE` in `.env` and restart:

```bash
OPEN_SEO_IMAGE=ghcr.io/every-app/open-seo:v1.2.3
docker compose up -d
```

## Build your own image locally

If you are testing local code changes, build and run a local tag:

```bash
docker build -f Dockerfile.selfhost -t open-seo:local .
OPEN_SEO_IMAGE=open-seo:local docker compose up -d
```

## Common commands

- Restart service after env changes:

```bash
docker compose up -d open-seo
```

- Pull latest published image and restart:

```bash
docker compose pull && docker compose up -d
```

- Stop:

```bash
docker compose down
```

## Health and troubleshooting

Startup checks appear in `docker compose logs` before the build. Once running, `/api/health` reports configuration and database status, and `docker compose ps` reports container health.

## Troubleshooting environment variables

To confirm Docker Compose is using the expected environment variables:

```bash
docker compose config
```

Check that `AUTH_MODE=local_noauth`, and that `DATAFORSEO_API_KEY` is the base64
encoded value of your DataForSEO email and API password in this format:
`email:password`.

If you changed `.env`, recreate the container so Compose reapplies it:

```bash
docker compose up -d --force-recreate open-seo
```
