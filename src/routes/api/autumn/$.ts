import { createFileRoute } from "@tanstack/react-router";
import type { autumnHandler } from "autumn-js/fetch";
import { env } from "cloudflare:workers";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { resolveHostedContext } from "@/middleware/ensure-user/hosted";
import { canManageWorkspace } from "@/shared/workspace-access";
import { AppError } from "@/server/lib/errors";

let handlerPromise: Promise<ReturnType<typeof autumnHandler>> | undefined;

// Lazy: keeps autumn-js/fetch out of the eager isolate startup graph;
// resolves instantly after the first request.
function loadHandler() {
  return (handlerPromise ??= import("autumn-js/fetch").then(
    ({ autumnHandler }) =>
      autumnHandler({
        identify: async (request) => {
          const context = await resolveHostedContext(request.headers);
          if (!canManageWorkspace(context.access)) {
            throw new AppError("FORBIDDEN");
          }

          return {
            customerId: context.organizationId,
          };
        },
      }),
  ));
}

async function handleAutumnRequest(request: Request) {
  if (!isHostedAuthMode(env.AUTH_MODE)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  return (await loadHandler())(request);
}

export const Route = createFileRoute("/api/autumn/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        return handleAutumnRequest(request);
      },
      POST: async ({ request }: { request: Request }) => {
        return handleAutumnRequest(request);
      },
    },
  },
});
