/* eslint-disable max-lines -- issue guidance is a single shared data registry used by the UI, exports, and MCP */
/**
 * Registry of site-audit issue types.
 *
 * Shared between the server (issue engine, MCP tools) and the client
 * (issues UI, CSV export). Each issue row in `audit_issues` references one
 * of these types by id.
 */

export type IssueSeverity = "critical" | "warning" | "info";
export type AuditIssueCategory =
  | "crawlability"
  | "indexability"
  | "technical"
  | "on-page"
  | "content"
  | "architecture"
  | "performance"
  | "structured-data"
  | "aeo"
  | "geo";
export type AuditFixOrder = "now" | "next" | "improve" | "monitor";
export type AuditIssueImpact = "high" | "medium" | "low";
export type AuditIssueEffort = "small" | "medium" | "large";

interface BaseAuditIssueDescriptor {
  severity: IssueSeverity;
  title: string;
  explanation: string;
  howToFix: string;
}

interface AuditIssueDescriptor extends BaseAuditIssueDescriptor {
  category: AuditIssueCategory;
  fixOrder: AuditFixOrder;
  impact: AuditIssueImpact;
  effort: AuditIssueEffort;
  howToVerify: string;
}

export const AUDIT_ISSUE_TYPES = {
  "blocked-page": {
    severity: "critical",
    title: "Crawler was blocked",
    explanation:
      "The site returned a bot challenge or access denial (e.g. a Cloudflare challenge, 403, or 429) instead of the page. We report this honestly rather than pretending the page is broken — but it means this page could not be audited, and other crawlers like search engines may face similar friction.",
    howToFix:
      'If you own this site, allowlist the "OpenSEO-Audit" user agent in your WAF/bot-protection settings (on Cloudflare: a WAF custom rule that skips bot protection when the user agent contains "OpenSEO-Audit"; on some free tiers you may need to relax bot protection). Then re-run the audit.',
  },
  "server-error": {
    severity: "critical",
    title: "Server error (5xx)",
    explanation:
      "The page returned a 5xx server error. Search engines that repeatedly see server errors will crawl the site less and may drop the page from the index.",
    howToFix:
      "Check the server logs for this URL and fix the underlying error. If the page is gone, return a 404/410 or redirect it to a relevant page instead of erroring.",
  },
  "broken-internal-link": {
    severity: "critical",
    title: "Broken internal link",
    explanation:
      "This page links to an internal URL that returns an error status (4xx/5xx). Broken links waste crawl budget, leak link equity, and frustrate users — they are among the most common and most damaging technical SEO issues.",
    howToFix:
      "Update the link to point at the correct live URL, or remove it. If the target was moved, prefer linking directly to the new URL rather than relying on a redirect.",
  },
  "missing-title": {
    severity: "critical",
    title: "Missing title tag",
    explanation:
      "The page has no <title>. The title is the strongest on-page relevance signal and the headline shown in search results; without it search engines generate one themselves, usually badly.",
    howToFix:
      "Add a unique, descriptive <title> of roughly 50–60 characters that includes the page's primary topic.",
  },
  "broken-page": {
    severity: "warning",
    title: "Page returns an error (4xx)",
    explanation:
      "This crawled URL returned a client error (e.g. 404). If it is referenced from your sitemap or other pages, crawlers keep wasting requests on it.",
    howToFix:
      "If the page should exist, restore it. If it is intentionally gone, remove it from the sitemap and internal links, and consider a 301 redirect to the closest live page.",
  },
  "duplicate-title": {
    severity: "warning",
    title: "Duplicate title",
    explanation:
      "Multiple pages share the same title tag. Search engines use titles to differentiate pages; duplicates make pages compete with each other and depress click-through rates.",
    howToFix:
      "Write a unique title for each page describing its specific content. For templated pages, include the distinguishing attribute (name, category, location) in the template.",
  },
  "duplicate-meta-description": {
    severity: "warning",
    title: "Duplicate meta description",
    explanation:
      "Multiple pages share the same meta description, so search results show identical snippets and users cannot tell the pages apart.",
    howToFix:
      "Write a unique meta description per page, or remove the duplicated one entirely — search engines will generate a snippet from page content, which beats a wrong duplicate.",
  },
  "duplicate-content": {
    severity: "warning",
    title: "Duplicate page content",
    explanation:
      "Two or more URLs serve byte-identical visible text. Search engines pick one version to index and ignore the rest, and ranking signals get split across the duplicates.",
    howToFix:
      "Consolidate duplicates: pick the canonical URL, add rel=canonical from the others, and 301-redirect duplicate URLs where possible (common causes: trailing-slash variants, URL parameters, http/https or www variants).",
  },
  "missing-meta-description": {
    severity: "warning",
    title: "Missing meta description",
    explanation:
      "The page has no meta description. Search engines will assemble a snippet from page text, which is often less compelling and hurts click-through rate.",
    howToFix:
      "Add a meta description of roughly 70–160 characters that summarizes the page and gives a reason to click.",
  },
  "missing-h1": {
    severity: "warning",
    title: "Missing H1 heading",
    explanation:
      "The page has no H1. The H1 tells users and search engines what the page is about; pages without one tend to have weaker topical clarity.",
    howToFix:
      "Add a single H1 that states the page's main topic, consistent with the title tag.",
  },
  "multiple-h1": {
    severity: "warning",
    title: "Multiple H1 headings",
    explanation:
      "The page has more than one H1, which dilutes the main-topic signal and usually indicates a templating mistake (e.g. a logo and a headline both marked up as H1).",
    howToFix:
      "Keep one H1 for the page's main heading and demote the others to H2/H3 (or unstyled elements for non-headings like logos).",
  },
  "redirect-chain": {
    severity: "warning",
    title: "Redirect chain",
    explanation:
      "Reaching the final page requires two or more consecutive redirects. Each hop adds latency, leaks link equity, and burns crawl budget; long chains may not be followed at all.",
    howToFix:
      "Point the first URL (and any internal links) directly at the final destination so there is at most one redirect.",
  },
  "redirect-loop": {
    severity: "warning",
    title: "Redirect loop",
    explanation:
      "This redirect eventually points back to itself, so the URL never resolves. Browsers and crawlers give up with an error.",
    howToFix:
      "Trace the redirect rules for this URL and break the cycle so the chain terminates at a real 200 page.",
  },
  "canonical-conflict": {
    severity: "warning",
    title: "Conflicting canonical signals",
    explanation:
      "The page declares different canonical URLs in its HTML <link rel=canonical> and its HTTP Link header. When signals conflict, search engines ignore both and choose their own canonical.",
    howToFix:
      "Pick one canonical URL and declare it in exactly one place (HTML head is the most common); remove or align the other declaration.",
  },
  "thin-content": {
    severity: "warning",
    title: "Thin content",
    explanation:
      "The page has very little visible text. Thin pages rarely rank, can drag down sitewide quality assessments, and (if the site renders client-side) may indicate content invisible to plain-HTML crawlers.",
    howToFix:
      "Either expand the page with genuinely useful content, noindex it, or consolidate it into a stronger page. If the content exists but is rendered by JavaScript, ensure it is server-rendered or pre-rendered.",
  },
  "images-missing-alt": {
    severity: "warning",
    title: "Images missing alt text",
    explanation:
      "One or more images on the page lack alt attributes. Alt text is an accessibility requirement and the main way search engines understand images.",
    howToFix:
      'Add descriptive alt text to meaningful images; use an empty alt (alt="") only for purely decorative ones.',
  },
  "orphan-page": {
    severity: "warning",
    title: "Orphan page",
    explanation:
      "No crawled page links to this URL — it was only discoverable via the sitemap. Pages without internal links receive little crawl attention and no internal link equity, and users can't find them by browsing.",
    howToFix:
      "Link to this page from relevant pages (navigation, related content, hub pages), or remove it from the sitemap if it shouldn't be indexed.",
  },
  "no-outgoing-links": {
    severity: "warning",
    title: "Page has no outgoing links",
    explanation:
      "The page contains no links at all — a dead end. Link equity that flows into it stops there, crawlers have nowhere to go next, and users have to reach for the back button.",
    howToFix:
      "Add links to related pages, the parent category, or the homepage. If the page's navigation is rendered by JavaScript, make sure it also exists in the server-rendered HTML.",
  },
  "title-too-long": {
    severity: "info",
    title: "Title too long",
    explanation:
      "The title exceeds ~60 characters, so search results will truncate it and the ending may be cut off mid-phrase.",
    howToFix:
      "Shorten the title to roughly 50–60 characters, front-loading the most important words.",
  },
  "title-too-short": {
    severity: "info",
    title: "Title too short",
    explanation:
      "The title is under ~10 characters, which is usually too generic to describe the page or attract clicks.",
    howToFix:
      "Expand the title into a descriptive phrase (roughly 30–60 characters) that states what the page offers.",
  },
  "meta-description-too-long": {
    severity: "info",
    title: "Meta description too long",
    explanation:
      "The meta description exceeds ~160 characters, so search engines will truncate the snippet.",
    howToFix:
      "Trim the description to roughly 70–160 characters while keeping the core message and call to action.",
  },
  "meta-description-too-short": {
    severity: "info",
    title: "Meta description too short",
    explanation:
      "The meta description is under ~70 characters. Short descriptions waste the snippet space search results give you, and search engines often ignore them in favor of text pulled from the page.",
    howToFix:
      "Expand the description to roughly 70–160 characters that summarize the page and give a reason to click.",
  },
  "heading-order-skip": {
    severity: "info",
    title: "Heading levels skip",
    explanation:
      "The heading hierarchy skips levels (e.g. an H4 directly after an H2). This weakens document structure for accessibility tools and content parsing.",
    howToFix:
      "Adjust heading levels so they descend one step at a time (H1 → H2 → H3) without skipping.",
  },
  "slow-response": {
    severity: "info",
    title: "Slow server response",
    explanation:
      "The HTML response took over 1.5 seconds. Slow time-to-first-byte drags down every downstream performance metric and reduces crawl rate on large sites.",
    howToFix:
      "Investigate server/database time and caching for this route; serving cached or statically generated HTML usually fixes it.",
  },
  "noindex-page": {
    severity: "info",
    title: "Page is noindex",
    explanation:
      "The page asks search engines not to index it (via robots meta tag or X-Robots-Tag header). That's often intentional — this is a heads-up, not an error.",
    howToFix:
      "If this page should rank, remove the noindex directive. If it's intentional (admin, thank-you, filter pages), no action is needed.",
  },
  "canonicalized-page": {
    severity: "info",
    title: "Canonicalized to another URL",
    explanation:
      "The page declares a different URL as its canonical, telling search engines to index that URL instead. Fine when intentional (parameter pages, syndication) — a problem if this page was meant to rank.",
    howToFix:
      "If this page should rank on its own, set its canonical to itself. Otherwise no action is needed.",
  },
  "deep-page": {
    severity: "info",
    title: "Page is deep in the site structure",
    explanation:
      "The page is 5+ clicks from the homepage. Deep pages get crawled less often and receive less link equity.",
    howToFix:
      "Add links from higher-level pages (hubs, category pages, navigation) to flatten the path to this page.",
  },
  "non-https-page": {
    severity: "critical",
    title: "Page is not served over HTTPS",
    explanation:
      "Search engines and browsers treat HTTP pages as insecure. HTTP versions also split canonical signals unless every request immediately redirects to the HTTPS equivalent.",
    howToFix:
      "Install a valid TLS certificate, redirect every HTTP URL directly to its HTTPS equivalent with one permanent redirect, and update internal links, canonicals, and sitemaps to HTTPS.",
  },
  "missing-viewport": {
    severity: "warning",
    title: "Mobile viewport is missing",
    explanation:
      "Without a viewport declaration, mobile browsers can render the page at desktop width. That harms mobile usability and makes the page a poor fit for mobile-first indexing.",
    howToFix:
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> in the document head and verify that the layout has no horizontal overflow on a phone-sized viewport.',
  },
  "mixed-content": {
    severity: "warning",
    title: "HTTPS page loads insecure resources",
    explanation:
      "An HTTPS document references HTTP images, scripts, styles, or links. Browsers may block active resources, and insecure asset URLs weaken trust and can create duplicate crawl paths.",
    howToFix:
      "Serve each referenced resource over HTTPS and update the source URL. Do not hide the warning with a browser policy until the underlying URLs have been corrected.",
  },
  "missing-self-canonical": {
    severity: "info",
    title: "Indexable page has no self-referencing canonical",
    explanation:
      "A self-referencing canonical is not mandatory, but it makes the preferred URL explicit and helps consolidate accidental parameter, case, and tracking variants.",
    howToFix:
      "Add one absolute rel=canonical that resolves to this page's preferred indexable URL. Keep it aligned with redirects, internal links, and the sitemap.",
  },
  "invalid-json-ld": {
    severity: "warning",
    title: "JSON-LD cannot be parsed",
    explanation:
      "One or more structured-data blocks are invalid JSON. Search and answer engines cannot reliably extract entities, authors, dates, products, or business details from a malformed block.",
    howToFix:
      "Correct the JSON syntax, then validate the rendered page with Schema.org Validator and Google's Rich Results Test. Keep the markup consistent with visible page content.",
  },
  "missing-entity-schema": {
    severity: "info",
    title: "Homepage lacks organization entity schema",
    explanation:
      "The homepage does not identify the primary Organization or LocalBusiness entity in JSON-LD. Explicit entity markup helps search and answer engines connect the brand, website, logo, contact details, and profiles.",
    howToFix:
      "Add one accurate Organization or appropriate LocalBusiness subtype on the homepage with name, URL, logo, contact details, address when applicable, and verified sameAs profiles.",
  },
  "missing-article-schema": {
    severity: "info",
    title: "Editorial page lacks Article schema",
    explanation:
      "This appears to be a substantial article or guide but does not expose Article, BlogPosting, or NewsArticle markup for its headline, author, dates, and publisher.",
    howToFix:
      "Add the most specific Article subtype that matches the visible page. Include headline, author, datePublished, dateModified, publisher, image, and mainEntityOfPage without inventing data.",
  },
  "missing-html-lang": {
    severity: "info",
    title: "Document language is not declared",
    explanation:
      "The HTML element has no lang attribute. Language declaration helps accessibility tools and gives parsers a reliable language signal for pronunciation and interpretation.",
    howToFix:
      'Set the page language on the root element, for example <html lang="en"> or the correct language-region code.',
  },
  "incomplete-open-graph": {
    severity: "info",
    title: "Open Graph metadata is incomplete",
    explanation:
      "The page is missing one or more core sharing fields. Weak previews reduce click-through when people or AI assistants surface and share the URL.",
    howToFix:
      "Add accurate og:title, og:description, and og:image values. Use a crawlable absolute image URL and keep the text aligned with the visible page.",
  },
  "generic-link-anchor": {
    severity: "info",
    title: "Links use non-descriptive anchor text",
    explanation:
      'Anchors such as "click here" or "learn more" hide the destination topic from users, search engines, and answer engines that use link context to understand relationships.',
    howToFix:
      "Replace generic anchors with short destination-specific wording. Keep the link natural in its sentence and avoid repeating exact-match commercial phrases everywhere.",
  },
  "empty-link-anchor": {
    severity: "warning",
    title: "Links have no accessible anchor text",
    explanation:
      "A link without text or an image alt label gives users and crawlers no reliable description of its destination.",
    howToFix:
      "Add meaningful visible anchor text or, for a linked image, descriptive alt text. Use an accessible label only when visible wording is impractical.",
  },
  "weak-answer-structure": {
    severity: "info",
    title: "Long-form content is difficult to extract",
    explanation:
      "This substantial editorial page has no question-led headings, lists, or tables. It may read well as prose but offers few self-contained blocks that answer engines can quote or summarize confidently.",
    howToFix:
      "Keep the useful prose, but add direct-answer sections where appropriate: descriptive question headings, concise opening answers, numbered steps, comparison tables, or clearly labeled definitions.",
  },
  "missing-author-attribution": {
    severity: "info",
    title: "Editorial content lacks clear author attribution",
    explanation:
      "A substantial article or guide has no detectable author signal. Named, qualified authors improve accountability and make expertise easier for users and answer engines to evaluate.",
    howToFix:
      "Show the author's name and relevant credentials on the page, link to a useful author profile, and align the visible attribution with Article JSON-LD.",
  },
  "missing-freshness-signal": {
    severity: "info",
    title: "Editorial content has no published or updated date",
    explanation:
      "The page has no detectable publication or modification date. Users and answer engines cannot tell whether time-sensitive claims are current.",
    howToFix:
      "Display an honest published date and, after a substantive review, a last-updated date. Mirror those values in Article JSON-LD; do not refresh dates without updating the content.",
  },
  "no-cited-sources": {
    severity: "info",
    title: "Long-form content cites no external sources",
    explanation:
      "This substantial editorial page contains no detectable external source links. Unsupported claims are harder to verify and less attractive for answer engines to cite.",
    howToFix:
      "Link important factual claims, statistics, and quotations to their original authoritative sources. Add original evidence or expert attribution where the insight is your own.",
  },
  "ai-search-crawler-blocked": {
    severity: "warning",
    title: "AI search crawlers are blocked",
    explanation:
      "robots.txt blocks one or more crawlers used to discover or retrieve pages for AI-assisted search. This can prevent those systems from finding or citing otherwise public content.",
    howToFix:
      "Review the named user agents and allow the search/retrieval crawlers you want to serve. Treat training-only crawlers as a separate policy decision; allowing AI search does not require allowing every training crawler.",
  },
  "search-crawler-blocked": {
    severity: "critical",
    title: "Search engine crawlers are blocked",
    explanation:
      "robots.txt blocks Googlebot or bingbot from the site root. This can prevent conventional search indexing as well as downstream AI experiences that depend on those search indexes.",
    howToFix:
      "Review robots.txt immediately and allow the named search crawler unless the block is intentional. Keep private or duplicate paths disallowed with narrow path rules instead of blocking the public site root.",
  },
  "missing-llms-txt": {
    severity: "info",
    title: "Optional llms.txt file is unavailable",
    explanation:
      "No usable /llms.txt file was found. This emerging convention can offer AI agents a concise map of important content, but it is not a standard ranking requirement and its absence is not an SEO failure.",
    howToFix:
      "Optional: publish a concise, factual /llms.txt that links to canonical public resources. Do not use it as a substitute for crawlable HTML, sound internal linking, sitemaps, or structured data.",
  },
  "sitemap-missing": {
    severity: "warning",
    title: "sitemap.xml was not found",
    explanation:
      "The default /sitemap.xml URL did not return a sitemap. Search engines can still discover pages by following links, but a sitemap is the most reliable way to declare the URLs you want crawled.",
    howToFix:
      "Publish a valid XML sitemap at /sitemap.xml (or a sitemap index that lists sharded sitemaps) and keep it updated as URLs change.",
  },
  "sitemap-not-in-robots": {
    severity: "info",
    title: "robots.txt does not reference a sitemap",
    explanation:
      "robots.txt has no Sitemap: directive. Crawlers that start at robots.txt will not be pointed at your sitemap unless they guess the default path.",
    howToFix:
      "Add a Sitemap: line to robots.txt with the absolute URL of your sitemap or sitemap index.",
  },
  "sitemap-invalid": {
    severity: "warning",
    title: "Sitemap XML is invalid",
    explanation:
      "A sitemap document could not be parsed as a urlset or sitemap index. Search engines ignore a broken sitemap, so the URLs in it are not submitted.",
    howToFix:
      "Validate the sitemap XML, ensure each entry has a <loc>, and serve it with an XML content type.",
  },
  "sitemap-too-large": {
    severity: "warning",
    title: "Sitemap exceeds the size limit",
    explanation:
      "A sitemap is larger than 50,000 URLs or 50 MB uncompressed. Search engines may stop reading it, leaving later URLs undiscovered.",
    howToFix:
      "Split the sitemap into shards under both limits and list those shards from a sitemap index.",
  },
  "sitemap-http-urls-on-https-site": {
    severity: "warning",
    title: "HTTPS site lists HTTP URLs in its sitemap",
    explanation:
      "The sitemap includes http:// URLs on an HTTPS site. Those entries split crawl signals and often bounce through a redirect before reaching the canonical page.",
    howToFix:
      "Rewrite every sitemap <loc> to its HTTPS URL and keep the sitemap itself on HTTPS.",
  },
  "robots-missing": {
    severity: "info",
    title: "robots.txt was not found",
    explanation:
      "No robots.txt was returned. That allows crawling by default, but it also means there is no place to declare a sitemap or path rules.",
    howToFix:
      "Publish a robots.txt at the site root. At minimum allow public pages and add a Sitemap: directive.",
  },
  "robots-invalid": {
    severity: "warning",
    title: "robots.txt has format errors",
    explanation:
      "robots.txt could not be parsed as a valid robots file (for example it returned HTML, or group rules appeared before any User-agent). Crawlers may ignore the file.",
    howToFix:
      "Serve a plain-text robots.txt whose records start with User-agent, use Field: value lines, and put Sitemap: on its own lines.",
  },
  "missing-doctype": {
    severity: "info",
    title: "Document is missing a doctype",
    explanation:
      "The HTML has no <!DOCTYPE>. Browsers may fall back to quirks mode, which can change layout and make the page harder for parsers to treat as a standards document.",
    howToFix: "Add <!DOCTYPE html> as the first line of every HTML document.",
  },
  "missing-charset": {
    severity: "warning",
    title: "Character encoding is not declared",
    explanation:
      "The page has no charset meta tag. Without an explicit encoding, browsers and crawlers may misread non-ASCII text in titles, snippets, and body copy.",
    howToFix:
      'Add <meta charset="utf-8"> in the document head (or declare charset on the Content-Type meta tag).',
  },
  "meta-refresh-present": {
    severity: "warning",
    title: "Page uses a meta refresh",
    explanation:
      "A meta refresh tells the browser to reload or redirect after a delay. Search engines treat this as a poor substitute for an HTTP redirect and it is a poor experience for users.",
    howToFix:
      "Remove the meta refresh. If the page has moved, use a single HTTP 301/302 to the destination instead.",
  },
  "page-has-frames": {
    severity: "warning",
    title: "Page uses frames or iframes",
    explanation:
      "Frames and iframes hide content from the parent document. Search engines may not associate framed content with this URL, and framesets are obsolete.",
    howToFix:
      "Render important content in the page itself. Keep iframes for genuine embeds (maps, videos) and do not put primary copy inside them.",
  },
  "html-size-too-large": {
    severity: "warning",
    title: "HTML document is larger than 2 MB",
    explanation:
      "The uncompressed HTML exceeds 2 MB. Large documents are slower to download and parse, and crawlers may truncate them before they reach the important content.",
    howToFix:
      "Reduce the HTML payload: drop unused markup, move large data out of the document, and paginate or lazy-load long lists.",
  },
  "low-text-to-html-ratio": {
    severity: "info",
    title: "Visible text is a small fraction of the HTML",
    explanation:
      "Less than 10% of the HTML is visible text. That often means the page is template-heavy or script-heavy, so crawlers see a lot of chrome and little content.",
    howToFix:
      "Increase useful visible copy, or reduce template/script/style bulk in the initial HTML so the main content is a larger share of the document.",
  },
  "url-too-long": {
    severity: "info",
    title: "URL is longer than 200 characters",
    explanation:
      "Very long URLs are harder to share, more likely to be truncated in reports, and often a sign of stacked parameters or unreadable path segments.",
    howToFix:
      "Shorten the path to a stable, readable slug and drop tracking or filter parameters from the canonical URL.",
  },
  "url-has-underscores": {
    severity: "info",
    title: "URL path contains underscores",
    explanation:
      "Hyphens are the conventional word separator in URLs. Underscores are treated as word characters, so /blue_widgets is harder for search engines to read as “blue widgets”.",
    howToFix:
      "Use hyphens in path segments (blue-widgets) and 301 the underscore URLs to the hyphenated versions.",
  },
  "url-too-many-parameters": {
    severity: "info",
    title: "URL has more than 3 query parameters",
    explanation:
      "URLs with many query parameters are often filters, sorts, or tracking variants. They explode crawl space and rarely deserve their own index entry.",
    howToFix:
      "Keep the public URL to the parameters that change the content. Move tracking to fragments or strip it with a self-canonical, and noindex leftover filter combinations.",
  },
  "noindex-via-x-robots-tag": {
    severity: "info",
    title: "X-Robots-Tag header is noindex",
    explanation:
      "The HTTP X-Robots-Tag header asks crawlers not to index this URL. This is separate from a robots meta tag in the HTML and is easy to miss when reviewing the page source.",
    howToFix:
      "If the page should be indexed, remove noindex from the X-Robots-Tag header. If the header is intentional, no action is needed.",
  },
  "page-not-compressed": {
    severity: "warning",
    title: "HTML is served uncompressed",
    explanation:
      "This HTML response was delivered uncompressed (Content-Encoding is identity, or the Content-Length matches the decoded HTML size). Uncompressed HTML wastes bandwidth and slows first-byte and parse time, especially on mobile. A missing Content-Encoding header alone is not enough to flag this — some runtimes strip that header after they decompress the body.",
    howToFix:
      "Enable gzip or Brotli compression for text responses on the origin or CDN, then confirm a browser or curl request receives Content-Encoding: gzip or br.",
  },
  "broken-external-link": {
    severity: "warning",
    title: "Broken external link",
    explanation:
      "This page links to an external URL that returned a 4xx or 5xx status. Broken outbound links waste user trust and are a quality signal crawlers notice on otherwise useful pages.",
    howToFix:
      "Update the href to a live destination, replace it with a closer equivalent, or remove the link if the resource is gone.",
  },
  "external-link-403": {
    severity: "info",
    title: "External link returns 403",
    explanation:
      "An outbound link returned HTTP 403 Forbidden. The destination may block unknown crawlers, require a login, or have been restricted. Users in a browser might still get through, but the target is not reliably public.",
    howToFix:
      "Confirm the destination is meant to be public. If it is, ask the owner to allowlist crawlers or switch to a public URL. If it is gated, link to a public page instead.",
  },
  "too-many-on-page-links": {
    severity: "warning",
    title: "Page has too many links",
    explanation:
      "The page has more than 3,000 distinct href targets. Extremely link-dense pages dilute anchor relevance, slow rendering, and are hard for users and crawlers to scan.",
    howToFix:
      "Keep the main navigation, then cut or paginate long link lists. Move archives, tag clouds, and related-item dumps onto dedicated index pages.",
  },
  "link-url-too-long": {
    severity: "info",
    title: "Link URL is longer than 2,000 characters",
    explanation:
      "An outgoing href is longer than 2,000 characters. Very long URLs break in some clients, get truncated in reports, and are usually stacked tracking or filter parameters.",
    howToFix:
      "Point the link at a short, stable URL. Move tracking into analytics events or strip it from the public href.",
  },
  "internal-nofollow-outgoing": {
    severity: "warning",
    title: "Internal link is marked nofollow",
    explanation:
      "This page uses rel=nofollow on an outgoing internal link. That tells crawlers not to follow a path you otherwise control, which wastes internal equity and can hide pages you want indexed.",
    howToFix:
      "Remove nofollow from internal links unless the destination is deliberately untrusted (user-generated URLs, login walls). Use noindex on the target if it should stay out of the index.",
  },
  "external-nofollow-outgoing": {
    severity: "info",
    title: "External link is marked nofollow",
    explanation:
      "This page uses rel=nofollow on an outgoing external link. That is often intentional for untrusted or paid destinations; it is listed so you can confirm the policy is deliberate.",
    howToFix:
      "Keep nofollow on user-generated, sponsored, or untrusted links. Remove it from citations and partner links you want crawlers to treat as a normal reference.",
  },
  "resource-as-page-link": {
    severity: "info",
    title: "A file resource is linked as a page",
    explanation:
      "An <a href> points at a stylesheet, script, or image. Crawlers treat that as a page URL, which wastes crawl budget and rarely helps users who expected a document.",
    howToFix:
      "Load styles and scripts with <link> and <script>, and images with <img> or <picture>. If people need to download the file, link to a real HTML page that presents it.",
  },
  "single-incoming-internal-link": {
    severity: "info",
    title: "Page has only one incoming internal link",
    explanation:
      "Exactly one crawled page links here. That is better than an orphan, but the URL is still easy to isolate: one template change can cut it off from the rest of the site.",
    howToFix:
      "Add a second contextual link from a related hub, category, or article so the page is not a single-edge dead-end.",
  },
  "malformed-link-url": {
    severity: "warning",
    title: "Link URL is malformed",
    explanation:
      "An href could not be parsed as an HTTP(S) URL, so it cannot be crawled or followed. Typical causes are missing schemes, broken template output, or unescaped spaces.",
    howToFix:
      "Fix the href so it resolves to a valid absolute or root-relative HTTP(S) URL. Remove the link if the destination is not a web page.",
  },
  "broken-internal-image": {
    severity: "warning",
    title: "Broken internal image",
    explanation:
      "An image on this page points at an internal URL that returned a 4xx or 5xx status. Broken images waste layout space and drop from image search.",
    howToFix:
      "Restore the file, update the src to the live path, or remove the <img> if the asset is gone.",
  },
  "broken-external-image": {
    severity: "warning",
    title: "Broken external image",
    explanation:
      "An image on this page points at an external URL that returned a 4xx or 5xx status. Hotlinked assets disappear when the remote host changes or blocks you.",
    howToFix:
      "Host the image yourself, or update the src to a URL you control that returns 200.",
  },
  "unminified-javascript": {
    severity: "info",
    title: "JavaScript file is not minified",
    explanation:
      "A JavaScript file still looks like source (many newlines relative to its size). Unminified scripts cost extra bytes on every visit.",
    howToFix:
      "Serve a minified production build and keep the readable source in your repository, not on the public origin.",
  },
  "unminified-css": {
    severity: "info",
    title: "Stylesheet is not minified",
    explanation:
      "A CSS file still looks like source (many newlines relative to its size). Unminified stylesheets add weight to first render.",
    howToFix:
      "Serve minified CSS from your build pipeline or CDN. Keep comments and nesting in the source files, not the public asset.",
  },
  "uncompressed-javascript": {
    severity: "warning",
    title: "JavaScript is served uncompressed",
    explanation:
      "A JavaScript response was delivered uncompressed (Content-Encoding is identity, or Content-Length matches the decoded body). A missing Content-Encoding header alone is not treated as proof — some runtimes strip it after they decompress.",
    howToFix:
      "Enable gzip or Brotli for JavaScript on the origin or CDN, then confirm Content-Encoding is gzip or br.",
  },
  "uncompressed-css": {
    severity: "warning",
    title: "Stylesheet is served uncompressed",
    explanation:
      "A CSS response was delivered uncompressed (Content-Encoding is identity, or Content-Length matches the decoded body). A missing Content-Encoding header alone is not treated as proof.",
    howToFix:
      "Enable gzip or Brotli for CSS on the origin or CDN, then confirm Content-Encoding is gzip or br.",
  },
  "uncached-javascript": {
    severity: "warning",
    title: "JavaScript has no cache policy",
    explanation:
      "A JavaScript response has neither Cache-Control nor Expires. Browsers must re-download it on every visit, which slows repeat views.",
    howToFix:
      "Set Cache-Control with a long max-age (and a content hash in the filename) or a shorter max-age if the URL is not versioned.",
  },
  "uncached-css": {
    severity: "warning",
    title: "Stylesheet has no cache policy",
    explanation:
      "A CSS response has neither Cache-Control nor Expires. Browsers must re-download it on every visit.",
    howToFix:
      "Set Cache-Control with a long max-age (and a content hash in the filename) or a shorter max-age if the URL is not versioned.",
  },
  "broken-internal-javascript": {
    severity: "critical",
    title: "Broken internal JavaScript file",
    explanation:
      "A script on this origin returned a 4xx or 5xx status. Missing scripts can break rendering, tracking, and interactivity.",
    howToFix:
      "Restore the file at that URL or update the script src to the live build artifact.",
  },
  "broken-internal-css": {
    severity: "critical",
    title: "Broken internal stylesheet",
    explanation:
      "A stylesheet on this origin returned a 4xx or 5xx status. Missing CSS often ships an unstyled page.",
    howToFix:
      "Restore the file at that URL or update the link href to the live stylesheet.",
  },
  "broken-external-javascript": {
    severity: "warning",
    title: "Broken external JavaScript file",
    explanation:
      "A third-party script returned a 4xx or 5xx status. The page may lose a feature, and the failed request still costs time.",
    howToFix:
      "Update or remove the script tag. Prefer a versioned URL you control over an unversioned third-party path.",
  },
  "broken-external-css": {
    severity: "warning",
    title: "Broken external stylesheet",
    explanation:
      "A third-party stylesheet returned a 4xx or 5xx status. Layout that depends on it will break.",
    howToFix:
      "Update or remove the link tag, or vendor the CSS so it is not a remote single point of failure.",
  },
  "page-assets-too-large": {
    severity: "warning",
    title: "JavaScript and CSS together exceed 500 KB",
    explanation:
      "The page's JavaScript and CSS (inline plus the files we could fetch) add up to more than 500 KB. Large style and script payloads delay first render and interactivity.",
    howToFix:
      "Split unused code, defer non-critical scripts, and drop unused CSS. Measure the production bundles, not the source tree.",
  },
  "too-many-page-assets": {
    severity: "warning",
    title: "Page loads too many JavaScript and CSS files",
    explanation:
      "The page references more than 20 script and stylesheet files. Each file is a separate request and connection, which hurts first render on mobile.",
    howToFix:
      "Bundle or HTTP/2-push fewer files, and inline only the critical CSS. Keep third-party tags on a budget.",
  },
  "temporary-redirect": {
    severity: "info",
    title: "URL uses a temporary (302/307) redirect",
    explanation:
      "This URL responds with a temporary redirect. Search engines may keep the original URL in the index instead of passing signals to the destination.",
    howToFix:
      "If the move is permanent, use 301 or 308 and update internal links to the destination. Keep 302/307 only for truly temporary hops.",
  },
  "permanent-redirect": {
    severity: "info",
    title: "URL is a permanent (301/308) redirect",
    explanation:
      "This URL permanently redirects somewhere else. That is usually correct; this is an inventory notice so leftover hops can be cleaned up.",
    howToFix:
      "Leave the redirect if old URLs still get traffic. Point internal links, canonicals, and the sitemap at the final URL so crawlers do not need the hop.",
  },
  "broken-canonical": {
    severity: "warning",
    title: "Canonical target is broken or unreachable",
    explanation:
      "The page's canonical URL returned a 4xx/5xx status or could not be fetched. Search engines then have to guess the preferred URL.",
    howToFix:
      "Point rel=canonical at a live 200 URL — usually the page itself — and confirm that URL is reachable without authentication.",
  },
  "www-resolve-issue": {
    severity: "warning",
    title: "WWW and apex both serve 200",
    explanation:
      "Both the www and non-www hostnames return 200 without redirecting to one another. That splits crawl signals and cookies across two origins.",
    howToFix:
      "Pick one hostname as canonical. 301 the other to it, and keep canonicals, sitemaps, and internal links on the chosen host.",
  },
  "http-homepage-not-secure": {
    severity: "critical",
    title: "HTTP homepage does not redirect to HTTPS",
    explanation:
      "The HTTP homepage did not redirect to the HTTPS homepage and does not declare it as canonical. Users and crawlers can stay on the insecure origin.",
    howToFix:
      "301 every HTTP URL — at least the homepage — to its HTTPS equivalent, and serve HSTS once HTTPS is stable.",
  },
  "hreflang-value-error": {
    severity: "warning",
    title: "hreflang value is not a valid language code",
    explanation:
      "An hreflang attribute is not a valid language or language-region code (and is not x-default). Invalid values are ignored, so the alternate is not applied.",
    howToFix:
      "Use BCP 47 tags such as en, en-GB, or zh-Hans, or x-default for the fallback. Do not invent codes or put URLs in the hreflang attribute.",
  },
  "hreflang-conflict": {
    severity: "warning",
    title: "hreflang annotations conflict on the page",
    explanation:
      "The page declares the same language more than once with different targets, or lists the same target under conflicting languages. Crawlers cannot tell which alternate to trust.",
    howToFix:
      "Keep one href per language code on the page, including a single x-default. Generate the set from one template so it cannot drift.",
  },
  "incorrect-hreflang-link": {
    severity: "warning",
    title: "hreflang target is missing, not 200, or not reciprocal",
    explanation:
      "An hreflang href is missing, does not return 200, or the target page does not point back with a matching alternate. Non-reciprocal clusters are ignored.",
    howToFix:
      "Every page in the set should list every other page, including itself, with the same language codes, and every href should resolve to 200.",
  },
  "hreflang-language-mismatch": {
    severity: "info",
    title: "hreflang language does not match the page language",
    explanation:
      "The language this page claims in hreflang disagrees with html lang (or with a language we could read from the URL/content signals we already have). That confuses which alternate belongs here.",
    howToFix:
      "Make html lang, the self-referencing hreflang, and the visible language the same BCP 47 tag.",
  },
  "dns-resolution-failure": {
    severity: "critical",
    title: "DNS resolution failed",
    explanation:
      "The crawler could not resolve this hostname. The URL is unreachable until DNS answers, so the page cannot be audited or indexed.",
    howToFix:
      "Check the hostname's A/AAAA records and nameservers. If the host is gone, remove the URL from sitemaps and internal links.",
  },
  "malformed-url-failure": {
    severity: "warning",
    title: "URL is malformed and could not be fetched",
    explanation:
      "The crawler was asked to fetch a URL that is not a valid HTTP(S) address. The request never left the client.",
    howToFix:
      "Correct the URL in the sitemap or link that produced it. Only enqueue http: and https: URLs with a valid host.",
  },
  "duplicate-h1-title": {
    severity: "info",
    title: "H1 and title tag are identical",
    explanation:
      "The H1 repeats the title tag verbatim. They can share a topic, but identical text wastes a chance to add a second, user-facing phrasing.",
    howToFix:
      "Keep the title scan-friendly for search results and write an H1 that reads naturally on the page. They should agree, not copy each other.",
  },
  "content-optimisation-needed": {
    severity: "info",
    title: "Page needs content optimisation",
    explanation:
      "The page is indexable and not thin, but its on-page package is still incomplete: it sits in a mid-length word-count band and is missing two or more of a unique H1, a meta description, a heading below H1, or a list/table. This is a deterministic structure check, not an editorial rewrite request.",
    howToFix:
      "Add a single clear H1, a unique meta description, at least one H2, and a list or table where it helps the reader scan the page.",
  },
  "too-much-content": {
    severity: "info",
    title: "Page contains more than 5,000 words",
    explanation:
      "The visible word count is above 5,000. Very long unpaginated documents are harder to scan, slower to render, and often mix several intents on one URL.",
    howToFix:
      "Split distinct topics onto their own URLs, or add a table of contents and clearer headings if the length is intentional.",
  },
  "outdated-content": {
    severity: "info",
    title: "Content date is older than 12 months",
    explanation:
      "The newest published or updated date we found on the page is more than 365 days old. Time-sensitive claims may be stale. Pages with no parseable date are not flagged here.",
    howToFix:
      "Review the page, update anything that has changed, and set an honest dateModified (visible and in markup). Do not bump the date without a real review.",
  },
  "low-semantic-html": {
    severity: "info",
    title: "Page uses little or no semantic HTML",
    explanation:
      "The document has no landmark or sectioning elements (main, article, nav, header, footer, section, aside). Assistive tech and some parsers then have to guess the page structure.",
    howToFix:
      "Wrap the primary content in <main> or <article>, and use header, nav, and footer for the chrome instead of unlabelled divs.",
  },
  "llms-txt-formatting": {
    severity: "info",
    title: "llms.txt has formatting issues",
    explanation:
      "A /llms.txt file was found, but it is not a usable plain-text map (for example it is HTML, empty, or has no headings or links). Presence without a readable format does not help AI agents.",
    howToFix:
      "Serve a UTF-8 text/plain file that starts with a heading, uses markdown-style links to canonical public URLs, and is not wrapped in HTML.",
  },
  "missing-hsts": {
    severity: "warning",
    title: "HTTPS response is missing HSTS",
    explanation:
      "The HTTPS response has no Strict-Transport-Security header. Browsers will not remember to upgrade future HTTP requests, so users can still be sent to the insecure origin.",
    howToFix:
      "Send Strict-Transport-Security on HTTPS responses (start with a modest max-age, then raise it). Only enable includeSubDomains once every subdomain is on HTTPS.",
  },
} as const satisfies Record<string, BaseAuditIssueDescriptor>;

