import { createFileRoute } from "@tanstack/react-router";
import {
  GOOGLE_ADS_INTEGRATION,
  handleSelfHostedGoogleOAuthCallbackRequest,
} from "@/server/features/google/selfHostedOAuth";

export const Route = createFileRoute("/api/google-ads/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleSelfHostedGoogleOAuthCallbackRequest(
          request,
          GOOGLE_ADS_INTEGRATION,
        ),
    },
  },
});
