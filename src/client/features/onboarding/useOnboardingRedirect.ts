import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { onboardingAnswersQueryOptions } from "@/client/features/onboarding/onboardingModel";
import { useSession } from "@/lib/auth-client";
import {
  isEmailVerificationBypassed,
  isHostedClientAuthMode,
} from "@/lib/auth-mode";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";

export function useOnboardingRedirect() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const isHostedMode = isHostedClientAuthMode();
  const accessQuery = useWorkspaceAccess();
  const canManageWorkspace = accessQuery.data?.canManageWorkspace === true;
  const isEmailVerified =
    session?.user?.emailVerified === true || isEmailVerificationBypassed();
  const onboardingQuery = useQuery({
    ...onboardingAnswersQueryOptions(),
    enabled:
      isHostedMode &&
      Boolean(session?.user?.id) &&
      isEmailVerified &&
      canManageWorkspace,
  });

  useEffect(() => {
    if (
      !isHostedMode ||
      !canManageWorkspace ||
      !session?.user?.id ||
      !isEmailVerified ||
      onboardingQuery.isLoading ||
      onboardingQuery.isError ||
      onboardingQuery.data?.completedAt ||
      window.location.pathname === "/onboarding"
    ) {
      return;
    }

    void navigate({ to: "/onboarding", search: { step: 0 }, replace: true });
  }, [
    isHostedMode,
    canManageWorkspace,
    navigate,
    onboardingQuery.data?.completedAt,
    onboardingQuery.isError,
    onboardingQuery.isLoading,
    isEmailVerified,
    session?.user?.id,
  ]);
}
