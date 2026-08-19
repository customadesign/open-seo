# Enhanced site audit

Updated 2026-08-13. This document defines how OpenSEO's site audit should exceed the useful parts of SEMrush Site Audit without copying its volume-driven health score or treating shallow AI-readiness proxies as proof of AI visibility.

## Product position

OpenSEO should answer four questions in order:

1. Can search and answer engines reliably retrieve and index the site?
2. What is broken, and what should the team fix first?
3. Does each important page make its topic, answer, entity, evidence, and ownership clear?
4. Did the fixes improve search performance and AI citations over time?

The crawl audit supplies evidence for the first three questions. Search Console, Analytics, rank tracking, and AI citation monitoring supply outcome evidence for the fourth. A crawl alone must never claim that a page will rank or be cited.

## Live SEMrush comparison

A live account review on 2026-08-13 found that SEMrush now includes an AI Search Health beta alongside its established technical themes: crawlability, HTTPS, international SEO, performance, internal linking, markup, and Core Web Vitals. Its issue workflow, affected-page drill-down, and historical comparisons remain useful patterns.

The AI Search portion was much narrower. The reviewed project exposed four AI-oriented issue types: pages with only one incoming link, non-descriptive anchors, empty anchors, and generic content optimization guidance. That is useful hygiene, but it is not a complete AEO or GEO audit and does not measure whether answer engines can retrieve, understand, trust, or cite the content.

## Foundation delivered

The enhanced OpenSEO audit adds eighteen deterministic issue checks across these areas:

- Technical and indexability: HTTPS, viewport configuration, mixed content, HTML language, and self-canonical coverage.
- Structured data: invalid JSON-LD, missing homepage entity schema, and missing article schema on editorial pages.
- Search presentation and answer structure: incomplete Open Graph data, generic or empty link anchors, and long-form pages with weak question/list/table structure.
- Trust and citation readiness: missing author attribution, freshness signals, and cited external sources on long-form editorial content.
- Search and AI retrieval: separate robots.txt findings for conventional search crawlers and named AI search/retrieval crawlers, plus an informational check for `/llms.txt`.

The AI access check intentionally evaluates search/retrieval agents, such as OAI-SearchBot, ChatGPT-User, PerplexityBot, and Claude-SearchBot. Training-only crawler policy is separate; choosing to block model training must not be reported as an SEO failure. Likewise, `/llms.txt` remains optional and non-standard, so its absence is Monitor-only and must not reduce a score.

Every known issue now carries:

- a fix order: Fix now, Fix next, Improve, or Monitor;
- severity, category, likely impact, and estimated effort;
- a plain-language explanation and remediation;
- a verification instruction;
- affected URLs and captured evidence.

The interface, CSV/Google Sheets/JSON exports, and MCP responses use the same shared guidance. Items are ordered by fix urgency, impact, effort, and affected-page count instead of raw warning volume.

## Scoring principles

Do not collapse crawlability, conventional SEO, AEO, and GEO into one unexplained percentage. If scorecards are added, publish the rule weights and keep these dimensions separate:

- Technical access and indexability
- Page and site architecture
- Content and answer readiness
- Entity, trust, and citation readiness
- Performance and user experience

A blocked homepage, accidental `noindex`, server failure, or broken internal link must outrank cosmetic metadata. Optional practices must never reduce a required-health score. A large site must not appear less healthy merely because it has more pages; normalize by affected eligible pages and show the underlying counts.

## Next implementation order

1. **Audit comparisons and regression queues.** Mark issues as new, persistent, and resolved between crawls, show the changed URLs, and let users focus on regressions first.
2. **Impact overlays from first-party data.** Use Search Console and Analytics to promote issues on pages with impressions, clicks, conversions, or recent losses. Keep the crawl finding and observed performance impact as separate evidence.
3. **Rendered-versus-source checks.** Detect client-rendered shells now; later offer an opt-in rendered crawl for verified sites so OpenSEO can identify content, links, canonicals, and schema missing from initial HTML.
4. **Deeper schema and international validation.** Validate type-specific required/recommended properties, entity IDs and relationships, hreflang reciprocity, language-region correctness, and canonical conflicts.
5. **Page-role expectations.** Classify home, service, location, product, article, and comparison pages, then apply relevant checks rather than identical thresholds to every URL.
6. **AEO/GEO evidence depth.** Check answer-first passages, question coverage, source quality, author/entity linkage, original evidence, and update history while clearly labeling heuristic findings.
7. **Outcome validation.** Connect the audit to OpenSEO prompt research and citation monitoring to show whether target questions produce mentions and citations before and after fixes. This is the evidence SEMrush's crawl-only AI score does not provide.
8. **Operational workflow.** Add ownership, status, due dates, waivers with reasons, CMS-specific fix playbooks, and direct links into OnePagePM work items.

## Known limits

- The cloud crawler inspects fetched HTML and does not currently render JavaScript.
- JSON-LD is checked for valid JSON and relevant types, not yet against the full Schema.org vocabulary or search-feature requirements.
- Author, freshness, structure, and cited-source findings are useful signals, not E-E-A-T scores or guarantees of inclusion in AI answers.
- Robots.txt accessibility does not prove that an AI provider will crawl, index, or cite a page.
- AI visibility must ultimately be tested with repeatable prompts and recorded citations, not inferred from page markup alone.
