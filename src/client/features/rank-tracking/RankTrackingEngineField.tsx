import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";

export function RankTrackingEngineField({
  engine,
  isEdit,
  onChange,
}: {
  engine: RankTrackingConfig["engine"];
  isEdit: boolean;
  onChange: (engine: RankTrackingConfig["engine"]) => void;
}) {
  return (
    <div className="form-control">
      <label className="label">
        <span className="label-text font-medium">Search Engine</span>
      </label>
      <select
        className="select select-bordered w-full"
        value={engine}
        disabled={isEdit}
        onChange={(event) => {
          if (
            event.target.value === "google" ||
            event.target.value === "bing"
          ) {
            onChange(event.target.value);
          }
        }}
      >
        <option value="google">Google</option>
        <option value="bing">Bing</option>
      </select>
      <div className="mt-1.5 text-xs text-base-content/50">
        Search engine cannot be changed after this tracker is created.
        {engine === "bing"
          ? " Bing checks use the queued API and crawl the full selected depth."
          : ""}
      </div>
    </div>
  );
}
