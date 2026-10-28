import { DashFilter } from '../types/model';
import { Shift, datePartKey, inRange, lastRange, shiftKey, shiftRange } from './dates';

/**
 * A filter as a test of one value: among `values` (compared as the `datePart` bucket for dates), within
 * min/max (numbers), within from/to (ISO dates), and within the last n days/weeks/months/years.
 */
export function filterTest(f: DashFilter): (v: unknown) => boolean {
  const range = f.last ? lastRange(f.last.n, f.last.unit) : f.from || f.to ? { from: f.from, to: f.to } : null;
  const text = f.match === 'key' ? keyText : String;
  const values = f.values?.length ? new Set(f.values.map(text)) : null;
  return (v) => {
    if (values && !values.has(f.datePart ? datePartKey(String(v ?? ''), f.datePart) : text(v))) return false;
    if (f.min != null || f.max != null) {
      const n = v == null || !String(v).trim() ? NaN : Number(v); // a blank isn't 0
      if (!(n >= (f.min ?? -Infinity) && n <= (f.max ?? Infinity))) return false;
    }
    return !range || inRange(String(v ?? ''), range.from, range.to);
  };
}

/**
 * `own` date filters moved to the comparison's other period (`isDate` tells which are dates): picked buckets one
 * back or a year back, a range (between, or the last n days) by its length or a year. Others aren't returned.
 */
export const shiftFilters = (own: DashFilter[] = [], by: Shift, isDate: (f: DashFilter) => boolean): DashFilter[] =>
  own.flatMap((f): DashFilter[] => {
    if (!isDate(f)) return [];
    if (f.values?.length) return [{ ...f, values: f.values.map(v => shiftKey(v, f.datePart ?? 'day', by)) }];
    const r = f.last ? lastRange(f.last.n, f.last.unit) : f.from && f.to ? { from: f.from, to: f.to } : null;
    return r ? [{ ...f, last: undefined, ...shiftRange(r.from, r.to, by) }] : [];
  });

/** `own` filters with `by` in place of those on the same fields (a comparison's other period, say). */
export const replaceFilters = (own: DashFilter[] = [], by: DashFilter[] = []) =>
  [...own.filter(f => !by.some(g => g.field === f.field && (g.table ?? '') === (f.table ?? ''))), ...by];

/** Text that is wholly a number ("-1.5", "1e3"; not "1,234", "0x1A" or "Infinity"). */
export const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * A value as relationship keys compare it, as Power BI does: numbers by value ("2024.0" is 2024; a code with a
 * leading zero stays text), text trimmed and ignoring case, a date without a midnight time.
 */
export const keyText = (v: unknown): string => {
  if (typeof v === 'number') return String(v);
  const s = String(v ?? '').trim();
  return NUMBER.test(s) && !/^[-+]?0\d/.test(s) ? String(+s) : s.replace(/[T ]00:00(:00)?$/, '').toLowerCase();
};

const collate = new Intl.Collator(undefined, { numeric: true }).compare;
/** Natural text order ("Q2" before "Q10"), numbers by value ("-2.5" before "-1.25"), from one shared collator. */
export const compareText = (a: string, b: string) => (NUMBER.test(a) && NUMBER.test(b) ? +a - +b || collate(a, b) : collate(a, b));

/** No value: null, undefined or empty text. */
export const isBlank = (v: unknown): boolean => v == null || v === '';

/** Numbers by value, text naturally, blanks (as `blank` tells them) last. */
export const compareValues = (a: unknown, b: unknown, blank = isBlank) =>
  blank(a) ? (blank(b) ? 0 : 1) : blank(b) ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : compareText(String(a), String(b));

/** Distinct values beyond this many are ordered by plain code-unit comparison: a collator is too slow for millions. */
const COLLATE_MAX = 50_000;

/** Sorts strings in natural order (plain order for very many). */
export const sortText = (values: string[]) => (values.length > COLLATE_MAX ? values.sort() : values.sort(compareText));

/**
 * The order of `n` values read by position: numbers numerically, text in natural order, blanks last. Text is
 * ranked once per distinct value, so millions sort in about a second instead of collating every comparison.
 */
export function sortOrder(n: number, read: (k: number) => unknown, desc = false): Int32Array {
  const values = Array.from({ length: n }, (_, k) => read(k));
  let key: (v: any) => number;
  if (values.every(v => isBlank(v) || typeof v === 'number')) key = v => v;
  else {
    const rank = new Map(sortText([...new Set(values.filter(v => !isBlank(v)).map(String))]).map((v, i) => [v, i]));
    key = v => rank.get(String(v))!;
  }
  // descending negates the keys, so blanks stay last
  const dir = desc ? -1 : 1;
  const keys = values.map(v => (isBlank(v) ? null : key(v) * dir));
  const order = Int32Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => compareValues(keys[a], keys[b]));
  return order;
}
