import { X } from "lucide-react";
import { Modal } from "@/client/components/Modal";
import { IssuesView } from "@/client/features/audit/results/IssuesView";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import {
  groupLighthouseFailures,
  type LighthouseFailureRow,
  type LighthousePageReference,
} from "@/client/features/audit/results/lighthouseFailureGuidance";

export function AuditIssuesSummaryModal({
  issues,
  onClose,
  onOpenReport,
}: {
  issues: AuditResultsData["issues"];
  onClose: () => void;
  onOpenReport: () => void;
}) {
  return (
    <Modal
      labelledBy="audit-issues-summary-title"
      maxWidth="max-w-5xl"
      onClose={onClose}
    >
      <ModalHeader
        id="audit-issues-summary-title"
        title={`${issues.length} audit ${issues.length === 1 ? "issue" : "issues"} found`}
        description="Open an issue to see why it matters, how to fix it, how to verify the change, and every affected URL."
        onClose={onClose}
      />
      <IssuesView issues={issues} />
      <ModalActions
        primaryLabel="Open issues report"
        onClose={onClose}
        onPrimary={onOpenReport}
      />
    </Modal>
  );
}

export function LighthouseFailuresModal({
  lighthouse,
  pages,
  onClose,
  onOpenPerformance,
}: {
  lighthouse: readonly LighthouseFailureRow[];
  pages: readonly LighthousePageReference[];
  onClose: () => void;
  onOpenPerformance: () => void;
}) {
  const groups = groupLighthouseFailures(lighthouse, pages);
  const failureCount = groups.reduce(
    (count, group) => count + group.tests.length,
    0,
  );

  return (
    <Modal
      labelledBy="lighthouse-failures-title"
      maxWidth="max-w-4xl"
      onClose={onClose}
    >
      <ModalHeader
        id="lighthouse-failures-title"
        title={`${failureCount} Lighthouse ${failureCount === 1 ? "failure" : "failures"}`}
        description="These tests did not finish, so OpenSEO has no Lighthouse scores for them. A failed test does not prove the page has an SEO or performance problem."
        onClose={onClose}
      />

      <div className="space-y-3">
        {groups.map((group) => (
          <section
            key={`${group.guidance.kind}-${group.technicalDetail}`}
            className="rounded-lg border border-error/25 bg-error/5 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{group.guidance.title}</h3>
                <p className="mt-1 text-sm text-base-content/70">
                  {group.guidance.explanation}
                </p>
              </div>
              <span className="badge badge-error badge-outline">
                {group.tests.length}{" "}
                {group.tests.length === 1 ? "test" : "tests"}
              </span>
            </div>

            <p className="mt-3 text-sm">
              <span className="font-medium">How to fix: </span>
              <span className="text-base-content/80">
                {group.guidance.howToFix}
              </span>
            </p>

            <div className="mt-3 overflow-hidden rounded border border-base-300/70 bg-base-100">
              {group.tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-center justify-between gap-3 border-b border-base-300/60 px-3 py-2 text-sm last:border-b-0"
                >
                  {test.pageUrl ? (
                    <a
                      className="link link-hover min-w-0 truncate"
                      href={test.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={test.pageUrl}
                    >
                      {test.pageUrl}
                    </a>
                  ) : (
                    <span className="text-base-content/50">
                      Page URL unavailable
                    </span>
                  )}
                  <span className="badge badge-ghost badge-sm shrink-0 capitalize">
                    {test.strategy}
                  </span>
                </div>
              ))}
            </div>

            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-base-content/60">
                Technical detail
              </summary>
              <code className="mt-2 block overflow-x-auto rounded bg-base-200/70 p-3 text-xs">
                {group.technicalDetail}
              </code>
            </details>
          </section>
        ))}
      </div>

      <ModalActions
        primaryLabel="Show failed tests in table"
        onClose={onClose}
        onPrimary={onOpenPerformance}
      />
    </Modal>
  );
}

function ModalHeader({
  id,
  title,
  description,
  onClose,
}: {
  id: string;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id={id} className="text-xl font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-base-content/70">{description}</p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-square shrink-0"
        aria-label="Close details"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function ModalActions({
  primaryLabel,
  onClose,
  onPrimary,
}: {
  primaryLabel: string;
  onClose: () => void;
  onPrimary: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-base-300 pt-4 sm:flex-row sm:justify-end">
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Close
      </button>
      <button type="button" className="btn btn-primary" onClick={onPrimary}>
        {primaryLabel}
      </button>
    </div>
  );
}
