export function periodKeyFromDate(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function periodKeyMonthsAgo(months: number, date = new Date()): string {
  const cutoff = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1),
  );
  return periodKeyFromDate(cutoff);
}
