/**
 * Matrices: the rows of a frame grouped by the row fields (a hierarchy, outer first) and the column fields,
 * with each value summarized at every crossing, for every row group (its subtotal) and overall (the totals).
 * Groups hold frame positions, never row copies.
 */
import { Compare, MatrixElement, MatrixField, MatrixValue } from '../types/model';
import { Frame, reader, subset } from './frames';
import { datePartLabel, shiftKey } from './dates';
import { compareText } from './data';
import { buckets, comparison, keyIndex, keyOf, numberOf, pct, summarizeValue } from './charts';
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
const keyIndexOf = (frame: Frame, f: MatrixField) => keyIndex(frame, keyOf(f.field, f.datePart), '');
function keyTextReader(frame: Frame, f: MatrixField): (k: number) => string {
  const { names, at } = keyIndexOf(frame, f);
  return k => names[at[k]];
}

type MeasureOf = (ref: string) => MeasureFn | null | undefined;

/** A value over a group of positions of `frame`: a measure worked out on them, or its field summarized. */
function summarize(frame: Frame, v: MatrixValue, measure: MeasureOf) {
  const fn = measure(v.field);
  if (fn) return (pos: ArrayLike<number>) => (pos.length ? fn(subset(frame, Int32Array.from(pos))) : null);
  const read = reader(frame, v.field);
  const method = v.aggregate ?? 'sum';
  return (pos: ArrayLike<number>) => (!pos.length ? null : method === 'count' ? pos.length : read ? summarizeValue(pos.length, i => read(pos[i]), method) : null);
}

