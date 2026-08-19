/** Uncompressed HTML larger than this fails `html-size-too-large`. */
export const HTML_SIZE_TOO_LARGE_BYTES = 2 * 1024 * 1024;

/** Visible-text / HTML ratio below this fails `low-text-to-html-ratio`. */
export const LOW_TEXT_TO_HTML_RATIO = 0.1;

/** Full URL character length above this fails `url-too-long`. */
export const URL_TOO_LONG_CHARS = 200;

/** Query-parameter count above this fails `url-too-many-parameters`. */
export const URL_TOO_MANY_PARAMETERS = 3;

/** Sitemap URL count above this fails `sitemap-too-large`. */
export const SITEMAP_MAX_URLS = 50_000;

/** Uncompressed sitemap byte size above this fails `sitemap-too-large`. */
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

/**
 * When Content-Encoding is absent, treat Content-Length as the uncompressed
 * wire size only if it is this close to the decoded HTML byte count.
 */
export const UNCOMPRESSED_CONTENT_LENGTH_TOLERANCE_BYTES = 64;

/** On-page `<a href>` count above this fails `too-many-on-page-links`. */
export const TOO_MANY_ON_PAGE_LINKS = 3_000;

/** Outgoing link target character length above this fails `link-url-too-long`. */
export const LINK_URL_TOO_LONG_CHARS = 2_000;

/**
 * Unique extra resource probes (external links, images, JS/CSS, unchecked
 * canonicals, unchecked hreflang targets) allowed per audit run. Deduped
 * across the crawl; one URL is one check even if many pages reference it.
 */
export const MAX_RESOURCE_PROBES_PER_RUN = 150;

/** Per-URL timeout for extra resource probes. Slow hosts are skipped, not retried. */
export const RESOURCE_PROBE_TIMEOUT_MS = 5_000;

/** Concurrent extra resource probes. */
export const RESOURCE_PROBE_CONCURRENCY = 6;

/** Bytes of an asset body kept for minify / size inspection. */
export const RESOURCE_PROBE_MAX_BODY_BYTES = 256 * 1024;

/** Combined JS+CSS bytes (inline + probed) above this fails `page-assets-too-large`. */
export const PAGE_ASSETS_MAX_BYTES = 500 * 1024;

/** Combined JS+CSS file count above this fails `too-many-page-assets`. */
export const TOO_MANY_PAGE_ASSETS = 20;

/**
 * Newline ratio above this, on a file at least UNMINIFIED_MIN_BYTES, is
 * treated as unminified source. Minified bundles are typically one or two
 * lines; pretty-printed source has far more.
 */
export const UNMINIFIED_NEWLINE_RATIO = 0.01;

/** Files smaller than this are not judged for minification. */
export const UNMINIFIED_MIN_BYTES = 1_024;

/**
 * Word count at or above this fails `too-much-content`. Long-form is fine;
 * this is the "wall of unpaginated text" band, not a quality judgment.
 */
export const TOO_MUCH_CONTENT_WORDS = 5_000;

/**
 * A parseable published/updated date older than this many days fails
 * `outdated-content`. Only fires when a date was actually found.
 */
export const OUTDATED_CONTENT_MAX_AGE_DAYS = 365;

/**
 * Indexable HTML with fewer than this many landmark/sectioning elements
 * fails `low-semantic-html`.
 */
export const LOW_SEMANTIC_HTML_MIN_ELEMENTS = 1;

/**
 * Word-count band for `content-optimisation-needed`. Below THIN_CONTENT
 * is already `thin-content`; this catches mid-length pages whose on-page
 * package is still incomplete.
 */
export const CONTENT_OPTIMISATION_MIN_WORDS = 150;

/** Upper word-count bound for `content-optimisation-needed`. */
export const CONTENT_OPTIMISATION_MAX_WORDS = 800;
