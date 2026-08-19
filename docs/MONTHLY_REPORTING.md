# Monthly reporting

OpenSEO publishes client-facing monthly reports from the data already connected to a project. Reports are available inside the application. Version 1 does not send email, create PDFs, or expose public share links.

## Access

- Workspace owners and employees can configure, generate, retry, and edit reports for projects they can access.
- Clients can only read published reports for projects assigned to them.
- Only workspace owners can connect or change Google integrations.

Authorization is enforced by the server functions. Hiding controls in the interface is not the security boundary.

## Default report

The default period is the previous full calendar month. It is compared with the full calendar month immediately before it. Automatic reports run on the fourth day of each month at 9:00 AM in the configured timezone.

The section order is:

1. Executive summary
2. Keyword rankings
3. Google Search Console
4. Google Analytics
5. Google Ads
6. Site audit
7. Backlinks
8. AI visibility
9. Local map rankings

The executive summary is always present. Other sections can be disabled or reordered. A source that is not connected is omitted. A connected source that returns no activity shows zero activity where the API supports it. If a configured source fails, the new run fails and the previous published report remains available.

A profile or project saved before a section shipped has no stored row for it. The missing section comes back disabled, so a report already going to a client never gains a section without an operator enabling it.

### Stored-data sections

AI visibility and local map rankings are built only from observations and runs the project already collected and paid for. Generating, delivering or sharing a report never calls a provider, never starts a run and never arms a paused schedule.

Each of these sections reports the newest completed run at or before the period end, which can be older than the period itself. That is stated rather than hidden: every entry carries its capture date, and data that finished before the period began is labelled as predating the report in the web view, the PDF and the emailed summary. A tracked brand or grid with no usable completed run is listed under "no data for this period" with the reason, instead of being reported as zero.

Two counting rules keep the figures honest:

- A prompt no provider answered is `unavailable`. It is reported next to the answered share, never inside its denominator, because a provider outage is not evidence the brand went unmentioned. There is deliberately no composite AI visibility score.
- A grid point that returned no result stays unranked. It is never folded in as position zero, so average rank and coverage describe only the points that actually returned the business.

## Publication workflow

Each report run saves an immutable versioned JSON snapshot and its commentary. The scheduler claims a due monthly instant with a compare-and-set update, creates one run for that instant, and starts a Cloudflare Workflow. The scheduled key prevents duplicate publication. Hosted schedules can use credit-metered AI commentary. Docker self-hosted schedules fail closed to deterministic evidence commentary so enabling a monthly report cannot create recurring OpenRouter spend; an explicit manual report can still use the configured provider.

The workflow reads each enabled source, validates the complete snapshot, creates evidence-bound commentary, then publishes the run. AI commentary uses only the saved evidence. If the AI provider is unavailable or returns invalid output, OpenSEO publishes a deterministic summary instead. Staff can edit commentary after publication without changing the underlying metrics.

## Data sources

- Rankings use the most recent completed keyword snapshot on or before each period end.
- Search Console includes clicks, impressions, click-through rate, average position, top queries, top pages, and striking-distance queries.
- Analytics includes organic sessions, users, key events, revenue, and top landing pages.
- Google Ads includes spend, impressions, clicks, conversions, conversion value, cost per conversion, return on ad spend, daily movement, and campaign results.
- Site audit uses the most recent completed crawl on or before the period end.
- Backlinks use the most recent stored profile snapshot on or before the period end.

## Moving away from SEMrush

Keep SEMrush active through at least one complete parallel monthly cycle. Compare keyword coverage, report totals, connected-source permissions, and client readability before approving cancellation. OpenSEO's report snapshot should be treated as the replacement only after that review is complete.
