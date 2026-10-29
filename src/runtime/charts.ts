import { AggregationMethod, ChartElement, ChartOptions, ChartType, Compare, ShowAs, ValueFormat } from '../types/model';
import { DatePart, datePartKey, datePartLabel, shiftKey } from './dates';
import { compareText } from './data';
import type { MeasureFn } from './measures';
import { Frame, reader, subset, tableFrame } from './frames';
import type { Area } from './draw/svg';
import { seriesColor } from './draw/svg';
import { xyChart } from './draw/xy';
import { pieChart } from './draw/pie';
import { radarChart } from './draw/radar';
import { treemapChart, TreeNode } from './draw/treemap';
import { sankeyChart } from './draw/sankey';
import { buildScatter } from './draw/scatter';

const MAX_CATEGORIES = 60;
const MAX_SLICES = 12;
/** A donut's hole, as a share of its radius. */
const DONUT_HOLE = 0.55;

// the suffixes axes use too (Intl's compact notation)
const TIERS: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

const UNITS: Record<string, [number, string]> = { thousands: [1e3, 'K'], millions: [1e6, 'M'], billions: [1e9, 'B'] };

/** A format with display units, as formatValue reads it ("currency|billions"); `units` wins over the format's own. */
export const withUnits = (format?: string, units?: string) => {
  const [f, u] = (format ?? '').split('|');
  return units || u ? `${f || 'number'}|${units || u}` : f || undefined;
};

/**
 * Format numbers cleanly (e.g. 1.2M, 45.2K, $120); with display units, divided and suffixed to 2 decimals ($416.16B,
 * 1,094M as an integer). Text stays as written: an ID like "02134" or a date isn't a number.
 */
export function formatValue(val: number | string | null | undefined, fmt?: string): string {
  if (val == null || (typeof val === 'number' && !Number.isFinite(val))) return '—';
  if (typeof val !== 'number') return String(val);
  const [format, units] = (fmt ?? '').split('|');
  const [div, suffix] = (units === 'auto' ? TIERS.find(([t]) => Math.abs(val) >= t * 0.99995) : UNITS[units]) ?? [];
  if (div && format !== 'percent') {
    const k = format === 'integer' ? 0 : 2;
    return `${val < 0 ? '-' : ''}${format === 'currency' ? '$' : ''}${intl({ minimumFractionDigits: k, maximumFractionDigits: k }).format(Math.abs(val) / div)}${suffix}`;
  }
  // cents and less keep two significant digits: $0.004, not $0; prices under $100 keep their cents: $5.86, not $6
  if (format === 'currency') return (val && Math.abs(val) < 0.5 ? CENTS : Math.abs(val) < 100 && !Number.isInteger(val) ? PRICE : CURRENCY).format(val);
  if (format === 'percent') return `${(Math.round(val * 1000) / 10 || 0).toFixed(1)}%`;
  if (format === 'integer') return (Math.round(val) || 0).toLocaleString();
  const a = Math.abs(val);
  if (a >= 999.95e12) return val.toExponential(1);
  // a tier from where it would round up to it: 999,999.9 is 1.0M, not 1000.0K
  for (const [t, s] of TIERS) if (a >= t * 0.99995) return `${(val / t).toFixed(1)}${s}`;
  return Number.isInteger(val) ? val.toLocaleString() : a < 0.01 ? String(+val.toPrecision(2)) : val.toFixed(2);
}

/**
 * Reduces `n` numbers read by position (no intermediate arrays except for median, mode and distinct). Returns
 * null when a numeric summary finds nothing numeric.
 */
/** Nothing in the cell: null, empty or only spaces (which Number() would read as 0). */
const blankCell = (v: unknown) => v == null || (typeof v === 'string' && !v.trim());

export function summarizeRead(n: number, read: (k: number) => unknown, method: AggregationMethod = 'sum'): number | null {
  if (method === 'count') return n;
  if (method === 'distinct') {
    const seen = new Set<string>();
    for (let k = 0; k < n; k++) {
      const v = read(k);
      if (!blankCell(v)) seen.add(String(v));
    }
    return seen.size;
  }
  const all: number[] | null = method === 'median' ? [] : null;
  const counts = method === 'mode' ? new Map<number, number>() : null;
  // the spread by Welford's method: no loss of precision summing squares of large values
  let count = 0, sum = 0, min = Infinity, max = -Infinity, first = 0, last = 0, mean = 0, m2 = 0, top = 0, most = 0;
  for (let k = 0; k < n; k++) {
    const v = read(k);
    if (blankCell(v)) continue;
    const x = typeof v === 'number' ? v : Number(v);
    if (Number.isNaN(x)) continue;
    if (!count++) first = x;
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
    last = x;
    all?.push(x);
    const d = x - mean;
    mean += d / count;
    m2 += d * (x - mean);
    // the most common value; on a tie, the one that got there first
    if (counts) {
      const c = (counts.get(x) ?? 0) + 1;
      counts.set(x, c);
      if (c > most) (most = c), (top = x);
    }
  }
  if (!count) return null;
  switch (method) {
    case 'avg': return sum / count;
    case 'min': return min;
    case 'max': return max;
    case 'first': return first;
    case 'last':
    case 'latest': return last;
    case 'mode': return top;
    case 'var': return count > 1 ? m2 / (count - 1) : null;
    case 'stdev': return count > 1 ? Math.sqrt(m2 / (count - 1)) : null;
    case 'median': {
      all!.sort((a, b) => a - b);
      const m = count >> 1;
      return count % 2 ? all![m] : (all![m - 1] + all![m]) / 2;
    }
    default: return sum;
  }
}

