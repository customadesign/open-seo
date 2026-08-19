import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_project/p/$projectId/changes")({
  component: ChangesLayout,
});

function ChangesLayout() {
  return <Outlet />;
}
