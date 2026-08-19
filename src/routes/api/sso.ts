import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { getAuth, getHostedBaseUrl, hasHostedAuthConfig } from "@/lib/auth";
import { hasOnePagePmSsoConfig } from "@/lib/auth-onepagepm-sso";
import { isHostedAuthMode } from "@/lib/auth-mode";

// Public landing point for the OnePagePM "OpenSEO" sidebar entry. OnePagePM
// verifies its own Supabase session, mints a 60s HS256 token, and sends the
// browser here. Everything security-relevant happens in the Better Auth
// endpoint this delegates to; this route only turns its answer into a redirect
// and carries the session cookie across.

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: location,
    // A cached redirect carrying a Set-Cookie would hand one user's session to
    // the next visitor through any shared cache.
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}

async function handleSsoRequest(request: Request): Promise<Response> {
  if (!isHostedAuthMode(env.AUTH_MODE)) {
    return new Response("Not found", { status: 404 });
  }
  if (!hasHostedAuthConfig() || !hasOnePagePmSsoConfig()) {
    return new Response("SSO is not configured on this deployment", {
      status: 500,
    });
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return redirect("/sign-in", []);
  }

  const target = new URL("/api/auth/sso/onepagepm", getHostedBaseUrl());
  target.searchParams.set("token", token);

  const result = await getAuth().handler(
    new Request(target, { method: "GET", headers: request.headers }),
  );

  if (!result.ok) {
    // Deliberately uniform: a bad signature, an expired token and an unknown
    // user all land on the same plain sign-in page, so probing the endpoint
    // reveals nothing about why a token was refused.
    return redirect("/sign-in", []);
  }

  return redirect("/", result.headers.getSetCookie());
}

export const Route = createFileRoute("/api/sso")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleSsoRequest(request),
    },
  },
});
