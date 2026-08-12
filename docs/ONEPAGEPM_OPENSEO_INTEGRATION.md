# OnePagePM Tools -> OpenSEO integration

Investigation date: 2026-08-13. No OnePagePM account or deployment was changed. A separate source edit added the OpenSEO sidebar link described below.

## Source location

The local project record identifies this checkout as canonical:

```text
/Volumes/Extreme SSD/Development/OnePagePM/app
```

The repository points to `customadesign/onepagepm`. Older copies under `/Users/harrymurphy` are stale and should not be used for this change.

## Sidebar implementation path

The Tools group lives in:

```text
src/components/layout/app-sidebar.tsx
```

`AppSidebar` renders the collapsible Tools group around lines 577-700. External tool links use a `SidebarMenuItem`, a `SidebarMenuButton` with `asChild`, and an anchor that opens a new tab. The Google Ads Optimizer item links to OnePagePM's `/api/sso/adpilot` route with the same pattern.

The canonical checkout now has an uncommitted OpenSEO item at lines 612-623:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton asChild tooltip="OpenSEO">
    <a href="https://app.openseo.so" target="_blank" rel="noopener noreferrer">
      <Globe />
      <span>OpenSEO</span>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  </SidebarMenuButton>
</SidebarMenuItem>
```

That is the complete implementation path for a plain link. `https://app.openseo.so` is the production application hostname declared by OpenSEO's deployment configuration. The marketing site is `https://openseo.so` and should not be used for this sidebar destination.

The change is present in the OnePagePM working tree but has not been committed or deployed. Review that separate working tree before either step.

## Context passing

The sidebar can access `currentWorkspaceId`, `currentWorkspace`, the user role, and basic user data. OnePagePM's dashboard layout passes `currentWorkspace?.id` into `AppSidebar` at `src/app/(dashboard)/layout.tsx:169`. It does not pass the current OnePagePM project id, client id, client domain, or an OpenSEO project id.

OpenSEO selects projects through its own authenticated project ids at `/p/$projectId`. Its root route redirects to the last OpenSEO project available to the signed-in organization. OpenSEO has no query parameter or handoff endpoint that maps a OnePagePM workspace or project to an OpenSEO project.

The plain production link should not append OnePagePM ids or client details. The two applications use unrelated identifiers, and client names or domains in a URL would be copied into browser history, logs, and referrer data.

A context-aware integration needs an explicit contract in both applications:

1. Store a mapping between a OnePagePM project and an OpenSEO project id.
2. Add a OnePagePM server route such as `/api/sso/openseo` that checks the signed-in user and mints a short-lived, audience-bound handoff token.
3. Add an OpenSEO endpoint that verifies the token, checks organization access, resolves the mapped project, and redirects to `/p/<OpenSEO project id>`.

The existing AdPilot integration provides a OnePagePM-side pattern in `src/app/api/sso/adpilot/route.ts` and `src/lib/adpilot-sso.ts`. OpenSEO does not currently implement the receiving half, so the static link is the safe version available now.
