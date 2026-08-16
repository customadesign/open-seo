import { createFileRoute } from "@tanstack/react-router";
import { ProjectSettings } from "@/client/features/projects/ProjectSettings";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";

export const Route = createFileRoute("/_project/p/$projectId/settings")({
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  const { projectId } = Route.useParams();
  const accessQuery = useWorkspaceAccess();
  if (!accessQuery.data) return null;
  if (!accessQuery.data.canManageWorkspace) {
    return (
      <div className="mx-auto max-w-xl p-6 py-12">
        <h1 className="text-xl font-semibold">Project settings</h1>
        <p className="mt-2 text-sm text-base-content/65">
          Only the workspace owner can change project settings or connections.
        </p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto bg-base-100">
      <ProjectSettings projectId={projectId} />
    </div>
  );
}