/** Summaries that read any value: of text alphabetically (naturally), of dates earliest to latest. */
const ANY_VALUE = new Set<AggregationMethod>(['min', 'max', 'mode', 'first', 'last', 'latest']);

/**
 * Like summarizeRead, for a single value on show (a card, a text box variable, a table or matrix cell): there,
 * min, max, most common, first and last read text and dates too. Numbers are summarized as numbers.
 */
export function summarizeValue(n: number, read: (k: number) => unknown, method: AggregationMethod = 'sum'): number | string | null {
  // a text or date column reads as strings (IDs like "02134" stay text), true/false as such, a number column as numbers
  const text = (v: unknown) => (typeof v === 'string' && v !== '') || typeof v === 'boolean';
  let k = 0;
  if (ANY_VALUE.has(method)) while (k < n && !text(read(k))) k++;
  if (k === n || !ANY_VALUE.has(method)) return summarizeRead(n, read, method);
  let out: string | null = null;
  const counts = method === 'mode' ? new Map<string, number>() : null;
  let most = 0;
  for (k = 0; k < n; k++) {
    const v = read(k);
    if (v == null || v === '') continue;
    const s = String(v);
    if (counts) {
      const c = (counts.get(s) ?? 0) + 1;
      counts.set(s, c);
      if (c > most) (most = c), (out = s);
    } else if (out === null || method === 'last' || method === 'latest' || (method === 'min' ? compareText(s, out) < 0 : method === 'max' && compareText(s, out) > 0)) out = s;
    if (method === 'first') break;
  }
  return out;
}

/** Reduces a field over a frame's rows (count ignores the field). Returns null when nothing is numeric. */
export function aggregate(frame: Frame, method: AggregationMethod = 'sum', field?: string): number | null {
  if (method === 'count' || !field) return frame.length;
  const read = reader(frame, field);
  return read ? summarizeRead(frame.length, read, method) : null;
}

/** A field over a frame's rows as a single value on show: as `aggregate`, but min, max, mode, first and last read text and dates too. */
export function aggregateValue(frame: Frame, method: AggregationMethod = 'sum', field?: string): number | string | null {
  if (method === 'count' || !field) return frame.length;
  const read = reader(frame, field);
  return read ? summarizeValue(frame.length, read, method) : null;
}

export const SUMMARY_NAMES: Record<AggregationMethod, string> = {
  sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum', count: 'Count', distinct: 'Count (Distinct)', median: 'Median',
  mode: 'Most common', first: 'First', last: 'Last', latest: 'Last', stdev: 'Standard deviation', var: 'Variance'
};

/** True for a value shown as a share of its grand total. */
export const pct = (s?: ShowAs) => s === 'percent-of-total';

/** A value's name as shown: "%GT Revenue", "Revenue, running total", "Revenue, last year", "Revenue, % vs last year". */
export function valueLabel(name: string, showAs?: ShowAs, c?: Compare): string {
  const other = c && (c.label ?? (c.shift === 'year' ? 'last year' : c.shift ? 'previous period' : c.field ?? 'other'));
  return (pct(showAs) ? '%GT ' : '') + name + (c ? (c.show === 'value' ? `, ${other}` : `, ${c.show ? 'change' : '%'} vs ${other}`) : '') + (showAs === 'running-total' ? ', running total' : '');
}

/** The display name of a summarized field: "Sum of revenue", "%GT Sum of revenue". */
export function summaryLabel(field: string, method?: AggregationMethod, showAs?: ShowAs, c?: Compare): string {
  return method ? valueLabel(`${SUMMARY_NAMES[method]} of ${field}`, showAs, c) : field;
}

