# SEMrush archive and import tooling

These commands preserve SEMrush data as files before any application-level migration work. Version 1 writes a normalized import bundle and a reconciliation report. It does not write to the OpenSEO database.

## Commands

Set the API key in the process environment. Do not pass it on the command line.

```bash
export SEMRUSH_API_KEY="..."

pnpm semrush:archive \
  --output /absolute/path/to/semrush-archive \
  --databases us \
  --domains example.com,example.org

pnpm semrush:import \
  --input /absolute/path/to/semrush-archive \
  --output /absolute/path/to/semrush-import-bundle
```

Both directories are required. Use a new directory when you change the requested domains, databases, page size, or source archive. A command resumes when its output directory contains a compatible manifest.

Run either command with `--dry-run` to inspect the plan without network requests or file writes:

```bash
pnpm semrush:archive --output /tmp/semrush-archive --dry-run
pnpm semrush:import --input /path/to/archive --output /tmp/semrush-bundle --dry-run
```

## Archived API data

The archive command issues GET requests only:

- Management API: `/management/v1/projects` (without a trailing slash).
- Analytics API: `type=domain_ranks` for each domain and database.
- Analytics API: paginated `type=domain_organic` data for each domain and database.

If `--domains` is omitted, the command extracts domains from the management project response. `--databases` defaults to `us`. `--page-size`, `--max-pages`, and `--max-retries` set pagination and retry limits. This tool caps `--page-size` at 1,000 and uses additional pages rather than treating a provider-truncated page as complete.

SEMrush Analytics calls consume API units. A retry can repeat a billed read after a timeout or HTTP 5xx response. The client retries only transport failures, HTTP 408, HTTP 429, and HTTP 5xx responses. It never calls project creation, tracking enablement, keyword mutation, or competitor mutation endpoints.

## Archive layout

```text
manifest.json
checksums.sha256
raw/
  management/projects.json
  analytics/<database>/<domain>/domain-ranks.csv
  analytics/<database>/<domain>/domain-ranks.nothing-found.txt
  analytics/<database>/<domain>/domain-organic/page-000001.csv
  analytics/<database>/<domain>/domain-organic/nothing-found-offset-00000000.txt
```

The `.nothing-found.txt` forms are used only when SEMrush returns an explicit `NOTHING FOUND` response. The endpoint checkpoint records that state, and reconciliation lists it separately from a valid CSV that contains zero rows.

`manifest.json` records one checkpoint per API endpoint, the next organic-search offset, each completed page, request attempts, and SHA-256 metadata. The command writes the manifest after each page. On resume, it checks the recorded byte count and checksum before skipping a file. A damaged page restarts that endpoint at the first bad page.

The API key is absent from the manifest and request logs. Error text passes through a redactor before the command prints or stores it.

## Import bundle

The import command verifies `checksums.sha256` and every file record before it parses the archive. By default it refuses a manifest without `completedAt` or with a non-complete endpoint. `--allow-incomplete-source` is available for a diagnostic bundle; the resulting reconciliation file records the missing completion marker and every incomplete endpoint.

It writes:

```text
import-manifest.json
checksums.sha256
normalized/projects.ndjson
normalized/domain-snapshots.ndjson
normalized/organic-keywords.ndjson
reconciliation.json
```

The normalized records retain their SEMrush source identifiers and source-file paths. Domain matching lowercases hostnames and removes a leading `www`. Duplicate rows use deterministic keys. The bundle keeps the first conflicting row in source-file order and lists each conflict in `reconciliation.json`.

The reconciliation report counts malformed rows and duplicates. It also lists:

- Analytics domains that have no matching SEMrush project.
- SEMrush projects whose domain has no archived analytics rows.
- Multiple SEMrush projects that normalize to the same domain.
- SEMrush endpoints that returned `NOTHING FOUND`.
- Any incomplete source endpoints when the diagnostic override was used.

Review that report before building a database importer. A future database-writing version must map these records through OpenSEO services and repositories instead of inserting this bundle directly.

## Known cancellation-gate gaps

Version 1 does not archive Position Tracking campaign configuration, tracked keywords and tags, target locations and devices, campaign competitors, backlinks, or Site Audit history. Capture those through a documented API or a separately reviewed SEMrush UI export before cancellation. The normalized bundle currently reconciles projects, domains, domain snapshots, and organic keywords only.

## Tests

```bash
pnpm test:semrush
```

The fixture suite covers interrupted pagination, checksum rejection, secret redaction, output-stage resume, duplicate handling, and reconciliation counts.