export type AuditIssueType = keyof typeof AUDIT_ISSUE_TYPES;

const CATEGORIES: Partial<Record<AuditIssueType, AuditIssueCategory>> = {
  "blocked-page": "crawlability",
  "broken-internal-link": "architecture",
  "broken-page": "crawlability",
  "server-error": "technical",
  "redirect-chain": "crawlability",
  "redirect-loop": "crawlability",
  "orphan-page": "architecture",
  "no-outgoing-links": "architecture",
  "deep-page": "architecture",
  "canonical-conflict": "indexability",
  "canonicalized-page": "indexability",
  "noindex-page": "indexability",
  "missing-self-canonical": "indexability",
  "missing-title": "on-page",
  "duplicate-title": "on-page",
  "missing-meta-description": "on-page",
  "duplicate-meta-description": "on-page",
  "missing-h1": "on-page",
  "multiple-h1": "on-page",
  "title-too-long": "on-page",
  "title-too-short": "on-page",
  "meta-description-too-long": "on-page",
  "meta-description-too-short": "on-page",
  "heading-order-skip": "on-page",
  "duplicate-content": "content",
  "thin-content": "content",
  "images-missing-alt": "content",
  "slow-response": "performance",
  "invalid-json-ld": "structured-data",
  "missing-entity-schema": "structured-data",
  "missing-article-schema": "structured-data",
  "generic-link-anchor": "aeo",
  "empty-link-anchor": "aeo",
  "weak-answer-structure": "aeo",
  "missing-author-attribution": "geo",
  "missing-freshness-signal": "geo",
  "no-cited-sources": "geo",
  "ai-search-crawler-blocked": "geo",
  "search-crawler-blocked": "crawlability",
  "missing-llms-txt": "geo",
  "sitemap-missing": "crawlability",
  "sitemap-not-in-robots": "crawlability",
  "sitemap-invalid": "crawlability",
  "sitemap-too-large": "crawlability",
  "sitemap-http-urls-on-https-site": "crawlability",
  "robots-missing": "crawlability",
  "robots-invalid": "crawlability",
  "missing-doctype": "technical",
  "missing-charset": "technical",
  "meta-refresh-present": "technical",
  "page-has-frames": "technical",
  "html-size-too-large": "performance",
  "low-text-to-html-ratio": "content",
  "url-too-long": "technical",
  "url-has-underscores": "technical",
  "url-too-many-parameters": "technical",
  "noindex-via-x-robots-tag": "indexability",
  "page-not-compressed": "performance",
  "broken-external-link": "architecture",
  "external-link-403": "architecture",
  "too-many-on-page-links": "architecture",
  "link-url-too-long": "architecture",
  "internal-nofollow-outgoing": "architecture",
  "external-nofollow-outgoing": "architecture",
  "resource-as-page-link": "architecture",
  "single-incoming-internal-link": "architecture",
  "malformed-link-url": "architecture",
  "broken-internal-image": "content",
  "broken-external-image": "content",
  "unminified-javascript": "performance",
  "unminified-css": "performance",
  "uncompressed-javascript": "performance",
  "uncompressed-css": "performance",
  "uncached-javascript": "performance",
  "uncached-css": "performance",
  "broken-internal-javascript": "performance",
  "broken-internal-css": "performance",
  "broken-external-javascript": "performance",
  "broken-external-css": "performance",
  "page-assets-too-large": "performance",
  "too-many-page-assets": "performance",
  "temporary-redirect": "crawlability",
  "permanent-redirect": "crawlability",
  "broken-canonical": "indexability",
  "www-resolve-issue": "crawlability",
  "http-homepage-not-secure": "technical",
  "hreflang-value-error": "indexability",
  "hreflang-conflict": "indexability",
  "incorrect-hreflang-link": "indexability",
  "hreflang-language-mismatch": "indexability",
  "dns-resolution-failure": "crawlability",
  "malformed-url-failure": "crawlability",
  "duplicate-h1-title": "on-page",
  "content-optimisation-needed": "content",
  "too-much-content": "content",
  "outdated-content": "content",
  "low-semantic-html": "content",
  "llms-txt-formatting": "geo",
  "missing-hsts": "technical",
};

