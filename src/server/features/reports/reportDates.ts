type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function localParts(date: Date, timeZone: string): LocalDateTime {
  const values = Object.fromEntries(
    formatter(timeZone)
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
  };
}

function partsAsUtc(parts: LocalDateTime): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function fromLocalParts(parts: LocalDateTime, timeZone: string): Date {
  let guess = partsAsUtc(parts);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localParts(new Date(guess), timeZone);
    const correction = partsAsUtc(parts) - partsAsUtc(observed);
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function dateString(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function previousFullCalendarMonth(
  at: Date,
  timeZone: string,
): {
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
} {
  if (!isValidTimeZone(timeZone)) throw new Error("Invalid report timezone");
  const local = localParts(at, timeZone);
  const current = shiftMonth(local.year, local.month, -1);
  const previous = shiftMonth(local.year, local.month, -2);
  return {
    periodStart: dateString(current.year, current.month, 1),
    periodEnd: dateString(
      current.year,
      current.month,
      lastDay(current.year, current.month),
    ),
    compareStart: dateString(previous.year, previous.month, 1),
    compareEnd: dateString(
      previous.year,
      previous.month,
      lastDay(previous.year, previous.month),
    ),
  };
}

export function comparisonPeriod(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const durationDays =
    Math.round((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
  const compareEnd = new Date(start.valueOf() - 86_400_000);
  const compareStart = new Date(
    compareEnd.valueOf() - (durationDays - 1) * 86_400_000,
  );
  return {
    compareStart: compareStart.toISOString().slice(0, 10),
    compareEnd: compareEnd.toISOString().slice(0, 10),
  };
}

/**
 * Collapse every occurrence a stopped deployment missed into one claim: the
 * latest occurrence that has already passed, plus the first one still ahead.
 *
 * Advancing a single month per tick would make an overdue schedule due again
 * immediately, so each cron tick would start another report until the schedule
 * caught up. Reporting on the newest missed occurrence only — the caller still
 * decides whether its period is current — keeps that to one report.
 */
export function resolveDueMonthlyOccurrence(input: {
  scheduledFor: Date;
  now: Date;
  timeZone: string;
  runDay: number;
  runHour: number;
}): { occurrence: string; nextRunAt: string } {
  let occurrence = input.scheduledFor;
  // Bounded so a corrupt anchor can't spin; 20 years of monthly occurrences.
  for (let step = 0; step < 240; step += 1) {
    const next = new Date(nextMonthlyRun({ ...input, after: occurrence }));
    if (next > input.now) {
      return {
        occurrence: occurrence.toISOString(),
        nextRunAt: next.toISOString(),
      };
    }
    occurrence = next;
  }
  return {
    occurrence: occurrence.toISOString(),
    nextRunAt: nextMonthlyRun({ ...input, after: input.now }),
  };
}

export function nextMonthlyRun(input: {
  after: Date;
  timeZone: string;
  runDay: number;
  runHour: number;
}): string {
  if (!isValidTimeZone(input.timeZone))
    throw new Error("Invalid report timezone");
  const local = localParts(input.after, input.timeZone);
  let target = {
    year: local.year,
    month: local.month,
    day: input.runDay,
    hour: input.runHour,
    minute: 0,
    second: 0,
  };
  let instant = fromLocalParts(target, input.timeZone);
  if (instant.valueOf() <= input.after.valueOf()) {
    const next = shiftMonth(target.year, target.month, 1);
    target = { ...target, ...next };
    instant = fromLocalParts(target, input.timeZone);
  }
  return instant.toISOString();
}
