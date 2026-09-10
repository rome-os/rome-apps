// Compute a review "streak": the number of consecutive calendar days (in the
// given IANA timezone), ending today or yesterday, on which at least one review
// happened. Used by get_dashboard_data.

function dayKey(ms: number, timeZone: string): string {
  // en-CA yields YYYY-MM-DD, which sorts and compares lexicographically.
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  }
}

function previousDay(key: string): string {
  // key is YYYY-MM-DD; step back one UTC day (timezone-agnostic for keys).
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function computeStreak(
  reviewTimestamps: number[],
  timeZone = "UTC",
  now: number = Date.now(),
): number {
  if (reviewTimestamps.length === 0) return 0;
  const days = new Set(reviewTimestamps.map((ms) => dayKey(ms, timeZone)));
  const today = dayKey(now, timeZone);
  const yesterday = previousDay(today);

  // The streak only counts if a review happened today or yesterday — otherwise
  // it has lapsed.
  let cursor: string;
  if (days.has(today)) cursor = today;
  else if (days.has(yesterday)) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}
