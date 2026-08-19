import { normalizeAndValidateStartUrl } from "./url-policy";
import { isSameOrigin } from "./url-utils";

const DISCOVERY_REDIRECT_HOPS = 5;

/** Follow only same-origin redirects and re-run the full SSRF policy before
 * each network request. Native auto-follow validates the final URL too late:
 * the private-target request has already happened by then. */
export async function fetchAuditDiscoveryResource(
  input: string,
  init: RequestInit,
): Promise<{ response: Response; finalUrl: string }> {
  const initialUrl = await normalizeAndValidateStartUrl(input);
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= DISCOVERY_REDIRECT_HOPS; hop += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: currentUrl };
    if (hop === DISCOVERY_REDIRECT_HOPS) {
      throw new Error("Audit discovery redirect limit exceeded");
    }

    const nextUrl = await normalizeAndValidateStartUrl(
      new URL(location, currentUrl).toString(),
    );
    if (!isSameOrigin(nextUrl, initialUrl)) {
      throw new Error("Audit discovery redirect changed origin");
    }
    currentUrl = nextUrl;
  }

  throw new Error("Audit discovery redirect limit exceeded");
}
