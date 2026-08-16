/** Better Auth provider ID for the dedicated Google Ads read-only grant. */
export const GOOGLE_ADS_OAUTH_PROVIDER_ID = "google-ads";

export const GOOGLE_ADS_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/adwords",
] as const;

export const GOOGLE_ADS_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/every-app/open-seo/blob/main/docs/SELF_HOSTING_GOOGLE_ADS.md";
