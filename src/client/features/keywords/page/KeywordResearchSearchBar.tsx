import { Info, Search } from "lucide-react";
import { getFieldError } from "@/client/lib/forms";
import { MAX_KEYWORDS_PER_SUBMIT } from "@/client/features/keywords/keywordResearchTypes";
import { useKeywordSearchParams } from "@/client/features/keywords/state/keywordControllerInternals";
import {
  KEYWORD_MAGIC_SCALE_OPTIONS,
  clampKeywordMagicScale,
} from "@/shared/keyword-magic";
import { isLabsLocationCode } from "@/client/features/keywords/locations";
import { LocationSelect } from "@/client/components/LocationSelect";
import type { KeywordResearchControllerState } from "./types";

type Props = {
  controller: KeywordResearchControllerState;
};

function getTextareaRows(value: string): number {
  const newlines = (value.match(/\n/g) ?? []).length;
  const lines = newlines + 1;
  return Math.min(MAX_KEYWORDS_PER_SUBMIT, Math.max(1, lines));
}

export function KeywordResearchSearchBar({ controller }: Props) {
  const { controlsForm, handleSearchSubmit, scale } = controller;
  const setSearchParams = useKeywordSearchParams();

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-2">
        <form
          className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:gap-2"
          onSubmit={handleSearchSubmit}
        >
          <controlsForm.Field name="keyword">
            {(field) => {
              const keywordError = getFieldError(field.state.meta.errors);
              const rows = getTextareaRows(field.state.value);

              return (
                <label
                  className={`flex w-full lg:flex-1 lg:min-w-0 lg:max-w-md items-start gap-2 rounded-lg border bg-base-100 px-4 py-3 transition-colors focus-within:border-primary ${
                    keywordError ? "border-error" : "border-base-300"
                  }`}
                >
                  <Search className="mt-0.5 size-4 shrink-0 text-base-content/60" />
                  <textarea
                    className="grow min-w-0 resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-base-content/40"
                    rows={rows}
                    placeholder="Enter a keyword"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter submits. Shift+Enter inserts a newline, so
                      // researching several keywords at once means adding a
                      // line per keyword (or pasting newline-separated ones).
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void controlsForm.handleSubmit();
                      }
                    }}
                  />
                </label>
              );
            }}
          </controlsForm.Field>

          <div className="grid grid-cols-2 gap-2 lg:contents">
            <controlsForm.Field name="locationCode">
              {(field) => (
                <LocationSelect
                  value={field.state.value}
                  onChange={(code) => field.handleChange(code)}
                  className="w-full lg:w-44 lg:shrink-0"
                />
              )}
            </controlsForm.Field>

            <select
              className="select select-bordered w-full lg:w-auto lg:shrink-0"
              value={scale}
              onChange={(event) =>
                setSearchParams({
                  scale: clampKeywordMagicScale(Number(event.target.value)),
                })
              }
            >
              {KEYWORD_MAGIC_SCALE_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  Up to {limit.toLocaleString()} keywords
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="btn btn-primary w-full px-6 lg:w-auto lg:shrink-0"
            >
              Search
            </button>
          </div>
        </form>
        <controlsForm.Field name="keyword">
          {(field) => {
            const keywordError = getFieldError(field.state.meta.errors);

            return keywordError ? (
              <p className="text-sm text-error">{keywordError}</p>
            ) : null;
          }}
        </controlsForm.Field>
        <controlsForm.Field name="locationCode">
          {(locationField) =>
            isLabsLocationCode(locationField.state.value) ? (
              <controlsForm.Field name="clickstream">
                {(field) => (
                  <div className="flex items-center gap-2">
                    <label className="label cursor-pointer justify-start gap-2 p-0">
                      <input
                        type="checkbox"
                        className="toggle toggle-sm toggle-primary"
                        checked={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.checked)
                        }
                      />
                      <span className="text-sm font-medium text-base-content/80">
                        Clickstream-refined volumes
                      </span>
                    </label>
                    <div
                      className="tooltip tooltip-right"
                      data-tip="Google reports one combined search volume for similar keywords (e.g. 'seo tool' and 'seo tools'). Turn this on to estimate each keyword's own volume. Costs 2x the credits."
                    >
                      <Info className="size-3.5 text-base-content/50" />
                    </div>
                  </div>
                )}
              </controlsForm.Field>
            ) : (
              <div
                className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-base-content/80"
                role="status"
              >
                <Info className="mt-0.5 size-4 shrink-0 text-info" />
                <span>
                  Keyword data for this country comes from Google Ads — search
                  volume, CPC, and trends are available, but difficulty and
                  intent are not.
                </span>
              </div>
            )
          }
        </controlsForm.Field>
      </div>
    </div>
  );
}
