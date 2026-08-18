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
