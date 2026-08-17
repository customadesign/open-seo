import { Info } from "lucide-react";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";

type Schedule = RankTrackingConfig["scheduleInterval"];

function isSchedule(value: string): value is Schedule {
  return (
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "manual"
  );
}

/**
 * Cadence plus the credit ceiling that authorizes it. The two belong together:
 * a non-manual cadence is a standing authorization to spend, and the server
 * refuses to save one without a positive ceiling.
 */
export function RankTrackingScheduleField({
  schedule,
  onScheduleChange,
  ceiling,
  onCeilingChange,
}: {
  schedule: Schedule;
  onScheduleChange: (schedule: Schedule) => void;
  ceiling: string;
  onCeilingChange: (ceiling: string) => void;
}) {
  return (
    <>
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Schedule</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={schedule}
          onChange={(e) => {
            if (isSchedule(e.target.value)) onScheduleChange(e.target.value);
          }}
        >
          <option value="manual">Manual only</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly (end of month)</option>
        </select>
        {schedule === "daily" && (
          <div className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
            <Info className="size-3.5 shrink-0 mt-0.5" />
            <span>Daily checks use 7x more credits than weekly</span>
          </div>
        )}
        <div className="mt-1.5 text-xs text-base-content/50">
          Manual only never spends credits on its own. Any other cadence
          authorizes recurring spend.
        </div>
      </div>

      {schedule !== "manual" && (
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">
              Approved credits per check
            </span>
          </label>
          <input
            type="number"
            min={1}
            step={1}
            className="input input-bordered w-full"
            value={ceiling}
            onChange={(e) => onCeilingChange(e.target.value)}
          />
          <div className="mt-1.5 text-xs text-base-content/50">
            Required for a recurring schedule. A check whose estimate exceeds
            this ceiling is skipped instead of run, so adding keywords can never
            quietly raise your recurring bill. Raise the ceiling to resume.
          </div>
        </div>
      )}
    </>
  );
}
