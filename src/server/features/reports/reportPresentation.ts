import { REPORT_SECTION_LABELS } from "@/shared/report-sections";
import type {
  ReportCommentaryKind,
  ReportSnapshot,
} from "@/types/schemas/reports";

export type ResolvedReportBranding = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
};

export const DEFAULT_REPORT_BRANDING: ResolvedReportBranding = {
  brandName: "OpenSEO",
  logoUrl: null,
  primaryColor: "#2563eb",
  accentColor: "#0f172a",
};

type StoredBranding = {
  brandName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
};

/** A null stored value means "inherit the product default", not "clear it". */
export function resolveReportBranding(
  stored?: StoredBranding | null,
): ResolvedReportBranding {
  return {
    brandName: stored?.brandName ?? DEFAULT_REPORT_BRANDING.brandName,
    logoUrl: stored?.logoUrl ?? DEFAULT_REPORT_BRANDING.logoUrl,
    primaryColor: stored?.primaryColor ?? DEFAULT_REPORT_BRANDING.primaryColor,
    accentColor: stored?.accentColor ?? DEFAULT_REPORT_BRANDING.accentColor,
  };
}

const SECTION_LABELS = REPORT_SECTION_LABELS;

const OMISSION_LABELS = {
  disabled: "turned off for this report",
  not_configured: "not connected",
  no_data: "no data for this period",
} as const;

const COMMENTARY_LABELS: Record<ReportCommentaryKind, string> = {
  overview: "Overview",
  win: "Wins",
  watch: "Watch",
  next_step: "Next steps",
};

const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 12;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

// Every interpolation in this module goes through here. The report HTML is
// assembled as a string (Gotenberg takes a file, not a React tree), so escaping
// is the only thing standing between stored project data and the document.
function escapeReportHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => HTML_ESCAPES[char] ?? char,
  );
}

function humanize(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/[_-]+/gu, " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
      value,
    );
  }
  return JSON.stringify(value) ?? "Unsupported value";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || !["object", "function"].includes(typeof value);
}

