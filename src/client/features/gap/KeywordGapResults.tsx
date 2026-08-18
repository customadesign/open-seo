import { Download, Save } from "lucide-react";
import { buildCsv, downloadCsv } from "@/client/lib/csv";
import {
  KEYWORD_GAP_CLASSIFICATIONS,
  keywordMatchesTerms,
  parseGapFilterTerms,
  type KeywordGapClassification,
} from "@/shared/gap";
import type { KeywordGapSearchParams } from "@/types/schemas/gap";

export const CLASSIFICATION_LABELS: Record<KeywordGapClassification, string> = {
  shared: "Shared",
  missing: "Missing",
  weak: "Weak",
  strong: "Strong",
  untapped: "Untapped",
  unique: "Unique",
};

export type KeywordGapRow = {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  cpc: number | null;
  classification: KeywordGapClassification;
  positions: Record<string, number | null>;
};

export function filterKeywordGapRows(
  rows: KeywordGapRow[],
  search: KeywordGapSearchParams,
) {
  const classification = KEYWORD_GAP_CLASSIFICATIONS.find(
    (value) => value === search.classification,
  );
  const include = parseGapFilterTerms(search.include);
  const exclude = parseGapFilterTerms(search.exclude);
  const intents = parseGapFilterTerms(search.intent);
  return rows.filter((row) => {
    if (classification && row.classification !== classification) return false;
    if (
      search.minVol != null &&
      (row.searchVolume == null || row.searchVolume < search.minVol)
    ) {
      return false;
    }
    if (
      search.maxVol != null &&
      (row.searchVolume == null || row.searchVolume > search.maxVol)
    ) {
      return false;
    }
    if (
      search.minKd != null &&
      (row.keywordDifficulty == null || row.keywordDifficulty < search.minKd)
    ) {
      return false;
    }
    if (
      search.maxKd != null &&
      (row.keywordDifficulty == null || row.keywordDifficulty > search.maxKd)
    ) {
      return false;
    }
    if (intents.length > 0 && !intents.includes(row.intent ?? "unknown")) {
      return false;
    }
    return keywordMatchesTerms(row.keyword, include, exclude);
  });
}

export function KeywordGapResults({
  baseDomain,
  domains,
  rows,
  search,
  selected,
  saving,
  onFilterChange,
  onSave,
  onSelectAll,
  onToggle,
}: {
  baseDomain: string | undefined;
  domains: string[];
  rows: KeywordGapRow[];
  search: KeywordGapSearchParams;
  selected: Set<string>;
  saving: boolean;
  onFilterChange: (update: Partial<KeywordGapSearchParams>) => void;
  onSave: () => void;
  onSelectAll: (checked: boolean) => void;
  onToggle: (keyword: string, checked: boolean) => void;
}) {
  return (
    <section className="card border border-base-300 bg-base-100">
      <div className="card-body gap-4">
        <KeywordGapFilters search={search} onChange={onFilterChange} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm gap-1"
            disabled={selected.size === 0 || saving}
            onClick={onSave}
          >
            <Save className="size-3.5" /> Save selected
          </button>
          <button
            type="button"
            className="btn btn-sm gap-1"
            onClick={() =>
              downloadCsv(
                `keyword-gap-${baseDomain}.csv`,
                buildCsv(
                  [
                    "keyword",
                    "classification",
                    "volume",
                    "difficulty",
                    "intent",
                    "cpc",
                    ...domains,
                  ],
                  rows.map((row) => [
                    row.keyword,
                    row.classification,
                    row.searchVolume,
                    row.keywordDifficulty,
                    row.intent,
                    row.cpc,
                    ...domains.map((domain) => row.positions[domain] ?? ""),
                  ]),
                ),
              )
            }
          >
            <Download className="size-3.5" /> Export CSV
          </button>
          <span className="self-center text-xs text-base-content/60">
            {rows.length} keywords
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(event) => onSelectAll(event.target.checked)}
                  />
                </th>
                <th>Keyword</th>
                <th>Class</th>
                <th>Volume</th>
                <th>KD</th>
                <th>Intent</th>
                <th>CPC</th>
                {domains.map((domain) => (
                  <th key={domain}>{domain}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.keyword}>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={selected.has(row.keyword)}
                      onChange={(event) =>
                        onToggle(row.keyword, event.target.checked)
                      }
                    />
                  </td>
                  <td>{row.keyword}</td>
                  <td>{CLASSIFICATION_LABELS[row.classification]}</td>
                  <td>{row.searchVolume ?? "—"}</td>
                  <td>{row.keywordDifficulty ?? "—"}</td>
                  <td>{row.intent ?? "—"}</td>
                  <td>{row.cpc ?? "—"}</td>
                  {domains.map((domain) => (
                    <td key={domain}>{row.positions[domain] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function KeywordGapFilters({
  search,
  onChange,
}: {
  search: KeywordGapSearchParams;
  onChange: (update: Partial<KeywordGapSearchParams>) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <label className="form-control">
        <span className="label-text mb-1">Classification</span>
        <select
          className="select select-bordered select-sm"
          value={search.classification ?? ""}
          onChange={(event) =>
            onChange({ classification: event.target.value || undefined })
          }
        >
          <option value="">All</option>
          {KEYWORD_GAP_CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {CLASSIFICATION_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="form-control">
        <span className="label-text mb-1">Min volume</span>
        <input
          className="input input-bordered input-sm"
          type="number"
          value={search.minVol ?? ""}
          onChange={(event) =>
            onChange({
              minVol: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
        />
      </label>
      <label className="form-control">
        <span className="label-text mb-1">Max KD</span>
        <input
          className="input input-bordered input-sm"
          type="number"
          value={search.maxKd ?? ""}
          onChange={(event) =>
            onChange({
              maxKd: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
        />
      </label>
      <label className="form-control">
        <span className="label-text mb-1">Include</span>
        <input
          className="input input-bordered input-sm"
          value={search.include ?? ""}
          onChange={(event) =>
            onChange({ include: event.target.value || undefined })
          }
        />
      </label>
      <label className="form-control">
        <span className="label-text mb-1">Exclude</span>
        <input
          className="input input-bordered input-sm"
          value={search.exclude ?? ""}
          onChange={(event) =>
            onChange({ exclude: event.target.value || undefined })
          }
        />
      </label>
      <label className="form-control">
        <span className="label-text mb-1">Intent</span>
        <input
          className="input input-bordered input-sm"
          value={search.intent ?? ""}
          placeholder="informational"
          onChange={(event) =>
            onChange({ intent: event.target.value || undefined })
          }
        />
      </label>
    </div>
  );
}
