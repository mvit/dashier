/**
 * Column storage: one array per column, not row objects (2M rows × 12 fields as objects is ~1 GB):
 *   - numbers   → Float64Array (blank = NaN)
 *   - booleans  → Uint8Array (0 false, 1 true, 2 blank)
 *   - dates and low-variety text → a dictionary: each distinct value once, plus a code per row
 *   - text where most values differ (IDs, emails) → plain strings (a dictionary wouldn't save anything)
 * A text column picks its encoding while loading. cellReader reads values as a row object would hold them
 * (numbers or null, ISO date strings, strings, booleans). Visuals read frames over these columns (frames.ts).
 */
import { ColumnSchema, DataSourceFormat, FieldType, isNumericType } from '../types/model';
import { CONVERT, readColumns } from './hydrate';
import { dayFirst, toISODate } from './dates';

export type Column =
  | { kind: 'number'; values: Float64Array }
  | { kind: 'bool'; values: Uint8Array }
  | { kind: 'dict'; codes: Uint32Array; words: string[] }
  | { kind: 'text'; values: string[] };

export interface ColumnTable {
  length: number;
  names: string[];
  types: Record<string, FieldType>;
  columns: Record<string, Column>;
}

/** Rows looked at before a text column decides between a dictionary and plain strings. */
const PROBE = 10_000;
/** With more distinct values than this share of the rows probed, text is kept as plain strings. */
const MOSTLY_UNIQUE = 0.5;

/**
 * Collects one column's values as they're parsed (`push` each, then `done`), in the cheapest form for its type:
 * numbers, true/false (2: blank) or dictionary codes in `cells`, or, for text that's mostly unique, plain strings.
 */
function builder(type: FieldType) {
  const numeric = isNumericType(type), bool = type === 'boolean';
  // dates are kept as written until done(), which reads them all one way (day or month first)
  const convert = type === 'datetime' ? (v: unknown) => String(v ?? '').trim() : CONVERT[type];
  let n = 0, cells: Float64Array | Uint8Array | Uint32Array = new (numeric ? Float64Array : bool ? Uint8Array : Uint32Array)(1024);
  let words: string[] = [], texts: string[] | null = null;
  const dict = new Map<string, number>();
  return {
    get length() {
      return n;
    },
    push(raw: unknown) {
      const v = convert(raw);
      if (n === cells.length && !texts) {
        const b = new (cells.constructor as any)(n * 2);
        b.set(cells);
        cells = b;
      }
      if (texts) texts.push(v);
      else if (numeric) cells[n] = v ?? NaN;
      else if (bool) cells[n] = v == null ? 2 : v ? 1 : 0;
      else {
        let code = dict.get(v);
        if (code === undefined) dict.set(v, (code = words.push(v) - 1));
        cells[n] = code;
        // dates always stay in a dictionary (few distinct days); text that's mostly unique switches to strings
        if (n + 1 === PROBE && type === 'string' && words.length > PROBE * MOSTLY_UNIQUE) texts = Array.from(cells.subarray(0, PROBE), c => words[c]);
      }
      n++;
    },
    done(): Column {
      if (texts) return { kind: 'text', values: texts };
      let c = cells.slice(0, n) as any;
      if (numeric || bool) return { kind: numeric ? 'number' : 'bool', values: c };
      if (type === 'datetime') {
        // each distinct text once to ISO; texts naming the same day ("1/3/2024", "01/03/2024") share a code
        const first = dayFirst(words), at = new Map<string, number>();
        const remap = words.map(w => ((w = toISODate(w, first) ?? ''), at.get(w) ?? at.set(w, at.size).size - 1));
        words = [...at.keys()];
        c = c.map((x: number) => remap[x]);
      }
      return { kind: 'dict', codes: c, words };
    }
  };
}
type Builder = ReturnType<typeof builder>;

/** A table built as its columns' names, then values, arrive by column number (`to`), typed by `structure` (other columns are left out). */
function tableBuilder(structure: ColumnSchema[]) {
  const types = Object.fromEntries(structure.map(c => [c.name, c.type])) as Record<string, FieldType>;
  const names: string[] = [], builders: (Builder | null)[] = [];
  const rows = () => Math.max(0, ...builders.map(b => b?.length ?? 0));
  return {
    rows,
    to: (i: number, v: unknown, name: boolean) => (name ? ((names[i] = v as string), (builders[i] = types[v as string] ? builder(types[v as string]) : null)) : builders[i]?.push(v)),
    done(): ColumnTable {
      const n = rows();
      // a short column (stored columns can be) is padded blank
      for (const b of builders) while (b && b.length < n) b.push('');
      return { length: n, names: names.filter((_, i) => builders[i]), types, columns: Object.fromEntries(names.flatMap((h, i) => (builders[i] ? [[h, builders[i]!.done()]] : []))) };
    }
  };
}

/** Columns from row objects (JSON payloads, tests), typed by `structure`. */
export function columnsFromRows(rows: Record<string, unknown>[], structure: ColumnSchema[]): ColumnTable {
  const t = tableBuilder(structure);
  structure.forEach((c, i) => t.to(i, c.name, true));
  for (const r of rows) structure.forEach((c, i) => t.to(i, r[c.name] ?? '', false));
  return { ...t.done(), length: rows.length };
}

/**
 * A table's text (CSV, JSON rows or columns) read straight into typed columns (no row objects), a slice at a time:
 * `progress` gets the share of the text read (0–1) and the rows so far. With `store`, the same reading also gives the
 * table as it is stored (see readColumns).
 */
export async function columnsFromText(text: string, format: DataSourceFormat, structure: ColumnSchema[], progress: (share: number, rows: number) => void = () => {}, store = false) {
  const t = tableBuilder(structure);
  const stored = await readColumns(text, format, { to: t.to, store, progress: share => progress(share, t.rows()) });
  const table = t.done();
  progress(1, table.length);
  return { table, stored };
}

/** Reads a column's rows by number, one reader per kind: millions of reads don't each ask which kind it is. */
export function cellReader(c: Column): (i: number) => unknown {
  if (c.kind === 'dict') {
    const { codes, words } = c;
    return i => words[codes[i]];
  }
  const v = c.values as any;
  return c.kind === 'number' ? i => (v[i] === v[i] ? v[i] : null) : c.kind === 'bool' ? i => (v[i] === 2 ? null : v[i] === 1) : i => v[i];
}
