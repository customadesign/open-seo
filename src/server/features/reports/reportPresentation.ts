import {
  reportSectionLabel,
  type ReportSnapshot,
} from "@/types/schemas/reports";

const OMISSION_LABELS = {
  not_configured: "not connected",
  no_data: "no data for this period",
  source_error: "temporarily unavailable",
} as const;

const MAX_ARRAY_ITEMS = 200;

export function escapeReportHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "Symbol";
  return JSON.stringify(value) ?? "Unsupported value";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || !["object", "function"].includes(typeof value);
}

function renderTable(rows: Array<Record<string, unknown>>): string {
  const visibleRows = rows.slice(0, MAX_ARRAY_ITEMS);
  const keys = [
    ...new Set(visibleRows.flatMap((row) => Object.keys(row))),
  ].slice(0, 12);
  const table = `<div class="table-wrap"><table><thead><tr>${keys
    .map((key) => `<th>${escapeReportHtml(humanize(key))}</th>`)
    .join("")}</tr></thead><tbody>${visibleRows
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
    .join("")}</tbody></table></div>`;
  const omitted = rows.length - visibleRows.length;
  return `${table}${omitted > 0 ? `<p class="note">${omitted} additional rows omitted from this PDF.</p>` : ""}`;
}

function renderData(value: unknown, depth = 0): string {
  if (depth >= 4) {
    return `<pre>${escapeReportHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<p class="empty">No rows</p>';
    if (value.every(isRecord)) return renderTable(value);
    return `<ul>${value
      .slice(0, MAX_ARRAY_ITEMS)
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

export function renderReportHtml(snapshot: ReportSnapshot): string {
  const title = `${snapshot.branding.brandName} SEO report`;
  const sections = snapshot.sections
    .map(
      (section) => `<section>
        <h2>${escapeReportHtml(reportSectionLabel(section.key))}</h2>
        ${renderData(section.data)}
      </section>`,
    )
    .join("");
  const omissions = snapshot.omissions
    .map(
      (omission) =>
        `<li><strong>${escapeReportHtml(reportSectionLabel(omission.key))}:</strong> ${escapeReportHtml(OMISSION_LABELS[omission.reason])}</li>`,
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
    body { color: #172033; font: 12px/1.45 Arial, sans-serif; margin: 0; }
    header { border-bottom: 4px solid ${snapshot.branding.primaryColor}; margin-bottom: 24px; padding-bottom: 18px; }
    h1 { color: ${snapshot.branding.primaryColor}; font-size: 28px; line-height: 1.15; margin: 0 0 8px; }
    h2 { color: ${snapshot.branding.primaryColor}; font-size: 18px; margin: 0 0 14px; }
    h3 { font-size: 13px; margin: 16px 0 8px; }
    p { margin: 4px 0; }
    .period, .domain, .note, .empty { color: #596579; }
    section { break-inside: avoid-page; border: 1px solid #dce2ea; border-top: 3px solid ${snapshot.branding.accentColor}; border-radius: 6px; margin: 0 0 18px; padding: 16px; }
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
    <h1>${escapeReportHtml(title)}</h1>
    <p class="domain">${escapeReportHtml(snapshot.project.name)}${snapshot.project.domain ? ` · ${escapeReportHtml(snapshot.project.domain)}` : ""}</p>
    <p class="period">${escapeReportHtml(formatDate(snapshot.period.start))} – ${escapeReportHtml(formatDate(snapshot.period.end))}</p>
  </header>
  ${sections || '<section><p class="empty">No report sections were available.</p></section>'}
  ${omissions ? `<section class="omissions"><h2>Data availability</h2><ul>${omissions}</ul></section>` : ""}
  <footer>Generated by OpenSEO on ${escapeReportHtml(formatDate(snapshot.generatedAt))}</footer>
</body>
</html>`;
}

export function renderReportEmail(input: {
  snapshot: ReportSnapshot;
  hasPdf: boolean;
}): { html: string; text: string } {
  const { snapshot } = input;
  const period = `${formatDate(snapshot.period.start)} – ${formatDate(snapshot.period.end)}`;
  const available = snapshot.sections.map((section) =>
    reportSectionLabel(section.key),
  );
  const omitted = snapshot.omissions.map(
    (item) =>
      `${reportSectionLabel(item.key)} (${OMISSION_LABELS[item.reason]})`,
  );
  const attachmentCopy = input.hasPdf
    ? "Your PDF report is attached."
    : "Your report snapshot has been generated.";
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#172033;max-width:640px">
    <h1 style="color:${snapshot.branding.primaryColor}">${escapeReportHtml(snapshot.branding.brandName)} SEO report</h1>
    <p><strong>${escapeReportHtml(snapshot.project.name)}</strong><br>${escapeReportHtml(period)}</p>
    <p>${escapeReportHtml(attachmentCopy)}</p>
    ${available.length > 0 ? `<p><strong>Included:</strong> ${available.map(escapeReportHtml).join(", ")}</p>` : ""}
    ${omitted.length > 0 ? `<p><strong>Not included:</strong> ${omitted.map(escapeReportHtml).join(", ")}</p>` : ""}
    <p style="color:#6b7280;font-size:12px">Generated by OpenSEO.</p>
  </div>`;
  const text = [
    `${snapshot.branding.brandName} SEO report`,
    snapshot.project.name,
    period,
    "",
    attachmentCopy,
    available.length > 0 ? `Included: ${available.join(", ")}` : "",
    omitted.length > 0 ? `Not included: ${omitted.join(", ")}` : "",
    "",
    "Generated by OpenSEO.",
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
  return { html, text };
}
