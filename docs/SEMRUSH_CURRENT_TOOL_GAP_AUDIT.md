# Current SEMrush tool gap audit

Reviewed 2026-08-18 in the agency's signed-in SEMrush account. This records the
tools shown in the current SEO, AI SEO, and Traffic & Market interfaces and maps
them to OpenSEO. It is a product decision record, not a claim that OpenSEO
reproduces every SEMrush dataset.

Live surfaces reviewed:

- [SEO Toolkit and Keyword Gap](https://www.semrush.com/analytics/keywordgap/)
- [Site Audit](https://www.semrush.com/siteaudit/)
- [AI SEO](https://www.semrush.com/ai-seo/overview/)
- [Traffic & Market](https://www.semrush.com/analytics/traffic/)

The current Site Audit project list includes a separate **AI Search Health**
column alongside Site Health, crawlability, performance, internal linking,
markup, and Core Web Vitals. OpenSEO already checks a wider set of deterministic
AI retrieval, answer structure, entity, schema, trust, and citation-readiness
signals. See [the enhanced audit specification](./ENHANCED_SITE_AUDIT.md). It
should keep those findings explainable rather than copy SEMrush's opaque score.

## Decision

The replacement work covers the core product surfaces: Google and Bing rank
tracking, technical and AI-oriented site audits, first-party GSC and GA4 data,
geo-grid tracking, stateful AI prompt observations, reviewed disavow records,
and scheduled branded reports. Four controls still matter more than adding
another research screen:

1. Bound scheduled rank spend. Delivered: product-created configurations now
   start on a manual cadence, every recurring cadence requires a positive
   per-run credit ceiling, and the scheduler rechecks its estimate before any
   paid post. Migrated rows without a ceiling skip with `cost_ceiling`.
2. Schedule site audits. Delivered: a project-scoped audit schedule that the
   cron claims and starts through the existing audit workflow, so report
   collection finds an audit completed inside the reporting period. It is
   paused with a manual cadence until an operator arms it, and it refuses to
   start while that project already has an audit running.
3. Put the existing GSC-plus-GA4 search-opportunity score in the product UI and
   use it to prioritize audit findings and cannibalization work.
4. Add AI visibility and local geo-grid sections to scheduled reports. Both are
   collected, but neither is currently an available report section.

After those controls, the most useful additions are a prompt-level AI
competitor/source gap over stored observations; a combined keyword and backlink
gap workspace; an own-site AI referral and conversion report from GA4; and,
only after recurring cost is bounded, aligned competitor position tracking.
Keyword and backlink intersections require new DataForSEO endpoint wrappers or
multi-domain fan-out, metering, and cost approval. They are not a zero-cost
reuse of the current domain and backlink screens.

Traffic & Market is different. Its competitor traffic estimates, demographics,
audience overlap, channel estimates, and market benchmarks rely on SEMrush's
proprietary clickstream and modeling. OpenSEO cannot recreate those datasets
from GA4, GSC, or DataForSEO. If the agency uses them in a client deliverable,
keep or replace that product as a separate market-intelligence decision. It is
not an OpenSEO engineering gap.

## SEO catalog

| Current SEMrush tool                   | OpenSEO coverage                                                                                                                                                            | Decision before cancellation                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                              | Project dashboard exists                                                                                                                                                    | Covered                                                                                                                     |
| Site Audit, including AI Search Health | Technical, schema, performance, internal-link, crawler-access, answer, trust, citation-readiness, and crawl-comparison checks exist                                         | Recurring audit starts exist and default paused; add impact overlays before relying on report automation                    |
| Position Tracking                      | Google and Bing tracking with device, depth, snapshot history, manual-run estimate approval, and a fail-closed recurring ceiling; new product-created configs start manual and migrated rows without a ceiling skip | Covered for owned-domain tracking; competitor alignment remains a later gap                                                   |
| Domain Overview                        | Point-in-time domain metrics, ranked keywords, pages, recent searches, and filters exist; backlink totals and metric history are not part of the overview                   | Covered for current research, with those limits made explicit                                                               |
| Organic Rankings                       | Ranked-keyword tables and filters exist                                                                                                                                     | Covered                                                                                                                     |
| Top Pages                              | Domain pages and backlink top pages exist                                                                                                                                   | Covered                                                                                                                     |
| Compare Domains                        | Agent-assisted competitor analysis exists; no persistent multi-domain comparison screen                                                                                     | Useful as part of the competitor gap workspace                                                                              |
| Keyword Gap                            | Underlying domain-keyword data exists; no native intersection and missing-keyword screen                                                                                    | Highest-value remaining native SEO view                                                                                     |
| Backlink Gap                           | Backlink and referring-domain data exists; no multi-domain intersection screen                                                                                              | Build with Keyword Gap as one competitor workspace                                                                          |
| Keyword Overview                       | Search volume, difficulty, intent, SERP and related data exist                                                                                                              | Covered                                                                                                                     |
| Keyword Magic Tool                     | Keyword discovery, related terms, filters, and saved terms exist; there is no native questions view or clustering screen                                                    | Covered for basic research; use the keyword-clustering agent workflow                                                       |
| Keyword Strategy Builder               | Saved keywords and agent clustering exist                                                                                                                                   | Covered for agency workflows; native visual clusters are optional                                                           |
| SEO Writing Assistant                  | SEO and AI content skills can review drafts                                                                                                                                 | Do not build a separate editor unless a client workflow requires it                                                         |
| Topic Research                         | Keyword, competitor, prompt, and content-strategy workflows exist                                                                                                           | Covered through research and agents                                                                                         |
| SEO Content Template                   | Agent workflows can create page briefs from keywords and SERPs                                                                                                              | Covered through agents                                                                                                      |
| Backlinks                              | Backlink tables, filters, exports, history, pages, and domain ratings exist                                                                                                 | Covered                                                                                                                     |
| Referring Domains                      | Referring-domain analysis exists                                                                                                                                            | Covered                                                                                                                     |
| Backlink Audit                         | Reviewed registry, SEMrush CSV import, Google TXT import/export, comments, status, and export timestamps exist; there is no per-entry event history                         | Covered without invented toxicity scoring or Google submission                                                              |
| Sensor                                 | No search-volatility index                                                                                                                                                  | Do not build; use observed project rankings and GSC changes                                                                 |
| SEOquake                               | No browser extension                                                                                                                                                        | Do not build for cancellation                                                                                               |
| Semrush Rank                           | No proprietary cross-domain rank                                                                                                                                            | Do not build                                                                                                                |
| On Page SEO Checker                    | Audits and content skills exist; no keyword-to-page recommendation queue                                                                                                    | Fold useful parts into GSC impact and cannibalization work                                                                  |
| Organic Traffic Insights               | A service and MCP tool already join GSC pages to GA4 landing pages and score opportunities; there is no product UI                                                          | Expose the existing queue as the first-party impact view                                                                    |
| Link Building                          | Link prospecting exists through search, backlink evidence, and agents; no outreach mailbox                                                                                  | Keep outreach in the agency CRM                                                                                             |
| Log File Analyzer                      | No raw server-log analysis module                                                                                                                                           | Build only if verified client access and a recurring diagnostic need exist                                                  |

## AI SEO catalog

| Current SEMrush tool | OpenSEO coverage                                                                                                                                   | Decision before cancellation                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Visibility Overview  | Provider-specific prompts, runs, mentions, citations, outcomes, models, raw evidence, and cost are stored                                          | Covered without claiming SEMrush score parity                                                   |
| Competitor Research  | Brand Lookup already shows aggregate share of voice and cited sources; stored prompt observations do not yet expose a target-versus-competitor gap | Add the narrower evidence-level gap after representative prompt costs are approved              |
| Prompt Research      | Prompt Explorer and research agents exist; OpenSEO does not own SEMrush's trending prompt corpus                                                   | Keep external discovery optional; do not invent volume                                          |
| Brand Performance    | Mention and citation history exists by tracked prompt and provider                                                                                 | Covered at the evidence level                                                                   |
| Perception           | No aggregate sentiment score                                                                                                                       | Optional later analysis over stored evidence; require visible source excerpts and cost approval |
| Narrative Drivers    | Raw answers and citations are preserved, but no theme aggregation exists                                                                           | Optional later analysis over stored evidence                                                    |
| Questions            | Prompts are first-class records with a 50-prompt configuration limit                                                                               | Covered for selected prompt sets                                                                |
| AI Site Audit        | Enhanced audit checks crawler access, answer structure, schema, entity and trust signals                                                           | Covered with explicit rules                                                                     |
| Prompt Tracking      | Scheduled ChatGPT Search, Gemini, and Google AI Mode runs exist and default inactive                                                               | Covered after cost profiling and parallel validation                                            |
| Content Creation     | Content skills exist; OpenSEO has no general-purpose AI writing product                                                                            | Do not build for cancellation                                                                   |

SEMrush's proprietary prompt corpus, visibility score, estimated AI search
volume, and cross-customer benchmarks cannot be reconstructed from the evidence
available to OpenSEO. The replacement should show the prompt, answer, citation,
provider, timestamp, and cost so a user can audit each conclusion.

## Traffic & Market catalog

The current interface includes Traffic Analytics, Market Overview, Top Pages,
Competitor Monitoring, AI Traffic, Referral, Organic Search, Paid Search,
Organic Social, Paid Social, Email, Display Ads, Sources & Destinations,
Subfolders & Subdomains, Funnel Analysis, Page Groups, USA and global regional
views, Demographics, Audience Overlap, Socioeconomics, Behavior, Daily Trends,
Industry & Bulk Analysis, Trends API, and Trending Websites.

| Data class                                                                               | What OpenSEO can cover                                           | Decision                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The connected site's traffic, landing pages, channels, regions, funnels, and conversions | GA4 can provide first-party observations with the site's consent | Expand only where it improves SEO decisions                               |
| The connected site's search queries, pages, countries, devices, clicks, and impressions  | GSC already provides first-party search data                     | Covered                                                                   |
| AI referral sessions and conversions on the connected site                               | GA4 can identify referrers and landing-page outcomes             | Add the focused AI referral report                                        |
| Competitor visits, engagement, channels, journeys, and pages                             | Requires third-party clickstream estimates                       | External market-intelligence dependency                                   |
| Market size, share, growth, country and industry benchmarks                              | Requires SEMrush's modeled dataset                               | External market-intelligence dependency                                   |
| Demographics, socioeconomic traits, behavior, and audience overlap                       | Requires proprietary panels and modeling                         | External market-intelligence dependency                                   |
| Competitor traffic alerts and bulk trends                                                | Requires the same proprietary dataset                            | Keep SEMrush Traffic & Market or choose another provider if actively used |

## Cancellation check

Do not use the size of SEMrush's sidebar as the parity test. Confirm the actual
agency workflows:

- Archive every active SEMrush project and manually export the datasets the API
  archive does not preserve.
- Complete one parallel cycle for ranks, audits, AI evidence, geo-grids, and
  reporting.
- Keep every recurring rank and AI schedule stopped until its provider costs
  are measured and an enforceable per-run ceiling is approved.
- Verify that a fresh scheduled audit feeds the audit section and that AI/local
  evidence reaches the intended report before relying on unattended delivery.
- Confirm whether anyone currently sells Traffic & Market estimates,
  demographics, or audience overlap. Assign that dependency to a separate tool
  owner if the answer is yes.
- Approve deployment, recurring paid work, client email, and subscription
  cancellation as separate actions.

The operational gates and evidence requirements remain in
[the cutover runbook](./SEMRUSH_CUTOVER.md).
