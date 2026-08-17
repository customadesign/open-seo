# Report delivery

A delivery profile turns a published report run into something a client
receives: a branded PDF stored in R2, an expiring share link, and an email to
each saved recipient. Profiles sit beside the existing monthly report settings —
the snapshot pipeline (`monthly_report_runs`, `monthly_report_commentary_items`)
is unchanged, and a project can run several profiles against it.

PDFs are produced by [Gotenberg's Chromium HTML route](https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf)
and email is sent through [Resend](https://resend.com/docs/api-reference/emails/send-email).
Both are optional: without them a run still publishes, and the Reports data stays
available in the app.

## What a profile owns

| Field                           | Meaning                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `name`                          | Label for the audience ("Client monthly", "Internal weekly") |
| `sections`                      | Which report sections this audience sees, in order           |
| `branding`                      | Brand name, logo URL, primary and accent color               |
| `recipients`                    | Up to 25 addresses, each with an optional display name       |
| `frequency` + `timeZone`        | `daily`, `weekly` (`runWeekday`) or `monthly` (`runDay`)     |
| `runHour`                       | Local hour of the run; DST-safe, the wall-clock time is kept |
| `attachPdf`, `includeShareLink` | Whether the email carries the PDF and a share URL            |
| `shareLinkTtlDays`              | Share link lifetime, 1–90 days                               |

The cron tick claims a due profile with a compare-and-set on `next_run_at`,
creates a scheduled run, and the report workflow generates the snapshot and then
delivers it as a separate step.

## Configuration

| Variable                         | Required for | Value                                                                                                          |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `REPORT_PDF_RENDER_URL`          | PDF          | Public **HTTPS** endpoint in front of Gotenberg (loopback `http` allowed locally)                              |
| `REPORT_PDF_RENDER_BEARER_TOKEN` | PDF          | Required for any non-loopback renderer; sent as `Authorization: Bearer …`                                      |
| `RESEND_API_KEY`                 | Email        | Resend API key                                                                                                 |
| `REPORT_EMAIL_FROM`              | Email        | Sender on a Resend-verified domain, e.g. `OpenSEO Reports <reports@example.com>`                               |
| `REPORT_EMAIL_REPLY_TO`          | Email        | Optional reply address                                                                                         |
| `BETTER_AUTH_URL`                | Share links  | Base URL used to build share URLs                                                                              |
| `REPORT_DELIVERY_TEST_MODE`      | Safety       | **`false` is the only value that permits client delivery**; anything else (including unset) keeps test mode on |
| `REPORT_TEST_RECIPIENTS`         | Safety       | Comma-separated allowlist of addresses                                                                         |

Set them in `.env.local` (development), `.env` (Docker), `.env.selfhost`, or
`.env.production`, then restart or redeploy.

Gotenberg has no authentication of its own and its maintainers advise against
exposing it to the internet. Put it behind a proxy, gateway or tunnel that
requires the bearer token. A plain `http://` or private-address endpoint is
rejected rather than silently used, and a non-loopback renderer configured
without `REPORT_PDF_RENDER_BEARER_TOKEN` is refused (with a warning) instead of
being called unauthenticated — only a loopback renderer may run tokenless.

## Safety rules built into delivery

- **Test-recipient allowlist, fail-closed.** Test mode is on unless
  `REPORT_DELIVERY_TEST_MODE` is exactly `false`, so a deployment that
  configures Resend without deciding about client delivery mails nobody: only
  addresses in `REPORT_TEST_RECIPIENTS` go out, and every other recipient is
  recorded as `skipped` with the reason. An empty allowlist in test mode sends
  to nobody at all. The manual "send me a copy" test is a **separate** path with
  its own rule: it is limited to the requester's own verified address or the
  allowlist, in every environment, and it is not affected by test mode. A
  successful manual test therefore does not prove a scheduled profile will
  deliver — see "Verifying a deployment".
- **PDF validation.** The renderer response must start with `%PDF-` and stay at
  or under 25 MB, checked before storage and again before attaching.
- **Stable storage keys.** Each run's PDF lives at `reports/<run-id>/report.pdf`,
  uploaded with its SHA-256 as both R2 metadata and the `sha256` integrity check
  R2 verifies server-side, so a retry replaces the object instead of orphaning
  copies and a corrupted upload is rejected.
- **Idempotent email.** Every send carries `Idempotency-Key:
report:<run-id>:<email>`; Resend keeps those keys for 24 hours. Past that
  window the database is the guard: one delivery row per run and recipient,
  with its own status and attempt count, so a later retry only re-sends what
  actually failed. Display names, sender and subject are
  stripped of CR/LF before they reach a header.
- **No project-controlled server fetches.** Saved logo URLs render in the share
  page and email but are never given to the PDF renderer, which would otherwise
  fetch an arbitrary address on the server's behalf.
- **Hardened share links.** 32 random bytes, stored only as a SHA-256 hash, with
  an expiry (max 90 days), revocation, and access counting. The share endpoint
  answers one 404 for missing, expired, revoked and unpublished alike, and serves
  the report under a no-store, `frame-ancestors 'none'` CSP.

## Retention

- Stored PDFs expire 13 months after delivery; the cron sweep deletes the R2
  object first and drops the row only after that succeeds.
- Share link rows are purged 90 days after their expiry, keeping the audit trail
  (last access, access count) available for the period that matters.

## Change alerts

Delivery and audit outcomes are recorded in the project change feed
(`project_change_events`): report failures and recoveries, delivery failures, and
new or resolved site issues compared with the previous completed crawl of the
same start URL. Read state is per user, so one teammate reading an alert does not
hide it for everyone.

## Before deploying the migrations

`scripts/report-delivery-preflight.ts` is read-only. It prints the migrations the
target database already records and any leftover rows in the superseded
`report_*` prototype tables, including rows orphaned from a deleted project:

```bash
pnpm exec tsx scripts/report-delivery-preflight.ts --provider postgres
pnpm exec tsx scripts/report-delivery-preflight.ts --provider d1 --database open-seo
```

Run it against production before `pnpm db:migrate:prod` or `pnpm db:migrate:pg`.
If it reports orphaned legacy rows, clean those up before any migration adds
constraints to them.

## Verifying a deployment

Two different paths reach an inbox, and they have different rules. Do not use
one to prove the other works.

1. Open a project's Reports page and generate a report.
2. **Manual "send test" (requester path).** Send a test copy of the run to
   yourself. This is allowed for your own verified account address in every
   environment, whether or not that address is in `REPORT_TEST_RECIPIENTS`. It
   proves the renderer, Resend credentials and template work. It proves nothing
   about the scheduled path.
3. Confirm the PDF and share link appear on the run, and open the share URL in a
   private window.
4. **Scheduled smoke test (allowlist path).** A profile's own delivery ignores
   who asked for it: while test mode is on, only addresses listed in
   `REPORT_TEST_RECIPIENTS` are mailed, and every other recipient is recorded as
   `skipped`. So to smoke-test a profile end to end, add your address to
   `REPORT_TEST_RECIPIENTS` **and** to the profile's recipients, then let the
   schedule fire (or claim it manually). A profile whose only recipient is an
   un-allowlisted address — including your own — mails nobody and reports
   `skipped`, which is the fail-closed design working, not a bug. The Reports
   page shows a persistent warning with the test-mode state and how many profile
   recipients are held back.
5. Only after both paths are green, set `REPORT_DELIVERY_TEST_MODE=false` and
   add client addresses. Never point the first provider test at a client
   inbox — and note that the unit tests mock the network and never send mail.
