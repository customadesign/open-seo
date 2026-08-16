import { hasSelfHostedGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";

export async function hasGoogleAdsConfig(): Promise<boolean> {
  const developerToken = (
    await getOptionalEnvValue("GOOGLE_ADS_DEVELOPER_TOKEN")
  )?.trim();
  const oauthConfigured =
    (await isHostedServerAuthMode()) ||
    (await hasSelfHostedGoogleOAuthConfig());
  return Boolean(developerToken && oauthConfigured);
}