const KINDS = ['bar', 'hbar', 'line', 'area', 'combo', 'scatter', 'pie', 'donut', 'radar', 'treemap', 'sankey', 'gauge'];
/** Maps unknown chart types (and the old "column") onto the ones Dashier draws. */
export const chartKind = (t: string): ChartType => (KINDS.includes(t) ? (t as ChartType) : 'bar');

/** A chart's number format: a value format, or 'share' for percent-of-total values (already 0–100). */
export type ChartFormat = ValueFormat | 'share' | undefined;
/** Charts write their own compact numbers: a format's display units don't apply. */
const unitless = (f?: string) => f?.split('|')[0] as ChartFormat;

const intl = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-US', o);
const CURRENCY = intl({ style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const CENTS = intl({ style: 'currency', currency: 'USD', maximumSignificantDigits: 2 });
const PRICE = intl({ style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const FULL = intl({ maximumFractionDigits: 2 });
const FINE = intl({ maximumSignificantDigits: 3 });
const compact = new Map<string, Intl.NumberFormat>();

/** Exact, for tooltips: $124,501 · 124,500.5 · 0.00412 · 12.3%. */
export function formatFull(n: number, fm?: ChartFormat): string {
  const f = unitless(fm);
  return f === 'share' ? `${n.toFixed(1)}%` : f === 'percent' ? `${(n * 100).toFixed(1)}%` : f === 'currency' ? CURRENCY.format(n) : f === 'integer' ? Math.round(n).toLocaleString('en-US') : (Math.abs(n) < 1 ? FINE : FULL).format(n);
}

/** Short, for axes and data labels: $250K · 1.2M · 25%, with up to `digits` decimals (labels: 3 significant digits under 1,000). */
export function formatCompact(n: number, fm?: ChartFormat, digits?: number): string {
  const f = unitless(fm);
  if (f === 'share' || f === 'percent') return `${+(f === 'share' ? n : n * 100).toFixed(digits ?? 1) || 0}%`;
  // fixed display units: every number in them ($1.2M, $0.4M, $12.5M), labels to 3 significant digits
  const [div, suffix] = UNITS[(fm ?? '').split('|')[1]] ?? [];
  if (div) return `${n < 0 ? '-' : ''}${f === 'currency' ? '$' : ''}${intl(digits === undefined ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: digits }).format(Math.abs(n) / div)}${suffix}`;
  // a data label (no digits asked for) under 1,000 keeps 3 significant digits: $7.46, 67.1, 225; axis ticks ask for theirs
  const sig = digits === undefined && Math.abs(n) < 999.5;
  const key = (f === 'currency' ? '$' : '') + (sig ? 's' : digits ?? 1);
  let nf = compact.get(key);
  if (!nf)
    compact.set(key, (nf = intl({ notation: 'compact', ...(sig ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: digits ?? 1 }), ...(f === 'currency' && { style: 'currency', currency: 'USD' }) })));
  return nf.format(n);
}

/**
 * A comparison of `a` with `b`: the % change (default) or the difference, signed ("+6.4%"), or `b` itself; null
 * when either is missing. `d` is the change, for its direction.
 */
export function comparison(a: unknown, b: unknown, show?: Compare['show'], format?: string): { text: string; d: number } | null {
  if (typeof b !== 'number' || (show !== 'value' && typeof a !== 'number')) return null;
  const d = show === 'value' ? b : show === 'difference' ? (a as number) - b : b ? ((a as number) - b) / Math.abs(b) : null;
  if (d == null) return null;
  // a plain number's difference to the hundredth: a rating up 0.0095 reads +0.01
  const t = formatValue(show === 'difference' && (!format || format === 'number') ? Math.round(d * 100) / 100 : d, show === 'value' || show === 'difference' ? format : 'percent');
  return { text: show !== 'value' && d > 0 ? '+' + t : t, d };
}

/** A category: a field, read as its date bucket (year/quarter/month/day) when it has a part. */
export type Key = string | { field: string; part?: DatePart };
export const keyOf = (field: string, part?: DatePart): Key => (part ? { field, part } : field);
export function keyReader(frame: Frame, key: Key): (k: number) => unknown {
  const { field, part } = typeof key === 'string' ? { field: key, part: undefined } : key;
  const read = reader(frame, field) ?? (() => undefined);
  return part ? (k: number) => datePartKey(String(read(k) ?? ''), part) : read;
}

/** Sums up frame positions: a field summarized with `method`, or a measure worked out on those rows of the frame. */
export function reducer(frame: Frame, y: string | MeasureFn, method: AggregationMethod): (pos: ArrayLike<number>) => number | null {
  if (typeof y === 'function') return pos => y(subset(frame, pos instanceof Int32Array ? pos : Int32Array.from(pos)));
  const read = reader(frame, y);
  return pos => (read ? summarizeRead(pos.length, i => read(pos[i]), method) : null);
}

/** Each frame row's key, as an index into `names` (first-seen order; a blank is "(Blank)"). Each distinct value is named once. */
function keyIndex(frame: Frame, key: Key) {
  const { field, part } = typeof key === 'string' ? { field: key, part: undefined } : key;
  const read = reader(frame, field) ?? (() => undefined);
  const names: string[] = [], byValue = new Map<unknown, number>(), byName = new Map<string, number>();
  const at = new Int32Array(frame.length);
  for (let k = 0; k < frame.length; k++) {
    const v = read(k);
    let i = byValue.get(v);
    if (i === undefined) {
      const s = part ? datePartKey(String(v ?? ''), part) : v;
      const n = s == null || s === '' ? '(Blank)' : String(s);
      byValue.set(v, (i = byName.get(n) ?? byName.set(n, names.push(n) - 1).get(n)!));
    }
    at[k] = i;
  }
  return { names, at };
}

/** Frame positions by bucket (row k is in bucket `of[k]`, 0…n−1), each in row order: slices of one array, no list per cell. */
function buckets(of: Int32Array, n: number): Int32Array[] {
  const start = new Int32Array(n + 1);
  for (let k = 0; k < of.length; k++) start[of[k] + 1]++;
  for (let b = 0; b < n; b++) start[b + 1] += start[b];
  const pos = new Int32Array(of.length), next = start.slice(0, n);
  for (let k = 0; k < of.length; k++) pos[next[of[k]]++] = k;
  return Array.from({ length: n }, (_, b) => pos.subarray(start[b], start[b + 1]));
}

/**
 * Summarizes `y` per (x, group): a field with `method` (default sum), or a measure worked out over each cell's
 * rows. With `showAs` every cell becomes a percentage of the grand total (0 of a zero total). Categories and groups
 * keep first-seen order; a blank one is "(Blank)".
 */
export function pivot(frame: Frame, x: Key, y: string | MeasureFn, group?: Key, method: AggregationMethod = 'sum', showAs?: ShowAs) {
  const cat = keyIndex(frame, x);
  const ser = group ? keyIndex(frame, group) : null;
  // `any`: some cell had a value (all blank draws nothing)
  let any = false;
  const sum = reducer(frame, y, method);
  const reduce = (pos: Int32Array) => {
    const v = sum(pos);
    return v == null ? 0 : ((any = true), v);
  };
  const groups = new Map<string, Map<string, number>>();
  const cellsOf = (g: string) => groups.get(g) ?? groups.set(g, new Map()).get(g)!;
  if (ser) {
    // a cell is an (x, group) pair, numbered in first-seen order
    const nc = cat.names.length, ids = new Map<number, number>(), cell = new Int32Array(frame.length), cc: number[] = [], cg: number[] = [];
    for (let k = 0; k < frame.length; k++) {
      const key = ser.at[k] * nc + cat.at[k];
      let j = ids.get(key);
      if (j === undefined) ids.set(key, (j = cc.push(cat.at[k]) - 1)), cg.push(ser.at[k]);
      cell[k] = j;
    }
    buckets(cell, cc.length).forEach((pos, j) => cellsOf(ser.names[cg[j]]).set(cat.names[cc[j]], reduce(pos)));
  }
  const totals = new Map(buckets(cat.at, cat.names.length).map((pos, i) => [cat.names[i], reduce(pos)]));
  // without a group, the one group's cells are the categories
  if (!ser && totals.size) groups.set('', new Map(totals));
  if (showAs === 'percent-of-total') {
    const pct = (v: number, grand: number) => (grand ? (v / grand) * 100 : 0);
    const grand = [...groups.values()].reduce((a, m) => a + [...m.values()].reduce((b, v) => b + v, 0), 0);
    for (const m of groups.values()) for (const [c, v] of m) m.set(c, pct(v, grand));
    const catGrand = [...totals.values()].reduce((a, v) => a + v, 0);
    for (const [c, v] of totals) totals.set(c, pct(v, catGrand));
  }
  return { cats: cat.names, totals, groups, any };
}

/** Keys sorted in place: dates oldest first, a field with a sort-by column in its order, else the data's order. */
const ordered = (keys: string[], dates?: boolean, cmp?: Order) => (dates ? keys.sort() : cmp ? keys.sort(cmp) : keys);

/**
 * The categories to draw, in order: dates oldest first, then `sort`; `topN` keeps the n largest (in that
 * order, or by value when there's no sort).
 */
export function orderCategories(cats: string[], totals: Map<string, number>, opt: Pick<ChartOptions, 'sort' | 'topN'>, dates = false, most = MAX_CATEGORIES, cmp?: Order): string[] {
  const value = (c: string) => totals.get(c) ?? 0;
  // the sort-by column's order holds for "label" too
  let out = ordered([...cats], dates, cmp);
  if (opt.sort === 'label') out.sort(cmp ?? compareText);
  else if (opt.sort) out.sort((a, b) => (opt.sort === 'value-asc' ? value(a) - value(b) : value(b) - value(a)));
  if (opt.topN && opt.topN > 0 && out.length > opt.topN) {
    const keep = new Set([...out].sort((a, b) => value(b) - value(a)).slice(0, opt.topN));
    out = out.filter(c => keep.has(c));
  }
  return out.slice(0, most);
}

/** A chart's groups (series): dates oldest first, a field with a sort-by column in its order, else the data's. */
const groupsOf = (groups: Map<string, Map<string, number>>, dates?: boolean, cmp?: Order) =>
  ordered([...groups.keys()], dates, cmp).map(g => [g, groups.get(g)!] as const);

/** Keeps the `n` largest entries, in their order, and folds the rest into "Other" (last), as bars keep their top n. */
function topN(entries: [string, number][], n: number): [string, number][] {
  if (entries.length <= n) return entries;
  const keep = new Set([...entries].sort((a, b) => b[1] - a[1]).slice(0, n));
  const rest = entries.reduce((a, e) => (keep.has(e) ? a : a + e[1]), 0);
  return [...entries.filter(e => keep.has(e)), ['Other', rest]];
}

/** True once a chart has every field it needs: nothing is guessed from the data. */
export function chartReady(el: ChartElement): boolean {
  const m = el.mapping || {};
  const kind = chartKind(el.chartType);
  return kind === 'gauge' ? !!m.y : kind === 'sankey' ? !!(m.x && m.y && m.group) : kind === 'combo' ? !!(m.x && (m.y || m.line)) : !!(m.x && m.y);
}

/** What a tooltip shows: a heading and one line per value (the hovered series marked active). */
export interface Tip {
  title: string;
  rows: { label: string; value: string; color?: string; active?: boolean }[];
}

export interface ChartSpec {
  /** What takes a color, by index: series, slices, groups (the format pane's Colors list). */
  names?: string[];
  /** Draws the chart as SVG at a tile's size; absent when there's nothing to draw. */
  draw?: (area: Area) => string;
  /** Series names + indexes for the chart's legend (drawn in HTML, the same for every chart). */
  legend: { name: string; index: number; line?: boolean }[];
  /** The tooltip for the pointer at `pt` (SVG coordinates) over `target`. */
  tip?: (target: Element, svg: SVGSVGElement, pt: { x: number; y: number }) => Tip | null;
}

/** What the chart needs to know beyond its element: which fields are dates, and the measures it can use. */
/** How a field's values are ordered when the field has a sort-by column. */
export type Order = (a: string, b: string) => number;

export interface ChartContext {
  xDate?: boolean;
  groupDate?: boolean;
  /** A field's order from its sort-by column, if it has one. */
  order?: (ref: string) => Order | undefined;
  /** A "[measure]" reference's function, name and format. */
  measure?: (ref: string) => { fn: MeasureFn; name: string; format?: string } | null;
  /** The visual as a comparison sees it (its date filters moved): its rows, and its measures over them. */
  compared?: (c: Compare) => { frame: Frame; measure: ChartContext['measure']; moved?: boolean };
}

/** A value field: summarized with `method`, or a measure (worked out as is). */
export function valueOf(ctx: ChartContext, ref: string, method: AggregationMethod, showAs?: ShowAs, c?: Compare) {
  const m = ctx.measure?.(ref);
  return m
    ? { by: m.fn as string | MeasureFn, label: valueLabel(m.name, showAs, c), format: unitless(m.format) }
    : { by: ref as string | MeasureFn, label: summaryLabel(ref, method, showAs, c), format: undefined };
}

/** A pivot's values compared with another's (b's period keys already moved onto a's): b, a − b or the % change. */
const against = (a: number, b?: number, show?: Compare['show']) => comparison(a, b, show)?.d ?? NaN;

const STAT_NAMES = { average: 'Average', median: 'Median', min: 'Minimum', max: 'Maximum' };
/** A statistic of a series' values (a reference line's), or null when it has none. */
function statOf(data: number[], stat: keyof typeof STAT_NAMES): number | null {
  const v = data.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return stat === 'min' ? v[0] : stat === 'max' ? v[v.length - 1] : stat === 'median' ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : v.reduce((a, b) => a + b, 0) / v.length;
}

/** A chart format with display units for its axis and labels (shares and percents keep theirs). */
const inUnits = (f: ChartFormat, units?: string) => (units && units !== 'auto' && f !== 'share' && f !== 'percent' ? (`${f ?? 'number'}|${units}` as ChartFormat) : f);

/** Values added up along the axis, in its order. */
const run = (data: number[], s?: ShowAs) => {
  let t = 0;
  return s === 'running-total' ? data.map(v => (t += v)) : data;
};

/** The data-i of the drawn piece under the pointer (a slice, curve, node, band), or −1. */
const pieceOf = (target: Element, selector: string) => Number(target.closest(selector)?.getAttribute('data-i') ?? -1);

/** Column, bar, line, area and combo charts. */
function buildXY(el: ChartElement, frame: Frame, ctx: ChartContext): ChartSpec | null {
  const kind = chartKind(el.chartType);
  const { x, y, group, line } = el.mapping || {};
  const opt = el.options || {};
  const ys = el.summary || {};
  // a combo's line shares the value axis: shown as the bars are (a share of its total, say) unless it says otherwise
  const ls = { showAs: ys.showAs, ...el.lineSummary };
  const method = ys.aggregate || 'sum';
  const lineMethod = ls.aggregate || 'sum';
  const yv = y ? valueOf(ctx, y, method, ys.showAs, ys.compare) : null;
  const lv = kind === 'combo' && line ? valueOf(ctx, line, lineMethod, ls.showAs, ls.compare) : null;
  const valueFmt: ChartFormat = pct(ys.showAs) ? 'share' : ys.compare && !ys.compare.show ? 'percent' : opt.format ?? yv?.format ?? lv?.format;
  // 100% stacked: each category's pieces become shares of it (a combo's line has no category total to share); lines
  // don't stack, but show their shares
  const stacked = !!opt.stack && kind !== 'line';
  const percent = opt.stack === 'percent' && kind !== 'combo';
  const fmt: ChartFormat = percent ? 'share' : valueFmt;
  // a combo's line in its own format: a % change is a percent, a measure keeps its format (the axis stays the bars')
  const lineFmt: ChartFormat = pct(ls.showAs) ? 'share' : ls.compare && !ls.compare.show ? 'percent' : lv?.format ?? fmt;
  const xPart = el.dateParts?.x;
  const groupPart = el.dateParts?.group;

  const xk = keyOf(x!, xPart);
  const gk = group && keyOf(group, groupPart);
  // each category (and series) against the visual's other period: its date filters moved, and a date axis with them
  const versus = (p: ReturnType<typeof pivot>, ref: string, m: AggregationMethod, c?: Compare, g?: Key) => {
    const o = c && ctx.compared?.(c);
    if (!o) return p;
    // nothing moved and no date axis: there's no other period to compare with
    const q = pivot(o.moved || (c!.shift && ctx.xDate) ? o.frame : tableFrame(), xk, valueOf({ measure: o.measure }, c!.field || ref, m).by, g, m);
    const both = (a: Map<string, number>, b?: Map<string, number>) => {
      const moved = new Map([...(b ?? [])].map(([k, v]) => [c!.shift && ctx.xDate ? shiftKey(k, xPart ?? 'day', c!.shift, 1) : k, v]));
      return new Map(p.cats.map(k => [k, against(a.get(k) ?? 0, moved.get(k), c!.show)]));
    };
    return { ...p, totals: both(p.totals, q.totals), groups: new Map([...p.groups].map(([s, cells]) => [s, both(cells, q.groups.get(s))])) };
  };
  const bars = yv ? versus(pivot(frame, xk, yv.by, gk, method, ys.showAs), y!, method, ys.compare, gk) : null;
  const lineData = lv ? versus(pivot(frame, xk, lv.by, undefined, lineMethod, ls.showAs), line!, lineMethod, ls.compare) : null;
  const allCats = [...new Set([...(bars?.cats || []), ...(lineData?.cats || [])])];
  const totals = new Map(allCats.map(c => [c, (bars?.totals.get(c) ?? 0) + (bars ? 0 : lineData!.totals.get(c) ?? 0)]));
  const cats = orderCategories(allCats, totals, opt, ctx.xDate, undefined, xPart ? undefined : ctx.order?.(x!));
  if (!cats.length || !(bars?.any || lineData?.any)) return null;

  const valueName = yv?.label ?? '';
  const series = (bars ? groupsOf(bars.groups, ctx.groupDate, group && !groupPart ? ctx.order?.(group) : undefined) : []).map(([name, m]) => ({
    name: group ? datePartLabel(name, groupPart) : valueName,
    data: run(cats.map(c => m.get(c) ?? 0), ys.showAs),
    line: kind === 'line' || kind === 'area',
    area: kind === 'area'
  }));
  if (lineData) series.push({ name: lv!.label, data: run(cats.map(c => lineData.totals.get(c) ?? 0), ls.showAs), line: true, area: false, f: lineFmt } as any);
  const shares = percent
    ? series.map(s => s.data.map((v, i) => {
        const total = series.reduce((a, t) => a + Math.abs(t.data[i]), 0);
        return total ? (v / total) * 100 : 0;
      }))
    : null;
  const shown = cats.map(c => datePartLabel(c, xPart));
  const drawn = shares ? series.map((s, k) => ({ ...s, data: shares[k] })) : series;
  const format = (v: number, digits?: number, f: ChartFormat = fmt) => formatCompact(v, inUnits(f, opt.units), digits);
  // one series of bars can take a color per bar
  const vary = !!opt.varyColors && series.length === 1 && !series[0].line;
  const chart = xyChart({
    horizontal: kind === 'hbar',
    cats: shown,
    series: drawn,
    stacked,
    title: opt.yAxisLabel || (lineData && y ? `${valueName} · ${series[series.length - 1].name}` : valueName || series[0]?.name),
    fixed: percent && !stacked ? { min: 0, max: 100 } : { min: opt.min, max: opt.max },
    format,
    showValues: opt.showValues,
    catTitle: opt.xAxisLabel,
    hideValueAxis: opt.valueAxis === false,
    hideCategoryAxis: opt.categoryAxis === false,
    grid: opt.gridlines,
    barWidth: opt.barWidth,
    barRadius: opt.barRadius,
    vary,
    lineWidth: opt.lineWidth,
    markers: opt.markers,
    refs: (opt.refLines ?? []).flatMap(r => {
      const v = r.stat ? statOf(drawn[0]?.data ?? [], r.stat) : r.value;
      return v == null || !Number.isFinite(v) ? [] : [{ value: v, label: `${r.label ?? (r.stat ? STAT_NAMES[r.stat] : '')} ${format(v)}`.trim(), color: r.color }];
    })
  });

  return {
    draw: chart.draw,
    names: vary ? shown : series.map(s => s.name),
    legend:
      opt.showLegend === false || !(group || kind === 'combo')
        ? []
        : series.map((s, index) => ({ name: s.name, index, line: s.line && !s.area })),
    tip: (target, _svg, pt) => {
      const i = chart.hit(pt.x, pt.y);
      if (i < 0) return null;
      // the bar under the pointer marks its series
      const active = target.tagName === 'rect' ? Number(target.closest('[data-s]')?.getAttribute('data-s') ?? -1) : -1;
      const value = (k: number) => (shares ? `${formatFull(shares[k][i], 'share')} (${formatFull(series[k].data[i], valueFmt)})` : formatFull(series[k].data[i], (series[k] as any).f ?? fmt));
      return { title: shown[i], rows: series.map((s, k) => ({ label: s.name, value: value(k), color: seriesColor(k), active: k === active })) };
    }
  };
}

/** Legend entries for names drawn in series colors, in order (none when the legend is switched off). */
export const legendOf = (opt: ChartOptions, names: string[]) => (opt.showLegend === false ? [] : names.map((name, index) => ({ name, index })));

export function buildChart(el: ChartElement, frame: Frame, ctx: ChartContext = {}): ChartSpec {
  const kind = chartKind(el.chartType);
  const { x, y, group } = el.mapping || {};
  const opt = el.options || {};
  const method = el.summary?.aggregate || 'sum';
  const showAs = el.summary?.showAs;
  const none: ChartSpec = { legend: [] };
  if (!frame.length || kind === 'gauge' || !chartReady(el)) return none;
  if (['bar', 'hbar', 'line', 'area', 'combo'].includes(kind)) return buildXY(el, frame, ctx) ?? none;
  if (kind === 'scatter') return buildScatter(el, frame, ctx) ?? none;
  const xKey = keyOf(x!, el.dateParts?.x);
  const groupKey = group && keyOf(group, el.dateParts?.group);
  const { by: yKey, label: yLabel, format } = valueOf(ctx, y!, method, showAs);
  const fmt: ChartFormat = pct(showAs) ? 'share' : opt.format ?? format;
  // labels and values drawn in the chart (tooltips stay exact)
  const short = (v: number) => formatCompact(v, inUnits(fmt, opt.units));
  const xLabel = (c: string) => datePartLabel(c, el.dateParts?.x);
  const gLabel = (g: string) => datePartLabel(g, el.dateParts?.group);
  const xOrder = el.dateParts?.x ? undefined : ctx.order?.(x!);
  const gOrder = !group || el.dateParts?.group ? undefined : ctx.order?.(group);
  /** A tooltip with one value. */
  const tipOf = (title: string, v: number): Tip => ({ title, rows: [{ label: yLabel, value: formatFull(v, fmt) }] });

  if (kind === 'pie' || kind === 'donut') {
    const { cats, totals } = pivot(frame, xKey, yKey, undefined, method, showAs);
    // every slice in order (dates oldest first); past the top n, the rest are one "Other"
    const ordered = orderCategories(cats, totals, { sort: opt.sort }, ctx.xDate, Infinity, xOrder);
    const slices = topN(ordered.map(c => [xLabel(c), totals.get(c) ?? 0] as [string, number]).filter(([, v]) => v > 0), opt.topN || MAX_SLICES - 1);
    if (!slices.length) return none;
    const total = slices.reduce((a, [, v]) => a + v, 0) || 1;
    return {
      draw: pieChart(slices.map(([, v]) => v), kind === 'donut' ? opt.donutHole ?? DONUT_HOLE : 0),
      names: slices.map(([n]) => n),
      legend: legendOf(opt, slices.map(([n, v]) => (opt.showValues ? `${n} · ${short(v)}` : n))),
      tip: (target) => {
        const hit = slices[pieceOf(target, '.c-slice')];
        return hit ? { title: hit[0], rows: [...tipOf('', hit[1]).rows, { label: 'Share', value: `${((hit[1] / total) * 100).toFixed(1)}%` }] } : null;
      }
    };
  }

  if (kind === 'radar') {
    const { cats, totals, groups } = pivot(frame, xKey, yKey, groupKey, method, showAs);
    const axes = orderCategories(cats, totals, opt, ctx.xDate, undefined, xOrder).slice(0, 12);
    const curves = groupsOf(groups, ctx.groupDate, gOrder).slice(0, 8);
    return {
      draw: radarChart(axes.map(xLabel), curves.map(([, m]) => axes.map(c => m.get(c) || 0)), opt.min, opt.max),
      names: curves.map(([name]) => gLabel(name) || yLabel),
      legend: curves.length > 1 ? legendOf(opt, curves.map(([name]) => gLabel(name) || yLabel)) : [],
      tip: (target) => {
        const i = pieceOf(target, '.c-curve');
        if (!curves[i]) return null;
        const [name, m] = curves[i];
        return { title: gLabel(name) || yLabel, rows: axes.map(c => ({ label: xLabel(c), value: formatFull(m.get(c) || 0, fmt), color: seriesColor(i) })) };
      }
    };
  }

  if (kind === 'treemap') {
    const { groups } = pivot(frame, xKey, yKey, groupKey, method, showAs);
    const roots: TreeNode[] = [];
    const drawn: string[] = []; // parents in drawing order: they're colored by position
    for (const [parent, m] of groupsOf(groups, ctx.groupDate, gOrder)) {
      const leaves = topN([...m].filter(([, v]) => v > 0), MAX_SLICES * 2).map(([n, v]) => ({ name: xLabel(n), value: v }));
      if (!leaves.length) continue;
      drawn.push(gLabel(parent));
      if (group) roots.push({ name: gLabel(parent), children: leaves });
      else roots.push(...leaves);
    }
    if (!roots.length) return none;
    const chart = treemapChart(roots, short);
    return {
      draw: chart.draw,
      names: roots.map(r => r.name),
      legend: group ? legendOf(opt, drawn) : [],
      tip: (target) => {
        const node = chart.nodes[pieceOf(target, '.c-node')];
        return node ? tipOf(node.name, node.value) : null;
      }
    };
  }

  // sankey: x = source node, group = target node, y = flow value
  if (!group) return none;
  // (source, target) pairs are the cells: target as the category, source as the series
  const { groups: bySource } = pivot(frame, groupKey!, yKey, xKey, method, showAs);
  const flows = [...bySource].flatMap(([src, m]) => [...m].filter(([, v]) => v > 0).map(([dst, v]) => [src, dst, v] as const)).slice(0, 200);
  if (!flows.length) return none;
  // nodes in order of first appearance, each flow's source before its target
  const names: string[] = [];
  const index = new Map<string, number>();
  const node = (name: string) => index.get(name) ?? (index.set(name, names.length), names.push(name) - 1);
  const links = flows.map(([src, dst, v]) => ({ source: node(xLabel(src)), target: node(gLabel(dst)), value: v }));
  const chart = sankeyChart(names, links, short);
  return {
    draw: chart.draw,
    legend: [],
    tip: (target) => {
      const link = links[pieceOf(target, '.c-sankey-link')];
      if (link) return tipOf(`${names[link.source]} → ${names[link.target]}`, link.value);
      const i = pieceOf(target, '.c-sankey-node, .c-label');
      return names[i] !== undefined ? tipOf(names[i], chart.total(i)) : null;
    }
  };
}
