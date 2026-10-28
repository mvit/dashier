/**
 * Matrices: the rows of a frame grouped by the row fields (a hierarchy, outer first) and the column fields,
 * with each value summarized at every crossing, for every row group (its subtotal) and overall (the totals).
 * Groups hold frame positions, never row copies.
 */
import { Compare, MatrixElement, MatrixField, MatrixValue } from '../types/model';
import { Frame, reader, subset } from './frames';
import { datePartLabel, shiftKey } from './dates';
import { compareText } from './data';
import { comparison, keyOf, keyReader, pct, summarizeValue } from './charts';
import type { MeasureFn } from './measures';

/** Column keys shown at most (the totals still count every column). */
const MAX_COLUMNS = 100;

type Cells = (number | string | null)[];

export interface MatrixRow {
  /** Unique among the rows: the keys from the outermost level down. */
  path: string;
  /** The group's key (a date's bucket, "2024-01"): rows sort by it. */
  key: string;
  label: string;
  depth: number;
  children: MatrixRow[];
  /** Per column (then the Total column), one cell per value. */
  cells: Cells;
}

export interface Matrix {
  /** One header row per column field, outer first; a span counts columns. */
  headers: { label: string; span: number }[][];
  /** Columns (column keys; one when there are no column fields), before the Total column. */
  cols: number;
  /** A Total column follows the columns. */
  totalCol: boolean;
  rows: MatrixRow[];
  /** The grand total row's cells. */
  total: Cells;
}

/** A field's value as a group key (a date as its bucket); blank is ''. */
function keyTextReader(frame: Frame, f: MatrixField): (k: number) => string {
  const read = keyReader(frame, keyOf(f.field, f.datePart));
  return (k) => String(read(k) ?? '');
}

type MeasureOf = (ref: string) => MeasureFn | null | undefined;

/** A value over a group of positions of `frame`: a measure worked out on them, or its field summarized. */
function summarize(frame: Frame, v: MatrixValue, measure: MeasureOf) {
  const fn = measure(v.field);
  if (fn) return (pos: number[]) => (pos.length ? fn(subset(frame, Int32Array.from(pos))) : null);
  const read = reader(frame, v.field);
  const method = v.aggregate ?? 'sum';
  return (pos: number[]) => (!pos.length ? null : method === 'count' ? pos.length : read ? summarizeValue(pos.length, i => read(pos[i]), method) : null);
}

/** How a key reads in a header. */
const keyLabel = (key: string, f: MatrixField) => (key === '' ? '(Blank)' : f.datePart ? datePartLabel(key, f.datePart) : key);

