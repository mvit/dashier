/**
 * Frames: what a visual reads. A frame is a table's columns plus which rows are in it (after filters), and,
 * for a visual that uses a connected table, which row of that table goes with each one. Rows are positions,
 * never copied objects: filtering 2M rows costs a 4-byte position each, joining two such tables two.
 * Plain field names read the frame's own table; "table.field" reads a joined one.
 */
import { DashFilter } from '../types/model';
import { Column, ColumnTable, cellOf, columnsFromRows } from './columns';
import { filterTest, keyText } from './data';
import { inferStructure } from './hydrate';

type Row = Record<string, unknown>;

/** One table's part of a frame: the row behind each frame row (−1 = none, from an outer join), or all rows in order. */
interface Part {
  table: ColumnTable;
  ids: Int32Array | null;
}

export interface Frame {
  length: number;
  base: Part;
  joined: Record<string, Part>;
}

const EMPTY_TABLE: ColumnTable = { length: 0, names: [], types: {}, columns: {} };

/** All rows of a table, in order. */
export const tableFrame = (table: ColumnTable = EMPTY_TABLE): Frame => ({ length: table.length, base: { table, ids: null }, joined: {} });

/** A frame over plain row objects (JSON data, tests). */
export const rowsFrame = (rows: Row[]) => tableFrame(columnsFromRows(rows, inferStructure(rows)));

/** The table part and column a field name reads, or null when the frame has no such field. */
function locate(f: Frame, field: string): [Part, Column] | null {
  if (field in f.base.table.columns) return [f.base, f.base.table.columns[field]];
  const t = Object.keys(f.joined).filter(t => field.startsWith(t + '.')).sort((a, b) => b.length - a.length)[0];
  const col = t && f.joined[t].table.columns[field.slice(t.length + 1)];
  return col ? [f.joined[t], col] : null;
}

const readAt = ([{ ids }, col]: [Part, Column]): ((k: number) => unknown) =>
  ids ? (k) => (ids[k] < 0 ? null : cellOf(col, ids[k])) : (k) => cellOf(col, k);

/** Reads a field by frame position; null when the frame has no such field. */
export function reader(f: Frame, field: string) {
  const at = locate(f, field);
  return at && readAt(at);
}

/** A frame of `length` rows with every table part mapped. */
const mapParts = (f: Frame, length: number, fn: (p: Part) => Part): Frame => ({
  length,
  base: fn(f.base),
  joined: Object.fromEntries(Object.entries(f.joined).map(([t, p]) => [t, fn(p)]))
});

/** The frame's rows at `positions` (in that order). */
export const subset = (f: Frame, positions: Int32Array) =>
  mapParts(f, positions.length, p => ({ table: p.table, ids: p.ids ? positions.map(k => p.ids![k]) : positions }));

/**
 * For a dictionary column (dates, repeated text): its words and each frame row's code (−1 = none), so work that
 * depends only on the value is done once per word, not once per row. Null for other columns.
 */
function codesOf(f: Frame, field: string): { words: string[]; code: (k: number) => number } | null {
  const at = locate(f, field);
  if (at?.[1].kind !== 'dict') return null;
  const [{ ids }, { codes, words }] = at as [Part, { codes: Uint32Array; words: string[] }];
  return { words, code: ids ? k => (ids[k] < 0 ? -1 : codes[ids[k]]) : k => codes[k] };
}

/** Rows passing every filter. Filters on fields the frame doesn't have are ignored. */
export function filterFrame(f: Frame, filters: DashFilter[]): Frame {
  const tests = filters.flatMap(flt => {
    const test = filterTest(flt), d = codesOf(f, flt.field);
    if (d) {
      // a dictionary column is tested once per word
      const pass = d.words.map(test), none = test(null);
      return [(k: number) => { const c = d.code(k); return c < 0 ? none : pass[c]; }];
    }
    const read = reader(f, flt.field);
    return read ? [(k: number) => test(read(k))] : [];
  });
  if (!tests.length) return f;
  const keep = new Int32Array(f.length);
  let n = 0;
  outer: for (let k = 0; k < f.length; k++) {
    for (const t of tests) if (!t(k)) continue outer;
    keep[n++] = k;
  }
  return n === f.length ? f : subset(f, keep.slice(0, n));
}

/** Every field the frame can read: its table's columns, then "table.field" for joined tables. */
export const frameFields = (f: Frame) => [...f.base.table.names, ...Object.entries(f.joined).flatMap(([t, p]) => p.table.names.map(n => `${t}.${n}`))];

/** Row objects for positions [start, end): only for what must be objects (rows on screen, templates). */
export function frameRows(f: Frame, start = 0, end = f.length): Row[] {
  const fields = frameFields(f);
  const readers = fields.map(n => reader(f, n)!);
  const out: Row[] = [];
  for (let k = start; k < Math.min(end, f.length); k++) out.push(Object.fromEntries(fields.map((n, i) => [n, readers[i](k)])));
  return out;
}

/**
 * Merges a connected table into a frame on `leftKey` = `rightKey` (keys compared as `keyText` does): every row of the
 * frame stays, with its matches (none: blanks). With `lookup` (the right table is the one side) a row takes the first
 * match only, so a repeated key never repeats rows. The other table's fields read as "name.field".
 */
export function joinFrame(left: Frame, leftKey: string, right: ColumnTable, rightKey: string, name: string, lookup = false): Frame {
  const rk = right.columns[rightKey];
  const lk = reader(left, leftKey);
  const byKey = new Map<string, number[]>();
  if (rk)
    for (let r = 0; r < right.length; r++) {
      const v = cellOf(rk, r);
      if (v == null || v === '') continue;
      const key = keyText(v);
      const list = byKey.get(key);
      list ? list.push(r) : byKey.set(key, [r]);
    }
  const hitsOf = (v: unknown) => (v == null || v === '' ? undefined : byKey.get(keyText(v))) ?? NONE;
  // a dictionary key column is looked up once per word
  const d = codesOf(left, leftKey);
  const per = d?.words.map(hitsOf);
  const hitsAt = (k: number) => (d ? (d.code(k) < 0 ? NONE : per![d.code(k)]) : hitsOf(lk?.(k)));
  let out: Frame;
  const outR: number[] = [];
  if (lookup) {
    // one row each: the frame's rows stay as they are
    for (let k = 0; k < left.length; k++) outR.push(hitsAt(k)[0]);
    out = mapParts(left, left.length, p => p);
  } else {
    const outL: number[] = [];
    for (let k = 0; k < left.length; k++) for (const r of hitsAt(k)) outL.push(k), outR.push(r);
    const at = Int32Array.from(outL);
    out = mapParts(left, at.length, p => ({ table: p.table, ids: p.ids ? at.map(k => p.ids![k]) : at }));
  }
  out.joined[name] = { table: right, ids: Int32Array.from(outR) };
  return out;
}
const NONE = [-1];

/** Distinct non-blank values of a field, as strings (dictionary columns answer from their dictionary). */
export function distinctOf(f: Frame, field: string, key: (v: unknown) => string = String): string[] {
  const at = locate(f, field);
  if (!at) return [];
  const [part, col] = at;
  if (col.kind === 'dict' && !part.ids && key === String) return col.words.filter(w => w !== '');
  const read = readAt(at);
  const seen = new Set<string>();
  for (let k = 0; k < f.length; k++) {
    const v = read(k);
    if (v != null && v !== '') seen.add(key(v));
  }
  return [...seen];
}
