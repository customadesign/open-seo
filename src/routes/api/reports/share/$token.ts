import { createFileRoute } from "@tanstack/react-router";
import { renderReportHtml } from "@/server/features/reports/reportPresentation";
import { ReportService } from "@/server/features/reports/services/ReportService";

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function notFound() {
  return Response.json(
    { error: "Report share link not found or expired." },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export const Route = createFileRoute("/api/reports/share/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!SHARE_TOKEN_PATTERN.test(params.token)) return notFound();
        const shared = await ReportService.resolveShareLink(params.token);
        if (!shared) return notFound();
        const headers = {
          "Cache-Control": "private, no-store, max-age=0",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        };
        if (request.headers.get("accept")?.includes("application/json")) {
          return Response.json(shared, { headers });
        }
        return new Response(renderReportHtml(shared.snapshot), {
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
        });
      },
    },
  },
});