export function buildMatrix(
  el: MatrixElement,
  frame: Frame,
  measure: MeasureOf = () => null,
  order?: (field: string) => ((a: string, b: string) => number) | undefined,
  compared?: (c: Compare) => { frame: Frame; measure: MeasureOf; moved?: boolean } | null
): Matrix {
  // headers in text order, or their field's sort-by column's
  const cmpOf = (f?: MatrixField) => (f && !f.datePart && order?.(f.field)) || compareText;
  const rowFields = el.rows ?? [];
  const colFields = el.columns ?? [];
  const values = el.values ?? [];
  const nv = values.length;
  const all = Array.from({ length: frame.length }, (_, k) => k);

  // each value over a group's positions
  const reduce = values.map(v => summarize(frame, v, measure));
  // a compared value's other number for a cell (its row path, its column's keys; '*' the Total column): the same
  // cell of the visual's other period, the row and column dates moved onto these
  const other = values.map(v => {
    const c = v.compare;
    const o = c && compared?.(c);
    if (!o) return null;
    const fields = [...rowFields, ...colFields];
    const moves = (f: MatrixField) => !!(c.shift && f.datePart);
    // nothing moved and no date header: there's no other period to compare with
    if (!o.moved && !fields.some(moves)) return () => null;
    const reads = fields.map(f => {
      const read = keyTextReader(o.frame, f);
      return (k: number) => (moves(f) && read(k) ? shiftKey(read(k), f.datePart!, c.shift!, 1) : read(k));
    });
    const [rk, ck] = [reads.slice(0, rowFields.length), reads.slice(rowFields.length)];
    // as Power BI's same period last year: the other period of a set of dates is those dates moved, where they
    // overlap them (all of 2024–2025 a year back counts 2024 only), so a moved date must be one of this visual's
    const ours = fields.map(f => {
      const read = moves(f) && keyTextReader(frame, f);
      return read && new Set(Array.from({ length: frame.length }, (_, k) => read(k)));
    });
    // each row joins its group at every level (the grand total's path is ''), in its column and in the Total column
    const at = new Map<string, number[]>();
    for (let k = 0; k < o.frame.length; k++) {
      if (!ours.every((set, i) => !set || set.has(reads[i](k)))) continue;
      const add = (key: string) => (at.get(key) ?? at.set(key, []).get(key)!).push(k);
      const cols = colFields.length ? [ck.map(r => r(k)).join('\u0000'), '*'] : [''];
      let path = '';
      for (let d = 0; d <= rk.length; d++) {
        cols.forEach(col => add(path + '\u0001' + col));
        if (d < rk.length) path += '\u0000' + rk[d](k);
      }
    }
    const fn = summarize(o.frame, v, o.measure);
    return (path: string, col: string) => fn(at.get(path + '\u0001' + col) ?? []);
  });
  // running totals add up along the columns, or down each group's rows when there are none
  const runs = values.flatMap((v, i) => (v.showAs === 'running-total' ? [i] : []));

  // columns: every combination of the column fields' keys, in order, level by level
  const colOf = new Int32Array(frame.length);
  let cols = 1;
  let headers: Matrix['headers'] = [];
  let shown: string[][] = [];
  if (colFields.length) {
    const reads = colFields.map(f => keyTextReader(frame, f));
    const keys: string[][] = [];
    const raw = new Int32Array(frame.length);
    const index = new Map<string, number>();
    for (let k = 0; k < frame.length; k++) {
      const parts = reads.map(r => r(k));
      const key = parts.join('\u0000');
      let i = index.get(key);
      if (i === undefined) index.set(key, (i = keys.push(parts) - 1));
      raw[k] = i;
    }
    const sorted = keys.map((_, i) => i).sort((a, b) => {
      for (let l = 0; l < colFields.length; l++) {
        const c = cmpOf(colFields[l])(String(keys[a][l]), String(keys[b][l]));
        if (c) return c;
      }
      return 0;
    });
    const rank = new Int32Array(keys.length);
    sorted.forEach((i, r) => (rank[i] = r < MAX_COLUMNS ? r : -1));
    for (let k = 0; k < frame.length; k++) colOf[k] = rank[raw[k]];
    shown = sorted.slice(0, MAX_COLUMNS).map(i => keys[i]);
    cols = shown.length;
    // a header spans the columns that share it and every header above it
    headers = colFields.map((f, l) => {
      const row: { label: string; span: number }[] = [];
      shown.forEach((parts, c) => {
        const same = c > 0 && parts.slice(0, l + 1).every((p, j) => p === shown[c - 1][j]);
        same ? row[row.length - 1].span++ : row.push({ label: keyLabel(parts[l], f), span: 1 });
      });
      return row;
    });
  }
  const totalCol = colFields.length > 0 && el.totals !== false && el.totals !== 'row';

  // a 100% share is of the value's grand total; of a zero total, it's blank
  const grand = values.map((v, i) => (pct(v.showAs) ? Number(reduce[i](all)) : 1));
  const cellsOf = (pos: number[], path: string) => {
    const out: Cells = new Array((cols + (totalCol ? 1 : 0)) * nv).fill(null);
    const put = (c: number, group: number[], col: string) => values.forEach((v, i) => {
      let x = reduce[i](group);
      if (other[i]) x = comparison(x, other[i]!(path, col), v.compare!.show)?.d ?? null;
      out[c * nv + i] = typeof x === 'number' ? (grand[i] ? x / grand[i] : null) : x;
    });
    if (!colFields.length) put(0, pos, '');
    else {
      const buckets: number[][] = Array.from({ length: cols }, () => []);
      for (const k of pos) if (colOf[k] >= 0) buckets[colOf[k]].push(k);
      buckets.forEach((b, c) => put(c, b, shown[c].join('\u0000')));
      if (totalCol) put(cols, pos, '*');
      for (const i of runs) for (let c = 1; c < cols; c++) out[c * nv + i] = Number(out[(c - 1) * nv + i] ?? 0) + Number(out[c * nv + i] ?? 0);
    }
    return out;
  };

  // rows: a tree of groups, each level splitting the one above
  type Group = { key: string; pos: number[]; children: Map<string, Group> };
  const reads = rowFields.map(f => keyTextReader(frame, f));
  const top = new Map<string, Group>();
  if (reads.length)
    for (let k = 0; k < frame.length; k++) {
      let level = top;
      for (const read of reads) {
        const key = read(k);
        let g = level.get(key);
        if (!g) level.set(key, (g = { key, pos: [], children: new Map() }));
        g.pos.push(k);
        level = g.children;
      }
    }
  const toRows = (groups: Map<string, Group>, depth: number, parent: string): MatrixRow[] => {
    const rows = [...groups.values()]
      .sort((a, b) => cmpOf(rowFields[depth])(a.key, b.key))
      .map(g => {
        const path = parent + '\u0000' + g.key;
        return { path, key: g.key, label: keyLabel(g.key, rowFields[depth]), depth, children: toRows(g.children, depth + 1, path), cells: cellsOf(g.pos, path) };
      });
    if (!colFields.length) for (const i of runs) rows.forEach((r, k) => k && (r.cells[i] = Number(rows[k - 1].cells[i] ?? 0) + Number(r.cells[i] ?? 0)));
    return rows;
  };

  return { headers, cols, totalCol, rows: toRows(top, 0, ''), total: cellsOf(all, '') };
}
