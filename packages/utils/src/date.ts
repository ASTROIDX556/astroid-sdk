/**
 * Date & time helpers. Astroid timestamps are ISO-8601 UTC strings.
 */

/** The current time as an ISO-8601 UTC string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Parse an ISO string (or Date) into a `Date`. Throws on invalid input. */
export function parseDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

/** Convert a Date (or ISO string) to an ISO-8601 UTC string. */
export function toIso(value: string | Date): string {
  return parseDate(value).toISOString();
}

/** Unix epoch seconds for a given date (defaults to now). */
export function unixSeconds(value: string | Date = new Date()): number {
  return Math.floor(parseDate(value).getTime() / 1000);
}

/** Whether an expiry timestamp is in the past (optionally with skew seconds). */
export function isExpired(expiresAt: string | Date, skewSeconds = 0): boolean {
  return parseDate(expiresAt).getTime() <= Date.now() - skewSeconds * 1000;
}

/** Add seconds to a date and return a new ISO string. */
export function addSeconds(value: string | Date, seconds: number): string {
  return new Date(parseDate(value).getTime() + seconds * 1000).toISOString();
}

/** A compact relative-time string like "3m ago" or "in 2h". */
export function relativeTime(value: string | Date, from: Date = new Date()): string {
  const diffMs = parseDate(value).getTime() - from.getTime();
  const abs = Math.abs(diffMs);
  const units: Array<[string, number]> = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ];
  for (const [label, ms] of units) {
    if (abs >= ms) {
      const amount = Math.round(abs / ms);
      return diffMs < 0 ? `${amount}${label} ago` : `in ${amount}${label}`;
    }
  }
  return 'just now';
}