/** Summaries that add up: a group's is worked out from its subgroups' (see `adds` in buildMatrix). */
const ADDS = ['sum', 'avg', 'count', 'min', 'max'];
/** Most cells (finest groups × columns) worked out to add up; past this, every group reads its own rows. */
const MAX_CELLS = 1 << 22;

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
    // a row's column is the combination of its keys' numbers (each field's keys numbered once, keyIndex)
    const idx = colFields.map(f => keyIndexOf(frame, f));
    const keys: string[][] = [];
    const raw = new Int32Array(frame.length);
    const index = new Map<number, number>();
    for (let k = 0; k < frame.length; k++) {
      const key = idx.reduce((a, x) => a * x.names.length + x.at[k], 0);
      let i = index.get(key);
      if (i === undefined) index.set(key, (i = keys.push(idx.map(x => x.names[x.at[k]])) - 1));
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

  // rows: groups level by level, each splitting one of the level above. A level's groups are numbered as first seen
  // (ids[d][k]: row k's group at depth d), each with its key's number in keyIndex's names and its parent group.
  const n = frame.length, idx = rowFields.map(f => keyIndexOf(frame, f)), last = idx.length - 1;
  const ids: Int32Array[] = [], keyAt: number[][] = [], kids: number[][][] = [];
  idx.forEach(({ names, at }, d) => {
    if (!d) return void (ids.push(at), keyAt.push(names.map((_, i) => i)));
    const id = new Int32Array(n), key: number[] = [], seen = new Map<number, number>();
    kids.push(keyAt[d - 1].map(() => []));
    for (let k = 0; k < n; k++) {
      const up = ids[d - 1][k], code = up * names.length + at[k];
      let g = seen.get(code);
      if (g === undefined) seen.set(code, (g = key.push(at[k]) - 1)), kids[d - 1][up].push(g);
      id[k] = g;
    }
    ids.push(id), keyAt.push(key);
  });
  // the finest groups (one, holding every row, without row fields): `adds` values are worked out for these only
  const leaf = ids[last], leaves = last < 0 ? 1 : keyAt[last].length;
  const leavesOf = (d: number, g: number): number[] => (d === last ? [g] : kids[d][g].flatMap(c => leavesOf(d + 1, c)));
  const everyLeaf = Array.from({ length: leaves }, (_, l) => l);
  // a group's rows, in order (for values that don't add up), from one counting sort per level
  const posAt: Int32Array[][] = [];
  let all: Int32Array | undefined;
  const allRows = () => (all ??= Int32Array.from({ length: n }, (_, k) => k));
  const rowsOf = (d: number, g: number) => (d < 0 ? allRows() : (posAt[d] ??= buckets(ids[d], keyAt[d].length))[g]);

  // A value that adds up (a sum, count or average; a minimum or maximum of numbers) is summed once per finest group
  // and column (slot `cols`: rows in no column shown, which count in the Total column), then a group's cell (column s,
  // or −1: all of them) adds up its finest groups': no row is read twice, however many levels and columns there are.
  const W = cols + 1;
  const adds = values.map(v => {
    const m = v.aggregate ?? 'sum', read = reader(frame, v.field);
    if (measure(v.field) || !ADDS.includes(m) || leaves * W > MAX_CELLS) return null;
    // a minimum or maximum of text is text (summarizeValue)
    for (let k = 0; read && (m === 'min' || m === 'max') && k < n; k++) {
      const x = read(k);
      if ((typeof x === 'string' && x !== '') || typeof x === 'boolean') return null;
    }
    const C = new Float64Array(leaves * W), S = new Float64Array(leaves * W), LO = new Float64Array(leaves * W).fill(Infinity), HI = new Float64Array(leaves * W).fill(-Infinity);
    for (let k = 0; k < n; k++) {
      const j = (leaf ? leaf[k] : 0) * W + (colOf[k] < 0 ? cols : colOf[k]);
      const x = m === 'count' ? 0 : read ? numberOf(read(k)) : NaN;
      if (x !== x) continue;
      C[j]++, (S[j] += x), x < LO[j] && (LO[j] = x), x > HI[j] && (HI[j] = x);
    }
    return (ls: number[], s: number) => {
      let c = 0, sum = 0, lo = Infinity, hi = -Infinity;
      for (const l of ls)
        for (let t = Math.max(s, 0); t <= (s < 0 ? cols : s); t++) {
          const j = l * W + t;
          (c += C[j]), (sum += S[j]), (lo = Math.min(lo, LO[j])), (hi = Math.max(hi, HI[j]));
        }
      return !c ? null : m === 'count' ? c : m === 'sum' ? sum : m === 'avg' ? sum / c : m === 'min' ? lo : hi;
    };
  });
  /** Value i of a group (its finest groups `ls`, its rows `rows`) in column s (−1: all). */
  const valueAt = (i: number, ls: number[], rows: () => ArrayLike<number>, s: number) => (adds[i] ? adds[i]!(ls, s) : reduce[i](rows()));

  // a 100% share is of the value's grand total; of a zero total, it's blank
  const grand = values.map((v, i) => (pct(v.showAs) ? Number(valueAt(i, everyLeaf, allRows, -1)) : 1));
  const cellsOf = (ls: number[], rows: () => ArrayLike<number>, path: string) => {
    const out: Cells = new Array((cols + (totalCol ? 1 : 0)) * nv).fill(null);
    // the group's rows by column (for values that don't add up)
    let byCol: number[][] | undefined;
    const inCol = (c: number) => {
      if (!byCol) {
        const r = rows();
        byCol = Array.from({ length: cols }, () => []);
        for (let j = 0; j < r.length; j++) if (colOf[r[j]] >= 0) byCol[colOf[r[j]]].push(r[j]);
      }
      return byCol[c];
    };
    const put = (c: number, s: number, group: () => ArrayLike<number>, col: string) => values.forEach((v, i) => {
      let x = valueAt(i, ls, group, s);
      if (other[i]) x = comparison(x, other[i]!(path, col), v.compare!.show)?.d ?? null;
      out[c * nv + i] = typeof x === 'number' ? (grand[i] ? x / grand[i] : null) : x;
    });
    if (!colFields.length) put(0, -1, rows, '');
    else {
      for (let c = 0; c < cols; c++) put(c, c, () => inCol(c), shown[c].join('\u0000'));
      if (totalCol) put(cols, -1, rows, '*');
      for (const i of runs) for (let c = 1; c < cols; c++) out[c * nv + i] = Number(out[(c - 1) * nv + i] ?? 0) + Number(out[c * nv + i] ?? 0);
    }
    return out;
  };

  const toRows = (d: number, groups: number[], parent: string): MatrixRow[] => {
    const rows = groups
      .map(g => ({ g, key: idx[d].names[keyAt[d][g]] }))
      .sort((a, b) => cmpOf(rowFields[d])(a.key, b.key))
      .map(({ g, key }) => {
        const path = parent + '\u0000' + key;
        const children = d < last ? toRows(d + 1, kids[d][g], path) : [];
        return { path, key, label: keyLabel(key, rowFields[d]), depth: d, children, cells: cellsOf(leavesOf(d, g), () => rowsOf(d, g), path) };
      });
    if (!colFields.length) for (const i of runs) rows.forEach((r, k) => k && (r.cells[i] = Number(rows[k - 1].cells[i] ?? 0) + Number(r.cells[i] ?? 0)));
    return rows;
  };

  return { headers, cols, totalCol, rows: last < 0 ? [] : toRows(0, keyAt[0], ''), total: cellsOf(everyLeaf, allRows, '') };
}
