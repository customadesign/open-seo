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

The executive summary is always present. Other sections can be disabled or reordered. A source that is not connected is omitted. A connected source that returns no activity shows zero activity where the API supports it. If a configured source fails, the new run fails and the previous published report remains available.

## Publication workflow

Each report run saves an immutable versioned JSON snapshot and its commentary. The scheduler claims a due monthly instant with a compare-and-set update, creates one run for that instant, and starts a Cloudflare Workflow. The scheduled key prevents duplicate publication.

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
