import type { ReportFrequency } from "@/types/schemas/reports";

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function formatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

export function isValidTimezone(timezone: string): boolean {
  try {
    formatter(timezone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function getLocalDateTime(date: Date, timezone: string): LocalDateTime {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

function asUtc(parts: LocalDateTime): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

// Intl has no inverse timezone conversion. Iteratively correct an initial UTC
// guess until its displayed wall-clock parts equal the requested local parts.
function fromLocalDateTime(parts: LocalDateTime, timezone: string): Date {
  let guess = asUtc(parts);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = getLocalDateTime(new Date(guess), timezone);
    const correction = asUtc(parts) - asUtc(observed);
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addWeekly(parts: LocalDateTime): LocalDateTime {
  const date = new Date(asUtc(parts));
  date.setUTCDate(date.getUTCDate() + 7);
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function shiftMonthly(parts: LocalDateTime, delta: 1 | -1): LocalDateTime {
  const monthIndex = parts.month - 1 + delta;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const targetLastDay = daysInMonth(year, month);
  const anchoredToMonthEnd = parts.day === daysInMonth(parts.year, parts.month);
  return {
    ...parts,
    year,
    month,
    day: anchoredToMonthEnd
      ? targetLastDay
      : Math.min(parts.day, targetLastDay),
  };
}

/** Advances from the previous scheduled instant while preserving its local
 * wall-clock time. This avoids DST drift from fixed millisecond arithmetic. */
export function calculateNextReportRun(
  frequency: ReportFrequency,
  timezone: string,
  from: Date,
): string | null {
  if (frequency === "manual") return null;
  if (!isValidTimezone(timezone)) throw new Error("Invalid report timezone");

  const local = getLocalDateTime(from, timezone);
  const next =
    frequency === "weekly" ? addWeekly(local) : shiftMonthly(local, 1);
  return fromLocalDateTime(next, timezone).toISOString();
}

export function calculatePreviousReportRun(
  frequency: Exclude<ReportFrequency, "manual">,
  timezone: string,
  from: Date,
): string {
  if (!isValidTimezone(timezone)) throw new Error("Invalid report timezone");
  const local = getLocalDateTime(from, timezone);
  if (frequency === "monthly") {
    return fromLocalDateTime(shiftMonthly(local, -1), timezone).toISOString();
  }
  const date = new Date(asUtc(local));
  date.setUTCDate(date.getUTCDate() - 7);
  return fromLocalDateTime(
    {
      ...local,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    },
    timezone,
  ).toISOString();
}
