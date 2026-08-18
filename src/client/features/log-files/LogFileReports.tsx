import type { getLogFileReport } from "@/serverFunctions/log-files";

type ReportPayload = NonNullable<Awaited<ReturnType<typeof getLogFileReport>>>;

export function LogFileReports({
  summary,
  reports,
}: {
  summary: {
    linesParsed: number;
    linesSkipped: number;
    dateFrom: string | null;
    dateTo: string | null;
    format: string | null;
    bots: {
      botId: string;
      label: string;
      requests: number;
      verifiedRequests: number;
      unverifiedRequests: number;
    }[];
  };
  reports: ReportPayload["reports"];
}) {
  return (
    <>
      <section className="card border border-base-300">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Parse summary</h2>
          <p className="text-sm">
            {summary.linesParsed.toLocaleString()} lines parsed,{" "}
            {summary.linesSkipped.toLocaleString()} skipped
            {summary.format ? ` · ${summary.format}` : ""}
            {summary.dateFrom && summary.dateTo
              ? ` · ${summary.dateFrom} to ${summary.dateTo}`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {summary.bots.map((bot) => (
              <span key={bot.botId} className="badge badge-outline">
                {bot.label}: {bot.verifiedRequests}/{bot.requests} verified
              </span>
            ))}
            {summary.bots.length === 0 ? (
              <span className="text-sm text-base-content/60">
                No known crawlers in this file.
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-base">Crawl budget</h2>
          <SimpleTable
            headers={["Day", "Bot", "Verified", "Claimed"]}
            rows={reports.crawlBudget.map((row) => [
              row.day,
              row.label,
              String(row.verifiedRequests),
              String(row.requests),
            ])}
            empty="No crawler requests in the selected log."
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Most crawled paths</h2>
            <SimpleTable
              headers={["Path", "Requests"]}
              rows={reports.mostCrawled.map((row) => [
                row.path,
                String(row.requests),
              ])}
              empty="No crawled paths."
            />
          </div>
        </section>
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Never crawled</h2>
            <p className="text-xs text-base-content/50">
              Latest site-audit pages with no matching bot request.
            </p>
            <SimpleTable
              headers={["Path"]}
              rows={reports.neverCrawled.map((path) => [path])}
              empty="Every audited page was crawled, or there is no audit yet."
            />
          </div>
        </section>
      </div>

      <section className="card border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-base">Status codes</h2>
          <SimpleTable
            headers={["Bot", "2xx", "3xx", "4xx", "5xx"]}
            rows={reports.statusDistribution.map((row) => [
              row.label,
              String(row.status2xx),
              String(row.status3xx),
              String(row.status4xx),
              String(row.status5xx),
            ])}
            empty="No status data."
          />
          {reports.errorPaths.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-semibold">4xx / 5xx paths</h3>
              <SimpleTable
                headers={["Bot", "Path", "4xx", "5xx"]}
                rows={reports.errorPaths.map((row) => [
                  row.label,
                  row.path,
                  String(row.status4xx),
                  String(row.status5xx),
                ])}
                empty=""
              />
            </>
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Frequency vs depth</h2>
            <SimpleTable
              headers={["Depth", "Requests", "Paths"]}
              rows={reports.frequencyByDepth.map((row) => [
                String(row.depth),
                String(row.requests),
                String(row.paths),
              ])}
              empty="No depth data. Run a site audit to join crawl depth."
            />
          </div>
        </section>
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Frequency vs sitemap</h2>
            <SimpleTable
              headers={["In sitemap", "Requests", "Paths"]}
              rows={reports.frequencyBySitemap.map((row) => [
                String(row.inSitemap),
                String(row.requests),
                String(row.paths),
              ])}
              empty="No sitemap join data."
            />
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Average response time</h2>
            <SimpleTable
              headers={["Bot", "Average ms", "Samples"]}
              rows={reports.responseTimes.map((row) => [
                row.label,
                row.averageMs == null ? "—" : String(row.averageMs),
                String(row.samples),
              ])}
              empty="No response times in the log."
            />
          </div>
        </section>
        <section className="card border border-base-300">
          <div className="card-body">
            <h2 className="card-title text-base">Orphans</h2>
            <p className="text-xs text-base-content/50">
              Bot-crawled paths the latest site audit never discovered.
            </p>
            <SimpleTable
              headers={["Path", "Requests"]}
              rows={reports.orphans.map((row) => [
                row.path,
                String(row.requests),
              ])}
              empty="No orphan paths."
            />
          </div>
        </section>
      </div>
    </>
  );
}

function SimpleTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return empty ? (
      <p className="text-sm text-base-content/60">{empty}</p>
    ) : null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                <td
                  key={`${headers[index]}:${cell}`}
                  className="max-w-md truncate"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
