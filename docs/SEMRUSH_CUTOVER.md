# SEMrush cutover runbook

This runbook is the final control list for replacing the agency's in-scope
SEMrush workflows with OpenSEO. Completing the implementation is not permission
to deploy, activate paid recurring work, email clients, downgrade, or cancel a
subscription. Those actions remain separate approvals.

## 1. Preserve the source data

- Export the active SEMrush project inventory and reconcile it against the
  OpenSEO project list.
- Preserve the API archive for Management projects, `domain_ranks`, and
  `domain_organic`, including its checksums.
- Collect and review the UI/API exports that are not in the first archive:
  Position Tracking history and competitors, Backlink Audit/disavow history,
  backlink exports, and Site Audit history.
- Record the SEMrush campaign IDs and the date of each export. Keep the original
  files immutable.
- Import disavow files as reviewed registry entries. An imported entry is not a
  toxicity finding and OpenSEO never submits it to Google automatically.

## 2. Preflight the target deployment

- Back up the production database and object storage.
- Run the report-delivery preflight against the target database before applying
  migrations:

  ```bash
  pnpm exec tsx scripts/report-delivery-preflight.ts --provider postgres
  pnpm exec tsx scripts/report-delivery-preflight.ts --provider d1 --database open-seo
  ```

- Resolve any orphaned legacy `report_*` rows reported by the preflight. Do not
  guess at cleanup on a live database.
- Review the generated SQLite/D1 and Postgres migrations together and confirm
  they create equivalent constraints, indexes, and defaults.
- D1 applies migration statements individually. Keep the backup until both
  `rank_tracking_configs_national_idx` and `rank_tracking_configs_local_idx`
  are present after the engine-column migration.
- Verify the Uptown project received exactly three `semrush_csv` disavow rows:
  `house-rent.info`, `desingtrend.vercel.app`, and `p.eurekster.com`. A migration
  that cannot identify the project safely leaves the seed empty.
- Confirm self-host traffic cannot reach `/cdn-cgi/`, Local Explorer is off, and
  the scheduler sidecar can only call the OpenSEO service over its shared
  loopback network.

## 3. Configure providers safely

- Configure DataForSEO credentials, but leave imported Bing trackers and AI
  visibility configurations inactive.
- Measure the real cost of one representative Bing run and one prompt for each
  enabled AI provider. Record both the estimate and settled provider cost.
- Set a reviewed standing ceiling before enabling an AI visibility schedule.
  Do not activate the archived eight Bing keywords or 65 AI prompts as a bulk
  test.
- Configure Gotenberg behind an authenticated HTTPS proxy. Non-loopback renderers
  require `REPORT_PDF_RENDER_BEARER_TOKEN`.
- Configure R2 and Resend, leaving `REPORT_DELIVERY_TEST_MODE` enabled (unset is
  also safe) and `REPORT_TEST_RECIPIENTS` limited to internal test addresses.
- Confirm the PDF renderer, object checksum, expiring share link, and email
  delivery independently before adding a client recipient. Confirm email
  delivery twice: once through the manual requester test, and once through a
  scheduled profile whose recipient is on the allowlist.

## 4. Run a parallel observation cycle

For at least one complete reporting cycle, keep SEMrush and OpenSEO running in
parallel and record differences rather than silently choosing the preferred
result.

- Compare Google and Bing ranking observations by keyword, location, device,
  timestamp, and search depth.
- Compare representative technical audits, including regressions and false
  positives.
- Compare geo-grid matching and cell ranks for representative local clients.
- Review AI visibility evidence and citations provider by provider. OpenSEO does
  not reproduce a proprietary SEMrush visibility score.
- Generate a report from a named profile and review sections, branding,
  recipients, timezone, PDF, share expiry, retry state, and change alerts.
- Verify GSC and GA4 properties are mapped to the intended client projects.
- Record all exceptions and their disposition in the cutover evidence log.

## 5. Approval gates

Do not proceed to cancellation until every statement below is true:

- The archive inventory is complete and checksummed, including reviewed manual
  exports for datasets the SEMrush APIs did not preserve.
- One full parallel cycle has been reviewed and material differences have an
  accepted explanation or fix.
- Provider costs have been measured and recurring ceilings approved.
- A scheduled profile delivery to an address in `REPORT_TEST_RECIPIENTS` has
  completed successfully. A manual "send me a copy" test does not satisfy this
  gate: it is allowed to the requester's own verified address regardless of the
  allowlist, so it exercises a different path. Client delivery has separate
  approval.
- Any SEMrush Local dependency for listings, duplicate suppression, reviews, GBP
  publishing, or user suggestions has an explicit GoHighLevel/Yext/GBP owner.
- Paid media, Traffic & Market, social, and content-suite dependencies have been
  inventoried separately rather than treated as OpenSEO parity gaps.
- The account owner explicitly approves the deployment, recurring activation,
  any client email, and SEMrush downgrade or cancellation.

## 6. Cut over and retain evidence

- Apply the reviewed migrations and deploy using the normal production release
  process.
- Activate only the approved project configurations and cost ceilings.
- Keep report delivery allowlist-only until the approved client-delivery date.
- Retain report PDFs for 13 months and keep share links at 90 days or less.
- Store the final archive manifest, reconciliation notes, parallel-cycle results,
  approvals, cancellation confirmation, and final billing date together.
- Monitor the scheduler, provider costs, failed deliveries, and change events
  during the first live cycle. A failed or incomplete cycle pauses cutover; it
  does not authorize a backfill storm.

## Explicit non-goals

OpenSEO does not need to reproduce every product sold under the SEMrush brand.
Native outreach CRM, listing syndication, review management, GBP posting, paid
media, traffic-market intelligence, social publishing, and a proprietary AI
visibility score remain outside this cutover unless the agency approves a new,
separate scope.
