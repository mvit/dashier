/**
 * Dates are stored as ISO strings ("2024-01-03", or "2024-01-03T14:05" when there's a time of day), so they
 * sort, compare and join as plain strings. These helpers parse them, bucket them into a Year → Quarter →
 * Month → Day hierarchy, and turn relative ranges ("last 3 months") into ISO bounds.
 */
export type DatePart = 'year' | 'quarter' | 'month' | 'day';
export type DateUnit = 'day' | 'week' | 'month' | 'year';

/** A month's English name, 1 being January: "January" (long) or "Jan" (short). */
export const monthName = (m: number, style: 'long' | 'short' = 'short') => new Date(2000, m - 1, 1).toLocaleString('en-US', { month: style });
// the short names once: labels ask for them often
const MONTHS = Array.from({ length: 12 }, (_, i) => monthName(i + 1));

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number, h = 0, min = 0) =>
  `${y}-${pad(m)}-${pad(d)}${h || min ? `T${pad(h)}:${pad(min)}` : ''}`;
const dateISO = (d: Date, h = 0, min = 0) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate(), h, min);
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();

/** Normalizes a date-like value to an ISO date string, or null when it isn't one. `dayFirst` reads 05/01/2024 as 5 Jan. */
export function toISODate(v: unknown, dayFirst = false): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  // 2024-01-03, 2024-01-03T10:00, 2024-01-03 10:00:00, with an optional zone (kept as written, not shifted)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
  // 1/3/2024 (month first, unless the column's dates are day first or this one can only be), 3.1.2024 (day first)
  m = /^(\d{1,2})([/.])(\d{1,2})\2(\d{4})$/.exec(s);
  if (m) {
    const [a, b, y] = [+m[1], +m[3], +m[4]];
    const [mo, d] = m[2] === '.' || a > 12 || dayFirst ? [b, a] : [a, b];
    return valid(y, mo, d) ? iso(y, mo, d) : null;
  }
  // "Jan 3, 2024", "3 January 2024": only text with a month name and a 4-digit year
  if (!/[a-z]{3}/i.test(s) || !/\d{4}/.test(s)) return null;
  const t = new Date(s);
  return isNaN(+t) ? null : dateISO(t, t.getHours(), t.getMinutes());
}

/** True when a column's slashed dates are day first: one of them starts above 12 (so 05/01/2024 is 5 Jan, like 13/01/2024). */
export const dayFirst = (values: Iterable<unknown>) => {
  for (const v of values) if (+(/^\s*(\d\d?)\/\d\d?\/\d{4}\s*$/.exec(String(v))?.[1] ?? 0) > 12) return true;
  return false;
};

/** The bucket a date falls in; keys sort chronologically as strings. */
export function datePartKey(isoDate: string, part: DatePart): string {
  if (!isoDate) return '';
  const y = isoDate.slice(0, 4);
  return part === 'year' ? y : part === 'quarter' ? `${y} Q${Math.ceil(+isoDate.slice(5, 7) / 3)}` : isoDate.slice(0, part === 'month' ? 7 : 10);
}

/** How a bucket key reads: months as "Jan 2024", the rest as their key. */
export const datePartLabel = (key: string, part?: DatePart) =>
  part === 'month' && /^\d{4}-\d{2}$/.test(key) ? `${MONTHS[+key.slice(5) - 1]} ${key.slice(0, 4)}` : key;

/** ISO bounds of "the last `n` `unit`s", up to and including today. */
export function lastRange(n: number, unit: DateUnit, today = new Date()): { from: string; to: string } {
  const to = dateISO(today);
  // n days or weeks back, or the day after the same day n months back (the month's last day when it's shorter: 31 Mar → 28 Feb)
  const from = unit === 'day' || unit === 'week' ? addDays(to, 1 - (unit === 'week' ? 7 : 1) * n) : addDays(addMonths(to, -(unit === 'year' ? 12 : 1) * n), 1);
  return { from, to };
}

/** An ISO date `n` months on (back when negative), on the same day or its month's last: 31 Mar − 1 month = 28 Feb. */
const addMonths = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  return dateISO(new Date(t.getFullYear(), t.getMonth(), Math.min(d || 1, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())));
};
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return dateISO(new Date(y, m - 1, d + n));
};

/** A comparison's other period: the one before (`period`, of the same kind) or a year back. */
export type Shift = 'period' | 'year';

/** A bucket key moved back (`n` −1) or ahead (1): 2025 Q4 → 2025 Q3 (period) or 2024 Q4 (year). */
export function shiftKey(key: string, part: DatePart, by: Shift, n = -1): string {
  const y = +key.slice(0, 4);
  if (part === 'day') return by === 'year' ? addMonths(key, 12 * n) : addDays(key, n);
  if (by === 'year' || part === 'year') return y + n + key.slice(4);
  if (part === 'month') return addMonths(key + '-01', n).slice(0, 7);
  const q = +key.slice(6) - 1 + n;
  return `${y + Math.floor(q / 4)} Q${(q + 4) % 4 + 1}`;
}

/** A range moved back a year, or by its own length (whole months when it covers whole months, else days). */
export function shiftRange(from: string, to: string, by: Shift): { from: string; to: string } {
  if (by === 'year') return { from: addMonths(from, -12), to: addMonths(to, -12) };
  const months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + +to.slice(5, 7) - +from.slice(5, 7) + 1;
  if (from.slice(8, 10) === '01' && addDays(to, 1).slice(8, 10) === '01') return { from: addMonths(from, -months), to: addDays(addMonths(addDays(to, 1), -months), -1) };
  const days = (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 864e5 + 1;
  return { from: addDays(from, -days), to: addDays(to, -days) };
}

/** True when an ISO date lies in [from, to] (whole days; either bound may be open). */
export const inRange = (v: string, from?: string, to?: string) => !!v && (!from || v >= from) && (!to || v.slice(0, 10) <= to);
