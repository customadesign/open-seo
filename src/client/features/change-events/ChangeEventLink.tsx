import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function ChangeEventLink({
  projectId,
  event,
  className,
  children,
}: {
  projectId: string;
  event: { source: string; entityId: string | null };
  className?: string;
  children: ReactNode;
}) {
  if (event.source === "audit" && event.entityId) {
    return (
      <Link
        to="/p/$projectId/audit"
        params={{ projectId }}
        search={{ auditId: event.entityId, tab: "issues" }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "reports") {
    return (
      <Link
        to="/p/$projectId/reports"
        params={{ projectId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "rank_tracking" && event.entityId) {
    return (
      <Link
        to="/p/$projectId/rank-tracking/$configId"
        params={{ projectId, configId: event.entityId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "backlinks") {
    return (
      <Link
        to="/p/$projectId/backlinks"
        params={{ projectId }}
        search={{}}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "local_seo") {
    return (
      <Link
        to="/p/$projectId/local-seo"
        params={{ projectId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "gsc") {
    return (
      <Link
        to="/p/$projectId/search-performance"
        params={{ projectId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (event.source === "ga4") {
    return (
      <Link to="/p/$projectId" params={{ projectId }} className={className}>
        {children}
      </Link>
    );
  }
  if (event.source === "ai_visibility") {
    return (
      <Link
        to="/p/$projectId/brand-lookup"
        params={{ projectId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return null;
}