const GUIDANCE_OVERRIDES: Partial<
  Record<
    AuditIssueType,
    Partial<
      Pick<
        AuditIssueDescriptor,
        "fixOrder" | "impact" | "effort" | "howToVerify"
      >
    >
  >
> = {
  "broken-internal-link": { fixOrder: "now", impact: "high", effort: "small" },
  "missing-title": { fixOrder: "now", impact: "high", effort: "small" },
  "server-error": { fixOrder: "now", impact: "high", effort: "large" },
  "non-https-page": { fixOrder: "now", impact: "high", effort: "medium" },
  "invalid-json-ld": { fixOrder: "next", impact: "high", effort: "medium" },
  "ai-search-crawler-blocked": {
    fixOrder: "next",
    impact: "high",
    effort: "small",
    howToVerify:
      "Re-run the audit and test the affected user agents against robots.txt and representative public URLs.",
  },
  "search-crawler-blocked": {
    fixOrder: "now",
    impact: "high",
    effort: "small",
    howToVerify:
      "Re-run the audit and test Googlebot and bingbot against robots.txt and representative public URLs.",
  },
  "missing-entity-schema": { impact: "medium", effort: "medium" },
  "missing-article-schema": { impact: "medium", effort: "medium" },
  "generic-link-anchor": { impact: "medium", effort: "small" },
  "empty-link-anchor": { impact: "medium", effort: "small" },
  "weak-answer-structure": { impact: "medium", effort: "medium" },
  "missing-author-attribution": { impact: "medium", effort: "medium" },
  "missing-freshness-signal": { impact: "medium", effort: "small" },
  "no-cited-sources": { impact: "medium", effort: "medium" },
  "missing-llms-txt": {
    fixOrder: "monitor",
    impact: "low",
    effort: "small",
    howToVerify:
      "Open /llms.txt directly and confirm it returns a useful text document; no score should depend on it.",
  },
  "page-not-compressed": {
    howToVerify:
      "Request the URL with curl -I or DevTools and confirm Content-Encoding is gzip or br. A missing header in the audit row is not proof the origin skipped compression.",
  },
  "noindex-page": { fixOrder: "monitor", impact: "low", effort: "small" },
  "noindex-via-x-robots-tag": {
    fixOrder: "monitor",
    impact: "low",
    effort: "small",
  },
  "robots-missing": { fixOrder: "next", impact: "medium", effort: "small" },
  "sitemap-not-in-robots": {
    fixOrder: "improve",
    impact: "low",
    effort: "small",
  },
  "canonicalized-page": {
    fixOrder: "monitor",
    impact: "low",
    effort: "small",
  },
  "broken-internal-javascript": {
    fixOrder: "now",
    impact: "high",
    effort: "small",
  },
  "broken-internal-css": {
    fixOrder: "now",
    impact: "high",
    effort: "small",
  },
  "http-homepage-not-secure": {
    fixOrder: "now",
    impact: "high",
    effort: "medium",
  },
  "dns-resolution-failure": {
    fixOrder: "now",
    impact: "high",
    effort: "medium",
  },
  "permanent-redirect": {
    fixOrder: "monitor",
    impact: "low",
    effort: "small",
  },
  "external-link-403": {
    fixOrder: "improve",
    impact: "low",
    effort: "small",
  },
  "external-nofollow-outgoing": {
    fixOrder: "monitor",
    impact: "low",
    effort: "small",
  },
};

