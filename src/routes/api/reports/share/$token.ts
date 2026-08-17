import { createFileRoute } from "@tanstack/react-router";
import { withPgClient } from "@/db";
import { ReportShareService } from "@/server/features/reports/ReportShareService";
import { renderReportHtml } from "@/server/features/reports/reportPresentation";
import { SHARE_TOKEN_PATTERN } from "@/server/features/reports/reportShareTokens";

// One response for "no such token", "expired", "revoked" and "run not
// published": a share link must not answer questions about reports it cannot
// open.
function notFound() {
  return Response.json(
    { error: "Report share link not found or expired." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export const Route = createFileRoute("/api/reports/share/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!SHARE_TOKEN_PATTERN.test(params.token)) return notFound();
        const shared = await withPgClient(() =>
          ReportShareService.resolveShareLink(params.token),
        );
        if (!shared) return notFound();
        if (request.headers.get("accept")?.includes("application/json")) {
          return Response.json(shared, { headers: SECURITY_HEADERS });
        }
        return new Response(
          renderReportHtml({
            snapshot: shared.snapshot,
            branding: shared.branding,
            commentary: shared.commentary,
            allowRemoteAssets: true,
          }),
          {
            headers: {
              ...SECURITY_HEADERS,
              "Content-Type": "text/html; charset=utf-8",
              // The document is a self-contained string of our own markup: no
              // scripts, no framing, no outbound form posts.
              "Content-Security-Policy":
                "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            },
          },
        );
      },
    },
  },
});
