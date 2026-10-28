import { dayFirst, toISODate } from './dates';
import { NUMBER } from './data';
import { payloadText } from './payloads';
import { ColumnTable, columnsFromCSVAsync, columnsFromRows } from './columns';
import { DashDataSource, ColumnSchema, FieldType } from '../types/model';

type Row = Record<string, any>;
type Rows = Row[];

/**
 * RFC 4180 CSV, record by record: `onRecord` gets each record's fields as strings (the first is the header).
 * `read(ms)` works for about that long and returns true once the text is done, so a big file can be read a
 * slice at a time with the page repainting in between; `share()` is how far it has got (0–1).
 */
export function csvReader(text: string, onRecord: (fields: string[]) => void) {
  const t = text.trim();
  let i = 0, row: string[] = [], val = '', quoted = false;
  const endRow = () => {
    row.push(val.trim());
    if (!(row.length === 1 && row[0] === '')) onRecord(row);
    row = [];
    val = '';
  };
  const read = (ms = Infinity) => {
    const until = performance.now() + ms;
    while (i < t.length) {
      for (const stop = Math.min(t.length, i + 65536); i < stop; i++) {
        const c = t[i];
        if (quoted) {
          if (c !== '"') val += c;
          else if (t[i + 1] === '"') (val += '"'), i++;
          else quoted = false;
        } else if (c === '"' && !val.trim()) quoted = true; // a quote opens a field only at its start: 5'10" is text
        else if (c === ',') row.push(val.trim()), (val = '');
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && t[i + 1] === '\n') i++;
          endRow();
        } else val += c;
      }
      if (performance.now() > until) return false;
    }
    // the last record (callers stop reading once it's done)
    if (val || row.length) endRow();
    return true;
  };
  return { read, share: () => (t.length ? Math.min(1, i / t.length) : 1) };
}

/**
 * The header and first `n` records of a CSV as text, and how many records it has (header excluded), from one
 * pass over the characters that builds no strings: a preview of millions of rows parses only what it shows.
 */
export function csvHead(text: string, n: number): { head: string; total: number } {
  const t = text.trim();
  let quoted = false, records = 0, cut = -1, start = true; // at a field's start (where a quote opens one)
  let filled = false; // the current record has content (blank lines aren't records)
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (quoted) c === 34 && (t.charCodeAt(i + 1) === 34 ? i++ : (quoted = false));
    else if (c === 10 || c === 13) {
      if (c === 13 && t.charCodeAt(i + 1) === 10) i++;
      if (filled && ++records === n + 1) cut = i + 1;
      filled = false;
      start = true;
      continue;
    } else if (c === 34 && start) quoted = true;
    else if (c > 32) start = c === 44;
    if (c > 32) filled = true;
  }
  if (filled) records++;
  return { head: cut < 0 ? t : t.slice(0, cut), total: Math.max(0, records - 1) };
}

/** Header names made unique: a repeated "a" becomes "a 2", "a 3"… */
export const uniqueNames = (names: string[]) => {
  const seen = new Set<string>();
  return names.map(h => {
    let n = h;
    for (let i = 2; seen.has(n); i++) n = `${h} ${i}`;
    seen.add(n);
    return n;
  });
};

/** RFC 4180 CSV with a header row. Values stay strings; applyTypes converts them. */
export function parseCSV(text: string): Rows {
  let headers: string[] | null = null;
  const rows: Rows = [];
  csvReader(text, (r) => {
    if (!headers) headers = uniqueNames(r);
    else rows.push(Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  }).read();
  // the header's order (an object puts number-like keys like "2024" first)
  return Object.defineProperty(rows, 'names', { value: headers ?? [] });
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v);

/** Renames one column in the stored text: only the CSV header line (or the JSON keys) is rewritten. */
export function renameColumnInText(format: 'csv' | 'json', text: string, from: string, to: string): string {
  if (format === 'json') {
    const rename = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
    return JSON.stringify(parseJSON(text).map(rename)); // stored as plain rows from then on
  }
  const t = text.replace(/^\s+/, '');
  const end = csvHead(t, 0).head.replace(/\r?\n$/, '').length; // the header line (quoted line breaks belong to it)
  let header: string[] = [];
  csvReader(t.slice(0, end), r => (header = uniqueNames(r))).read();
  return header.map(c => csvCell(c === from ? to : c)).join(',') + t.slice(end);
}

/** JSON array of row objects, or a columnar { column: [values] } object. */
export function parseJSON(text: string): Rows {
  let data = JSON.parse(text);
  const keys = isRow(data) ? Object.keys(data) : [];
  // {"data": [{…}, …]} is its list of rows; {"a": [...], "b": [...]} is columns
  if (keys.length === 1 && Array.isArray(data[keys[0]]) && isRow(data[keys[0]][0])) data = data[keys[0]];
  else if (keys.length && keys.every(k => Array.isArray(data[k]))) data = data[keys[0]].map((_: unknown, i: number) => Object.fromEntries(keys.map(k => [k, data[k][i]])));
  // a plain value is a row of one "value"; a value that is itself a list or object is kept as its JSON text
  return (Array.isArray(data) ? data : data == null ? [] : [data]).map((r: any) =>
    !isRow(r) ? { value: r } : Object.values(r).some(v => v && typeof v === 'object') ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])) : r
  );
}
const isRow = (r: unknown): r is Record<string, any> => !!r && typeof r === 'object' && !Array.isArray(r);

