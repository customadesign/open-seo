// Custom environment variable type definitions
// These extend the auto-generated Env interface from worker-configuration.d.ts

declare namespace Cloudflare {
  interface Env {
    R2: R2Bucket;
    OAUTH_KV: KVNamespace;

    // Durable Object backing the onboarding strategy chat (see wrangler.jsonc).
    ONBOARDING_CHAT: DurableObjectNamespace;

    // Durable Object backing the SAM in-app agent (see wrangler.jsonc).
    SAM_CHAT: DurableObjectNamespace;

    // Durable Object holding per-audit crawl scratch state (frontier, link
    // edges, page mirror). Untyped here; getAuditScratchpad narrows the stub.
    AUDIT_SCRATCHPAD: DurableObjectNamespace;

    AUTH_MODE?: "cloudflare_access" | "local_noauth" | "hosted";
    BYPASS_EMAIL_VERIFICATION?: string;
    TEAM_DOMAIN?: string;
    POLICY_AUD?: string;
    POSTHOG_PUBLIC_KEY?: string;
    POSTHOG_HOST?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    // Shared HS256 secret for the OnePagePM SSO handoff. Bearer-equivalent:
    // whoever holds it can mint a session for any email, so it lives only in
    // deployment env on both sides. Absent = the SSO endpoint is not mounted.
    OPENSEO_SSO_SECRET?: string;
    // Set to "false" only on a deployment that genuinely wants open public
    // registration. Anything else (including unset) closes /sign-up/email.
    DISABLE_PUBLIC_SIGNUP?: string;
    // Set to "true" to unregister the Google social provider entirely, leaving
    // email and password as the only credential path. Unset keeps Google on.
    DISABLE_SOCIAL_LOGIN?: string;
    // Set to "true" for a deployment that serves one organization: every user
    // shares a single workspace and the billing surface is removed.
    SINGLE_TENANT?: string;
    DATABASE_PROVIDER?: "d1" | "postgres";
    HYPERDRIVE?: {
      connectionString: string;
    };
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_ADS_DEVELOPER_TOKEN?: string;
    LOOPS_API_KEY?: string;
    LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID?: string;
    LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID?: string;

    // Scheduled report delivery. The renderer URL must be an access-controlled
    // public HTTPS endpoint in front of Gotenberg (loopback http is accepted
    // for local development only).
    REPORT_PDF_RENDER_URL?: string;
    REPORT_PDF_RENDER_BEARER_TOKEN?: string;
    RESEND_API_KEY?: string;
    REPORT_EMAIL_FROM?: string;
    REPORT_EMAIL_REPLY_TO?: string;
    // Fail-closed: report email only reaches REPORT_TEST_RECIPIENTS unless
    // this is exactly "false". Other recipients are recorded as skipped.
    REPORT_DELIVERY_TEST_MODE?: string;
    REPORT_TEST_RECIPIENTS?: string;
    AUTUMN_SECRET_KEY?: string;
    AUTUMN_WEBHOOK_SECRET?: string;
    // HMAC secret for the operator-only GDPR storage-erasure endpoint.
    GDPR_ERASURE_SECRET?: string;

    // Cloudflare Turnstile — signup captcha (hosted only). Secret verifies
    // tokens server-side; site key is public and inlined into the client build.
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_SITE_KEY?: string;

    // DataForSEO API Basic auth value (base64 of login:password)
    DATAFORSEO_API_KEY: string;

    // OpenRouter API key for the in-app chat agents (onboarding + SAM).
    OPENROUTER_API_KEY?: string;
    // Optional OpenRouter model slug override (defaults in openrouter.ts).
    OPENROUTER_MODEL?: string;
  }
}

interface ImportMetaEnv {
  readonly AUTH_MODE?: "cloudflare_access" | "local_noauth" | "hosted";
  readonly DATABASE_PROVIDER?: "d1" | "postgres";
  readonly BYPASS_EMAIL_VERIFICATION?: string;
  readonly DISABLE_PUBLIC_SIGNUP?: string;
  readonly DISABLE_SOCIAL_LOGIN?: string;
  readonly SINGLE_TENANT?: string;
  readonly POSTHOG_PUBLIC_KEY?: string;
  readonly POSTHOG_HOST?: string;
  readonly TURNSTILE_SITE_KEY?: string;
  readonly VITE_E2E_DOMAIN_FIXTURES?: string;
  readonly VITE_E2E_KEYWORD_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