function defaultFixOrder(severity: IssueSeverity): AuditFixOrder {
  if (severity === "critical") return "now";
  if (severity === "warning") return "next";
  return "improve";
}

function defaultImpact(severity: IssueSeverity): AuditIssueImpact {
  if (severity === "critical") return "high";
  if (severity === "warning") return "medium";
  return "low";
}

const DEFAULT_VERIFICATION =
  "Apply the fix, re-run the audit, and confirm this check passes on every affected URL.";

function isAuditIssueType(value: string): value is AuditIssueType {
  return Object.hasOwn(AUDIT_ISSUE_TYPES, value);
}

export function getIssueDescriptor(
  issueType: string,
): AuditIssueDescriptor | null {
  if (!isAuditIssueType(issueType)) return null;
  const descriptor = AUDIT_ISSUE_TYPES[issueType];
  const override = GUIDANCE_OVERRIDES[issueType];
  return {
    ...descriptor,
    category: CATEGORIES[issueType] ?? "technical",
    fixOrder: override?.fixOrder ?? defaultFixOrder(descriptor.severity),
    impact: override?.impact ?? defaultImpact(descriptor.severity),
    effort: override?.effort ?? "medium",
    howToVerify: override?.howToVerify ?? DEFAULT_VERIFICATION,
  };
}