function renderTable(rows: Array<Record<string, unknown>>): string {
  const visibleRows = rows.slice(0, MAX_TABLE_ROWS);
  const keys = [
    ...new Set(visibleRows.flatMap((row) => Object.keys(row))),
  ].slice(0, MAX_TABLE_COLUMNS);
  const body = visibleRows
    .map(
      (row) =>
        `<tr>${keys
          .map((key) => {
            const value = row[key];
            return `<td>${escapeReportHtml(
              isScalar(value) ? formatValue(value) : JSON.stringify(value),
            )}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const omitted = rows.length - visibleRows.length;
  return `<div class="table-wrap"><table><thead><tr>${keys
    .map((key) => `<th>${escapeReportHtml(humanize(key))}</th>`)
    .join("")}</tr></thead><tbody>${body}</tbody></table></div>${
    omitted > 0 ? `<p class="note">${omitted} more rows omitted.</p>` : ""
  }`;
}

function renderData(value: unknown, depth = 0): string {
  if (depth >= 4) {
    return `<pre>${escapeReportHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<p class="empty">No rows</p>';
    if (value.every(isRecord)) return renderTable(value);
    return `<ul>${value
      .slice(0, MAX_TABLE_ROWS)
      .map((item) => `<li>${renderData(item, depth + 1)}</li>`)
      .join("")}</ul>`;
  }
  if (!isRecord(value)) {
    return `<span>${escapeReportHtml(formatValue(value))}</span>`;
  }
  const entries = Object.entries(value);
  const scalars = entries.filter(([, item]) => isScalar(item));
  const nested = entries.filter(([, item]) => !isScalar(item));
  return `${
    scalars.length > 0
      ? `<dl>${scalars
          .map(
            ([key, item]) =>
              `<div><dt>${escapeReportHtml(humanize(key))}</dt><dd>${escapeReportHtml(formatValue(item))}</dd></div>`,
          )
          .join("")}</dl>`
      : ""
  }${nested
    .map(
      ([key, item]) =>
        `<div class="nested"><h3>${escapeReportHtml(humanize(key))}</h3>${renderData(item, depth + 1)}</div>`,
    )
    .join("")}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date);
}

/**
 * The stored-data sections report the newest completed run on or before the
 * period end, which can predate the period. The document says so above the
 * tables rather than leaving a reader to spot it in a capture-date cell.
 */
function storedSectionNote(
  section: ReportSnapshot["sections"][number],
): string {
  if (section.key !== "ai_visibility" && section.key !== "local_geo_grid") {
    return "";
  }
  const noun = section.key === "ai_visibility" ? "brands" : "grids";
  const stale = section.data.configs.filter(
    (config) => config.freshness.isStale,
  ).length;
  const notes = [
    stale > 0 &&
      `${stale} of ${section.data.configs.length} tracked ${noun} last completed before this period began, so those figures predate the report.`,
    section.data.unavailable.length > 0 &&
      `${section.data.unavailable.length} tracked ${noun} had no usable stored run for this period.`,
  ].filter((note): note is string => note !== false);
  return notes.length > 0
    ? `<p class="note">${escapeReportHtml(notes.join(" "))}</p>`
    : "";
}

export type ReportCommentaryLine = {
  kind: ReportCommentaryKind;
  text: string;
};

type RenderReportInput = {
  snapshot: ReportSnapshot;
  branding: ResolvedReportBranding;
  commentary?: ReportCommentaryLine[];
  /**
   * The PDF renderer fetches every asset the HTML references, so a
   * project-supplied logo URL would let stored data steer server-side
   * requests. Remote assets are therefore opt-in and stay off for PDFs.
   */
  allowRemoteAssets?: boolean;
};

function renderCommentary(items: ReportCommentaryLine[]): string {
  const kinds: ReportCommentaryKind[] = [
    "overview",
    "win",
    "watch",
    "next_step",
  ];
  const blocks = kinds
    .map((kind) => {
      const lines = items.filter((item) => item.kind === kind);
      if (lines.length === 0) return "";
      return `<div class="nested"><h3>${escapeReportHtml(COMMENTARY_LABELS[kind])}</h3><ul>${lines
        .map((line) => `<li>${escapeReportHtml(line.text)}</li>`)
        .join("")}</ul></div>`;
    })
    .join("");
  return blocks ? `<section><h2>Summary</h2>${blocks}</section>` : "";
}

export function renderReportHtml(input: RenderReportInput): string {
  const { snapshot, branding } = input;
  const title = `${branding.brandName} SEO report`;
  const logo =
    input.allowRemoteAssets && branding.logoUrl
      ? `<img class="logo" src="${escapeReportHtml(branding.logoUrl)}" alt="">`
      : "";
  const sections = snapshot.sections
    .map(
      (section) =>
        `<section><h2>${escapeReportHtml(SECTION_LABELS[section.key])}</h2>${storedSectionNote(section)}${renderData(section.data)}</section>`,
    )
    .join("");
  const omissions = snapshot.omissions
    .map(
      (omission) =>
        `<li><strong>${escapeReportHtml(SECTION_LABELS[omission.key])}:</strong> ${escapeReportHtml(OMISSION_LABELS[omission.reason])}</li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeReportHtml(title)}</title>
  <style>
    @page { size: Letter; margin: 0.55in; }
    * { box-sizing: border-box; }
    body { color: #172033; font: 12px/1.45 Arial, sans-serif; margin: 0; padding: 16px; }
    header { border-bottom: 4px solid ${branding.primaryColor}; margin-bottom: 24px; padding-bottom: 18px; }
    .logo { max-height: 48px; margin-bottom: 10px; }
    h1 { color: ${branding.primaryColor}; font-size: 28px; line-height: 1.15; margin: 0 0 8px; }
    h2 { color: ${branding.primaryColor}; font-size: 18px; margin: 0 0 14px; }
    h3 { font-size: 13px; margin: 16px 0 8px; }
    p { margin: 4px 0; }
    .period, .domain, .note, .empty { color: #596579; }
    section { break-inside: avoid-page; border: 1px solid #dce2ea; border-top: 3px solid ${branding.accentColor}; border-radius: 6px; margin: 0 0 18px; padding: 16px; }
    dl { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; }
    dl div { background: #f5f7fa; border-radius: 4px; padding: 8px; }
    dt { color: #647084; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    dd { font-size: 14px; font-weight: 700; margin: 3px 0 0; overflow-wrap: anywhere; }
    .nested { margin-top: 14px; }
    .table-wrap { overflow: hidden; width: 100%; }
    table { border-collapse: collapse; font-size: 9px; table-layout: fixed; width: 100%; }
    th, td { border: 1px solid #dce2ea; overflow-wrap: anywhere; padding: 5px; text-align: left; vertical-align: top; }
    th { background: #f0f3f7; color: #39465a; }
    ul { margin: 6px 0; padding-left: 20px; }
    pre { background: #f5f7fa; font-size: 8px; overflow-wrap: anywhere; padding: 8px; white-space: pre-wrap; }
    .omissions { background: #fff9e8; border-color: #eedca1; border-top-color: #d8ad2d; }
    footer { color: #7a8494; font-size: 9px; margin-top: 18px; text-align: center; }
  </style>
</head>
<body>
  <header>
    ${logo}
    <h1>${escapeReportHtml(title)}</h1>
    <p class="domain">${escapeReportHtml(snapshot.project.name)}${snapshot.project.domain ? ` · ${escapeReportHtml(snapshot.project.domain)}` : ""}</p>
    <p class="period">${escapeReportHtml(formatDate(snapshot.period.start))} – ${escapeReportHtml(formatDate(snapshot.period.end))}</p>
  </header>
  ${renderCommentary(input.commentary ?? [])}
  ${sections || '<section><p class="empty">No report sections were available.</p></section>'}
  ${omissions ? `<section class="omissions"><h2>Data availability</h2><ul>${omissions}</ul></section>` : ""}
  <footer>Generated by ${escapeReportHtml(branding.brandName)} on ${escapeReportHtml(formatDate(snapshot.generatedAt))}</footer>
</body>
</html>`;
}

export function renderReportEmail(input: {
  snapshot: ReportSnapshot;
  branding: ResolvedReportBranding;
  hasPdf: boolean;
  shareUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const { snapshot, branding } = input;
  const period = `${formatDate(snapshot.period.start)} – ${formatDate(snapshot.period.end)}`;
  const included = snapshot.sections.map(
    (section) => SECTION_LABELS[section.key],
  );
  const omitted = snapshot.omissions.map(
    (item) => `${SECTION_LABELS[item.key]} (${OMISSION_LABELS[item.reason]})`,
  );
  const attachmentCopy = input.hasPdf
    ? "Your PDF report is attached."
    : "Your report is ready.";
  const subject = `${snapshot.project.name} SEO report — ${period}`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#172033;max-width:640px">
    <h1 style="color:${branding.primaryColor}">${escapeReportHtml(branding.brandName)} SEO report</h1>
    <p><strong>${escapeReportHtml(snapshot.project.name)}</strong><br>${escapeReportHtml(period)}</p>
    <p>${escapeReportHtml(attachmentCopy)}</p>
    ${input.shareUrl ? `<p><a href="${escapeReportHtml(input.shareUrl)}">View the report online</a></p>` : ""}
    ${included.length > 0 ? `<p><strong>Included:</strong> ${included.map(escapeReportHtml).join(", ")}</p>` : ""}
    ${omitted.length > 0 ? `<p><strong>Not included:</strong> ${omitted.map(escapeReportHtml).join(", ")}</p>` : ""}
    <p style="color:#6b7280;font-size:12px">Generated by ${escapeReportHtml(branding.brandName)}.</p>
  </div>`;
  const text = [
    `${branding.brandName} SEO report`,
    snapshot.project.name,
    period,
    "",
    attachmentCopy,
    input.shareUrl ? `View online: ${input.shareUrl}` : "",
    included.length > 0 ? `Included: ${included.join(", ")}` : "",
    omitted.length > 0 ? `Not included: ${omitted.join(", ")}` : "",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
  return { subject, html, text };
}