/** A number, or null for a blank or anything that isn't wholly one ("1,234", "12%", "0x1A"): values are kept, never cut to a prefix. */
const num = (v: any) => (typeof v === 'number' ? (isFinite(v) ? v : null) : NUMBER.test((v = String(v ?? '').trim())) ? +v : null);
// dates aren't here: a column of them is read all one way (day or month first), not value by value
export const CONVERT: Record<Exclude<FieldType, 'datetime'>, (v: any) => any> = {
  float: num,
  int: num,
  uint: num,
  boolean: v => (v == null || v === '' ? null : v === true || /^(true|1|yes)$/i.test(String(v))),
  string: v => (v == null ? '' : String(v))
};

/** Copies of the rows, every column named in `structure` converted to its type (unparseable numbers become null, dates ISO). */
export function applyTypes(rows: Rows, structure: ColumnSchema[]): Rows {
  const first = structure.map(c => c.type === 'datetime' && dayFirst(rows.map(r => r[c.name])));
  return rows.map(row => {
    const r: Row = { ...row };
    structure.forEach(({ name, type }, i) => name in r && (r[name] = type === 'datetime' ? toISODate(r[name], first[i]) ?? '' : CONVERT[type](r[name])));
    return r;
  });
}

/**
 * Guesses each column's type from the first 1,000 rows (every key any of them has). A column mixing kinds (numbers
 * and dates, numbers and true/false) is text, except 0/1 among true/false; numbers with a leading zero (zip codes) too.
 */
export function inferStructure(rows: Rows): ColumnSchema[] {
  const sample = rows.slice(0, 1000);
  const names = new Set<string>((rows as any).names);
  for (const r of sample) for (const k in r) names.add(k);
  return [...names].map(name => {
    const seen = new Set<FieldType>();
    let nullable = false, bits = true;
    for (const row of sample) {
      const v = row[name], s = String(v ?? '').trim();
      if (!s) nullable = true;
      else if (typeof v === 'boolean' || /^(true|false)$/i.test(s)) seen.add('boolean');
      else if (typeof v === 'number' || (NUMBER.test(s) && !/^[-+]?0\d/.test(s))) seen.add(Number.isInteger(+s) ? 'int' : 'float'), (bits &&= s === '0' || s === '1');
      else seen.add(toISODate(s) ? 'datetime' : 'string');
    }
    if (seen.has('float') || (bits && seen.has('boolean'))) seen.delete('int');
    return { name, type: seen.size === 1 ? [...seen][0] : 'string', nullable };
  });
}

/** Where a load has got to: unpacking the stored data, then reading its rows (share 0–1, rows so far). */
export type LoadStep = { step: 'unpack' } | { step: 'read'; share: number; rows: number };

/** A table's text into typed columns: CSV straight into columns a slice at a time, reporting progress; JSON via its row objects. */
export const textToColumnsAsync = async (text: string, format: 'csv' | 'json', structure: ColumnSchema[], progress: (s: LoadStep) => void): Promise<ColumnTable> =>
  format === 'csv' ? columnsFromCSVAsync(text, structure, (share, rows) => progress({ step: 'read', share, rows })) : columnsFromRows(parseJSON(text), structure);

/** Decompresses and parses one source into columns, with its declared column types. */
export async function hydrateSource(source: DashDataSource, progress: (s: LoadStep) => void = () => {}): Promise<ColumnTable> {
  progress({ step: 'unpack' });
  return textToColumnsAsync(await payloadText(source.payload), source.format, source.structure, progress);
}

