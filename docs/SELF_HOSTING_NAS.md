# NAS Deployment

How the self-hosted NAS instance is built and updated. For the generic Docker
setup see [`SELF_HOSTING_DOCKER.md`](./SELF_HOSTING_DOCKER.md); this document
covers the single long-lived box that several feature branches deploy to.

## Deploying

From a clean checkout of the commit you want live:

```bash
deploy/nas/deploy.sh
```

It builds the bundle, builds an image from `Dockerfile.selfhost` at that commit,
copies it to the NAS, switches `OPEN_SEO_IMAGE`, restarts the stack, and waits
for the container healthcheck. `sudo` on the NAS prompts for a password, so run
it from a real terminal.

To undo the last deploy:

```bash
deploy/nas/deploy.sh --rollback
```

The previous image stays loaded on the box, so rollback is a tag switch and a
restart — no rebuild, no transfer.

## The fast-forward guard

The NAS records the deployed commit in `.deployed-sha`. Before deploying,
`deploy.sh` checks that the new commit is a descendant of it:

```
git merge-base --is-ancestor "$deployed" "$sha"
```

If it is not, the deploy is refused and the commits that would be reverted are
printed. This exists because multiple feature branches deploy to this one box:
deploying a branch that forked before the live one silently reverts everything
in between, the app comes up clean, and the loss surfaces days later.

Pass `--force` when the revert is intended — rolling back a bad release, or
deploying a hotfix branch cut from an older commit.

The stamp is only as good as the deploys that write it. An image loaded by hand
leaves the stamp stale, and the next guarded deploy will compare against the
wrong commit; deploy through the script.

## NAS quirks worth knowing

**SSH is restricted to the local network.** Control Panel -> Terminal -> SSH ->
Advanced settings is set to "Local network access only", so the tailnet
hostname authenticates nowhere. Use the LAN address; a wrong password is not
what the rejection means.

**SFTP is disabled, and modern `scp` speaks SFTP.** `scp` fails with
`No such file or directory` on a path that demonstrably exists, which reads as
a permissions or typo problem and is neither. `deploy.sh` pipes the image
through `ssh 'cat > file'`, which needs no subsystem. `scp -O` also works if
you are copying something by hand.

**`docker` requires sudo.** The account is in `admin`, not `docker`, and the
socket is `root:docker 0660`. `deploy.sh` checks for a usable sudo before
building rather than after shipping ~800MB. Adding the account to `docker`
would remove the prompt, at the cost of making it root-equivalent on a box
holding client data.

## Why the image is built from the commit

Images were previously built `FROM` the last deployed image, layering a fresh
`dist/` onto whatever was already there. That is fast, and wrong: the image
accumulated files from every branch ever deployed and corresponded to no single
commit. Files could be present in the running container while absent from the
branch that produced it — the self-host scheduler sidecar ran that way for some
time, one clean rebuild away from disappearing.

`deploy.sh` builds the base from `Dockerfile.selfhost` at the target commit, so
the image is reproducible from that sha alone. Docker's layer cache keeps this
cheap: `pnpm install` only re-runs when `pnpm-lock.yaml` changes. It costs
nothing in size either — a commit-pinned base measures ~763MB against ~801MB
for the equivalent layered image.

A prebuilt `dist/` is layered on top afterwards so the container does not spend
minutes running `pnpm run build` at startup (see `docker-entrypoint.sh`). That
layer comes from the same commit as the base.

## The stack

`deploy/nas/compose.yaml` is the source of truth for what runs on the box, and
must be kept in sync with `$NAS_DIR/compose.yaml` there. Two services:

- `open-seo` — the app, published on loopback only, with `./data` bind-mounted
  to `/app/.wrangler` (SQLite state, tracked keywords, audit results).
- `open-seo-scheduler` — sidecar that pokes Miniflare's scheduled trigger every
  5 minutes. Cloudflare fires `wrangler.jsonc` triggers in production; under
  `vite preview` nothing does, so without this sidecar rank checks, geo-grids,
  monthly reports and the stale-audit watchdog never run.

The scheduler shares the app's network namespace so the unauthenticated trigger
endpoint is reachable only over loopback. Deny `/cdn-cgi/` at any reverse proxy
in front of this — the prefix also serves Miniflare's local explorer, which has
read/write access to D1, KV and R2.

## Data

`./data` is a bind mount outside the image, so switching image tags never
touches it. It is the only thing on the box that cannot be rebuilt — back it up
independently of any deploy.
