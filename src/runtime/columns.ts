/**
 * Column storage: one array per column, not row objects (2M rows × 12 fields as objects is ~1 GB):
 *   - numbers   → Float64Array (blank = NaN)
 *   - booleans  → Uint8Array (0 false, 1 true, 2 blank)
 *   - dates and low-variety text → a dictionary: each distinct value once, plus a code per row
 *   - text where most values differ (IDs, emails) → plain strings (a dictionary wouldn't save anything)
 * A text column picks its encoding while loading. cellOf reads a value as a row object would hold it
 * (numbers or null, ISO date strings, strings, booleans). Visuals read frames over these columns (frames.ts).
 */
import { ColumnSchema, FieldType, isNumericType } from '../types/model';
import { CONVERT, csvReader, uniqueNames } from './hydrate';
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

/** Collects one column's values as they're parsed, in the cheapest form for its type. */
class Builder {
  length = 0;
  private nums?: Float64Array;
  private bools?: Uint8Array;
  private codes?: Uint32Array;
  private words?: string[];
  private dict?: Map<string, number>;
  private texts?: string[];

  constructor(private type: FieldType) {
    if (isNumericType(type)) this.nums = new Float64Array(1024);
    else if (type === 'boolean') this.bools = new Uint8Array(1024);
    else (this.codes = new Uint32Array(1024)), (this.words = []), (this.dict = new Map());
  }

  private grow<T extends Float64Array | Uint8Array | Uint32Array>(a: T): T {
    if (this.length < a.length) return a;
    const b = new (a.constructor as any)(a.length * 2) as T;
    b.set(a);
    return b;
  }

  push(raw: unknown) {
    // dates are kept as written until done(), which reads them all one way (day or month first)
    const v = this.type === 'datetime' ? String(raw ?? '').trim() : CONVERT[this.type](raw);
    if (this.nums) (this.nums = this.grow(this.nums))[this.length] = v ?? NaN;
    else if (this.bools) (this.bools = this.grow(this.bools))[this.length] = v == null ? 2 : v ? 1 : 0;
    else if (this.texts) this.texts.push(v);
    else {
      let code = this.dict!.get(v);
      if (code === undefined) this.dict!.set(v, (code = this.words!.push(v) - 1));
      (this.codes = this.grow(this.codes!))[this.length] = code;
      // dates always stay in a dictionary (few distinct days); text that's mostly unique switches to strings
      if (this.type === 'string' && this.length + 1 === PROBE && this.words!.length > PROBE * MOSTLY_UNIQUE) this.toText();
    }
    this.length++;
  }

  private toText() {
    this.texts = Array.from(this.codes!.subarray(0, this.length + 1), c => this.words![c]);
    this.codes = this.words = this.dict = undefined;
  }

  done(): Column {
    if (this.nums) return { kind: 'number', values: this.nums.slice(0, this.length) };
    if (this.bools) return { kind: 'bool', values: this.bools.slice(0, this.length) };
    if (this.texts) return { kind: 'text', values: this.texts };
    let codes = this.codes!.slice(0, this.length), words = this.words!;
    if (this.type === 'datetime') {
      // each distinct text once to ISO; texts naming the same day ("1/3/2024", "01/03/2024") share a code
      const first = dayFirst(words), at = new Map<string, number>();
      const remap = words.map(w => ((w = toISODate(w, first) ?? ''), at.get(w) ?? at.set(w, at.size).size - 1));
      words = [...at.keys()];
      codes = codes.map(c => remap[c]);
    }
    return { kind: 'dict', codes, words };
  }
}

/** Columns from row objects (JSON payloads, tests), typed by `structure`. */
export function columnsFromRows(rows: Record<string, unknown>[], structure: ColumnSchema[]): ColumnTable {
  const builders = structure.map(c => new Builder(c.type));
  for (const r of rows) builders.forEach((b, i) => b.push(r[structure[i].name] ?? ''));
  return {
    length: rows.length,
    names: structure.map(c => c.name),
    types: Object.fromEntries(structure.map(c => [c.name, c.type])),
    columns: Object.fromEntries(structure.map((c, i) => [c.name, builders[i].done()]))
  };
}

/**
 * Parses CSV straight into columns (no row objects), typed by `structure`, a slice at a time: the page repaints
 * in between, and `progress` gets the share of the text done (0–1) and the rows read so far. `byColumn`: the CSV
 * is stored as columns, a line each (its name, then its values), read value by value; a short column is padded blank.
 */
export async function columnsFromCSVAsync(text: string, structure: ColumnSchema[], progress: (share: number, rows: number) => void, byColumn = false): Promise<ColumnTable> {
  const types = Object.fromEntries(structure.map(c => [c.name, c.type])) as Record<string, FieldType>;
  let header: string[] = [];
  let builders: (Builder | null)[] = [];
  const reader = csvReader(
    text,
    (fields) => {
      if (!header.length) builders = (header = uniqueNames(fields)).map(h => (types[h] ? new Builder(types[h]) : null));
      else for (let i = 0; i < builders.length; i++) builders[i]?.push(fields[i] ?? '');
    },
    byColumn ? (v, at) => (at ? builders[builders.length - 1]?.push(v) : builders.push(types[(header[header.length] = v)] ? new Builder(types[v]) : null)) : undefined
  );
  const rows = () => Math.max(0, ...builders.map(b => b?.length ?? 0));
  while (!reader.read(100)) {
    progress(reader.share(), rows());
    await new Promise(r => setTimeout(r));
  }
  const n = rows();
  for (const b of builders) while (b && b.length < n) b.push('');
  progress(1, n);
  return {
    length: n,
    names: header.filter(h => types[h]),
    types,
    columns: Object.fromEntries(header.flatMap((h, i) => (builders[i] ? [[h, builders[i]!.done()]] : [])))
  };
}

/** Row `i` of a column. */
export function cellOf(c: Column, i: number): unknown {
  if (c.kind === 'dict') return c.words[c.codes[i]];
  const v = c.values[i];
  return c.kind === 'bool' ? (v === 2 ? null : v === 1) : c.kind === 'number' && Number.isNaN(v) ? null : v;
}
