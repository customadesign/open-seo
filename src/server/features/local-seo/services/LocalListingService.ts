import type { z } from "zod";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import { AppError } from "@/server/lib/errors";
import type {
  saveLocalBusinessProfileSchema,
  saveLocalListingConnectionSchema,
} from "@/types/schemas/local-seo";

type SaveProfileInput = z.infer<typeof saveLocalBusinessProfileSchema>;
type SaveConnectionInput = z.infer<typeof saveLocalListingConnectionSchema>;

async function saveProfile(input: SaveProfileInput) {
  const { projectId, profileId, ...values } = input;
  if (values.isPrimary) {
    const profile = await LocalSeoRepository.savePrimaryProfile(
      {
        id: profileId ?? crypto.randomUUID(),
        projectId,
        ...values,
      },
      profileId != null,
    );
    if (!profile) {
      throw new AppError("NOT_FOUND", "Local business profile not found");
    }
    return profile;
  }

  if (profileId) {
    const profile = await LocalSeoRepository.updateProfile(
      profileId,
      projectId,
      values,
    );
    if (!profile) {
      throw new AppError("NOT_FOUND", "Local business profile not found");
    }
    return profile;
  }

  return LocalSeoRepository.createProfile({
    id: crypto.randomUUID(),
    projectId,
    ...values,
  });
}

async function saveConnection(input: SaveConnectionInput) {
  const profile = await LocalSeoRepository.getProfileById(
    input.profileId,
    input.projectId,
  );
  if (!profile) {
    throw new AppError("NOT_FOUND", "Local business profile not found");
  }

  return LocalSeoRepository.upsertListingConnection({
    profileId: input.profileId,
    ghlLocationId: input.ghlLocationId,
    engine: input.engine,
    status: input.status,
    // Public/operator writes are always manual evidence. A future verified
    // provider integration must write through a separate server-owned path.
    statusSource: "manual",
    managementUrl: input.managementUrl,
    lastVerifiedAt: null,
    lastError: input.lastError ?? null,
  });
}

async function getListingStatus(projectId: string, profileId?: string) {
  const profile = profileId
    ? await LocalSeoRepository.getProfileById(profileId, projectId)
    : await LocalSeoRepository.getPrimaryProfile(projectId);

  if (!profile) {
    return {
      profile: null,
      connection: null,
      verification: "not_configured" as const,
      // There is no documented GHL/Yext endpoint in this integration for a
      // live status read. Never imply that stored/manual evidence is live.
      liveProviderCheckPerformed: false as const,
    };
  }

  const connection = await LocalSeoRepository.getListingConnection(
    profile.id,
    projectId,
  );
  return {
    profile,
    connection,
    verification: connection
      ? connection.statusSource !== "manual" && connection.lastVerifiedAt
        ? ("stored_evidence" as const)
        : ("unverified" as const)
      : ("not_configured" as const),
    liveProviderCheckPerformed: false as const,
  };
}

export const LocalListingService = {
  saveProfile,
  saveConnection,
  getListingStatus,
} as const;
