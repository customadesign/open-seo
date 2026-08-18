/**
 * Parse a timestamp read out of the database to epoch milliseconds.
 *
 * App-written values are ISO strings, but SQLite's `current_timestamp` default
 * produces `YYYY-MM-DD HH:MM:SS` with no timezone marker — which `Date.parse`
 * reads as LOCAL time. Freshness comparisons on a DB-defaulted row would then be
 * off by the deployment's UTC offset. Both forms are treated as UTC here.
 *
 * Returns null for anything unparseable so callers decide what an unknown
 * timestamp means rather than silently getting NaN arithmetic.
 */
export function parseDbTimestampMs(value: string): number | null {
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}
