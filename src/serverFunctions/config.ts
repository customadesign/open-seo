import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { requireWorkspaceUse } from "@/serverFunctions/middleware";

export const getSeoApiKeyStatus = createServerFn({ method: "GET" })
  .middleware(requireWorkspaceUse)
  .handler(() => {
    const configured = Boolean(env.DATAFORSEO_API_KEY?.trim());
    return { configured };
  });
