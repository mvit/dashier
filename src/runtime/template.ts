/**
 * Text box templates, in Mustache's syntax: {{ name }} places a value, {{#name}}…{{/name}} repeats over a list
 * (or shows once when the value is set), {{^name}}…{{/name}} shows when it's empty, {{.}} is the item a section
 * is on, a.b reads a key, and {{! … }} is a comment. A value can pass through filters, left to right:
 * {{ name | upper }}, {{ total | round: 1 }}, {{#rows | sort: "revenue" | reverse | first: 3}}…{{/rows}}.
 * Summaries and number formats still come from each variable's field menu; filters shape what's left.
 * Values are written as plain text (Markdown in them shows as typed); {{& name}} or {{{ name }}} writes them as Markdown.
 * Templates are interpreted, never run as code, and what they write is capped.
 */
import { formatValue } from './charts';
import { compareValues } from './data';
import { monthName, toISODate } from './dates';

type Filter = { name: string; args: (string | number)[] };
type Node = string | { tag: '' | '#' | '^'; name: string; filters: Filter[]; body: Node[]; raw?: boolean };

/** A tag: {{{ raw }}}, or {{ name }} with an optional kind (# section, ^ inverted, / close, ! comment, & raw). */
const TAG = /\{\{(?:\{([\s\S]*?)\}|\s*([#^/!&]?)([\s\S]*?))\}\}/g;

/** The most a template writes: plenty for a text box, far short of freezing the page. */
const MAX_OUTPUT = 200_000;

const text = (v: unknown): string =>
  v == null || (typeof v === 'object' && !Array.isArray(v)) ? '' : Array.isArray(v) ? v.map(text).join(', ') : String(v);
const blank = (v: unknown) => v == null || v === '' || v === '—' || (Array.isArray(v) && !v.length);
/** Numbers numerically, anything else in natural text order, blanks (with — and empty lists) last. */
const compare = (a: unknown, b: unknown) => compareValues(a, b, blank);
/** A value as plain text in Markdown: what would style it, or open a list, heading or quote at a line's start, is escaped. */
const literal = (v: string, lineStart: boolean) =>
  v.replace(/[\\`*_[\]|]/g, '\\$&').replace(/(^|\n)([ \t]*)([-+#>]|\d+\.)/g, (m, nl, sp, c, at) =>
    at || lineStart ? nl + sp + (c.endsWith('.') ? c.slice(0, -1) + '\\.' : '\\' + c) : m);
const DAY = (y: number, m: number, d: number, style: 'long' | 'short') => new Date(y, m - 1, d).toLocaleString('en-US', { weekday: style });

const FILTERS: Record<string, (v: any, ...args: any[]) => unknown> = {
  upper: v => text(v).toUpperCase(),
  lower: v => text(v).toLowerCase(),
  title: v => text(v).replace(/(^|[^\p{L}'])(\p{L})/gu, (_, before, c) => before + c.toUpperCase()),
  truncate: (v, n = 50) => (text(v).length > n ? text(v).slice(0, n).trimEnd() + '…' : text(v)),
  round: (v, digits = 0) => {
    const k = 10 ** Math.max(-10, Math.min(10, Math.trunc(Number(digits)) || 0));
    return blank(v) || !Number.isFinite(Number(v)) ? v : Math.round(Number(v) * k) / k;
  },
  /** A number as the field menu would show it: "number" (1.2K), "integer", "currency" or "percent". */
  format: (v, f = 'number') => (blank(v) ? v : formatValue(v, f)),
  /** A date as the pattern says: yyyy, yy, MMMM (January), MMM (Jan), MM, M, dddd (Monday), ddd (Mon), dd, d. Other words stay as written. */
  date: (v, pattern = 'MMM d, yyyy') => {
    const iso = toISODate(v) ?? (/^\d{4}-\d{2}$/.test(String(v)) ? `${v}-01` : null);
    if (!iso) return v;
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    const parts: Record<string, string> = { yyyy: `${y}`, yy: `${y}`.slice(2), MMMM: monthName(m, 'long'), MMM: monthName(m), MM: `${m}`.padStart(2, '0'), M: `${m}`, dd: `${d}`.padStart(2, '0'), d: `${d}`, dddd: DAY(y, m, d, 'long'), ddd: DAY(y, m, d, 'short') };
    return String(pattern).replace(/[a-z]+/gi, w => (/^(yyyy|yy|M{1,4}|d{1,4})+$/.test(w) ? w.replace(/yyyy|yy|M{1,4}|d{3,4}|dd?/g, t => parts[t]) : w));
  },
  default: (v, fallback = '') => (blank(v) ? fallback : v),
  join: (v, sep = ', ') => (Array.isArray(v) ? v.map(text).join(sep) : v),
  first: (v, n?: number) => (Array.isArray(v) ? (n === undefined ? v[0] : v.slice(0, n)) : v),
  last: (v, n?: number) => (Array.isArray(v) ? (n === undefined ? v[v.length - 1] : v.slice(-n)) : v),
  size: v => (Array.isArray(v) || typeof v === 'string' ? v.length : 0),
  /** A list in order: rows by a field, values by themselves. */
  sort: (v, field?: string) => (Array.isArray(v) ? [...v].sort((a, b) => (field === undefined ? compare(a, b) : compare(a?.[field], b?.[field]))) : v),
  reverse: v => (Array.isArray(v) ? [...v].reverse() : v)
};
FILTERS.length = FILTERS.size;

/** Splits on `sep` outside quotes. */
function split(s: string, sep: string): string[] {
  const out: string[] = [];
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) quote = c === quote ? '' : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === sep) out.push(s.slice(start, i)), (start = i + 1);
  }
  return [...out, s.slice(start)].map(p => p.trim());
}

/** "name | filter: a, b | other" → the name and its filters (quoted args are text, the rest numbers or words). */
function expression(src: string): { name: string; filters: Filter[] } {
  const [name, ...rest] = split(src, '|');
  const filters = rest.map(f => {
    const colon = f.indexOf(':');
    const args = colon < 0 ? [] : split(f.slice(colon + 1), ',').map(a => (/^(["']).*\1$/s.test(a) ? a.slice(1, -1) : a !== '' && Number.isFinite(Number(a)) ? Number(a) : a));
    return { name: (colon < 0 ? f : f.slice(0, colon)).trim(), args };
  });
  return { name, filters };
}

const parsed = new Map<string, { nodes: Node[]; error?: string }>();

/** The template as a tree. A problem (an unclosed section, an unknown filter) is reported; what can be read is kept. */
function parse(src: string): { nodes: Node[]; error?: string } {
  const hit = parsed.get(src);
  if (hit) return hit;
  const root: Node[] = [];
  const open: { name: string; body: Node[] }[] = [{ name: '', body: root }];
  let error: string | undefined = /\{%/.test(src) ? 'Tags like {% %} aren\'t supported: use {{#name}}…{{/name}} for lists and conditions' : undefined;
  const fail = (e: string) => (error ??= e);
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    let [start, end] = [m.index!, m.index! + m[0].length];
    const raw = m[1] != null || m[2] === '&';
    const kind = raw ? '' : m[2];
    // a section or comment tag alone on its line takes the line with it, as in Mustache (so lists stay lists)
    if (kind) {
      const from = src.lastIndexOf('\n', start - 1) + 1;
      const nl = src.indexOf('\n', end);
      const to = nl < 0 ? src.length : nl + 1;
      if (from >= last && !src.slice(from, start).trim() && !src.slice(end, to).trim()) [start, end] = [from, to];
    }
    if (start > last) open[open.length - 1].body.push(src.slice(last, start));
    last = end;
    if (kind === '!') continue;
    const { name, filters } = expression(m[1] ?? m[3]);
    for (const f of filters) if (!FILTERS[f.name]) fail(`Unknown filter "${f.name}"`);
    if (kind === '/') {
      if (open.length > 1 && open[open.length - 1].name === name) open.pop();
      else fail(open.length > 1 ? `Unclosed section "${open[open.length - 1].name}"` : `Unopened section "${name}"`);
      continue;
    }
    const node = { tag: kind as '' | '#' | '^', name, filters, body: [] as Node[], raw };
    open[open.length - 1].body.push(node);
    if (kind) open.push({ name, body: node.body });
  }
  if (last < src.length) open[open.length - 1].body.push(src.slice(last));
  if (open.length > 1) fail(`Unclosed section "${open[open.length - 1].name}"`);
  const out = { nodes: root, error };
  if (parsed.size > 100) parsed.clear();
  parsed.set(src, out);
  return out;
}

/** True when the text uses {{ }} (or the {% %} it can only report). Plain Markdown skips the engine. */
export const isTemplate = (src: string) => /\{\{|\{%/.test(src);

/**
 * The variables a template expects: the names it uses outside sections, plus each section's name (names inside a
 * section read the items it repeats over). `all` adds the names inside sections, which fall back to variables when
 * an item doesn't have them. `error` is the first problem, if any.
 */
export function templateVariables(src: string): { names: string[]; all: string[]; error?: string } {
  if (!isTemplate(src)) return { names: [], all: [] };
  const { nodes, error } = parse(src);
  const names = new Set<string>();
  const all = new Set<string>();
  const walk = (list: Node[], top: boolean) => {
    for (const n of list)
      if (typeof n !== 'string') {
        const head = n.name.split('.')[0];
        if (n.name !== '.' && head) (top && names.add(head), all.add(head));
        walk(n.body, false);
      }
  };
  walk(nodes, true);
  return { names: [...names], all: [...all], error };
}

/**
 * The template with its names changed: `rename` gets each tag's name (its first part) and the sections the tag sits
 * in, outermost first, and gives the new name. A sort filter's field is a name inside the list being sorted.
 */
export function renameInTemplate(src: string, rename: (name: string, within: string[]) => string): string {
  const open: string[] = [];
  const head = (seg: string, within: string[]) => seg.replace(/^(\s*)([^\s.|]+)/, (_, sp, n) => sp + rename(n, within));
  return src.replace(TAG, (m, triple, kind, body) => {
    if (kind === '!') return m;
    const [first, ...rest] = split(triple ?? body, '|');
    const name = first.split('.')[0];
    if (kind === '/') open.pop();
    const out = [head(first, open), ...rest.map(f => f.replace(/^(sort\s*:\s*)(["'])(.*)\2$/, (_, a, q, field) => a + q + rename(field, [...open, name]) + q))];
    if (kind === '#' || kind === '^') open.push(name);
    // an unchanged tag keeps its spacing
    return out.every((o, i) => o === (i ? rest[i - 1] : first)) ? m : triple != null ? `{{{${out.join(' | ')}}}}` : `{{${kind}${out.join(' | ')}}}`;
  });
}

/** Fills a template. Values go in as they are (the Markdown step escapes them); `error` carries the first problem. */
export function renderTemplate(src: string, variables: Record<string, unknown>): { output: string; error?: string } {
  const { nodes, error } = parse(src);
  let out = '';
  // a name is looked up from the innermost section out, as in Mustache
  const lookup = (name: string, stack: unknown[]): unknown => {
    if (name === '.') return stack[stack.length - 1];
    const [head, ...path] = name.split('.');
    for (let i = stack.length - 1; i >= 0; i--) {
      const ctx = stack[i];
      // own keys only: a name like "constructor" is never something every object has
      if (ctx && typeof ctx === 'object' && Object.hasOwn(ctx, head)) return path.reduce<any>((v, k) => (v != null && Object.hasOwn(Object(v), k) ? v[k] : undefined), (ctx as any)[head]);
    }
    return undefined;
  };
  const value = (n: Exclude<Node, string>, stack: unknown[]) => n.filters.reduce((v, f) => (FILTERS[f.name] ? FILTERS[f.name](v, ...f.args) : v), lookup(n.name, stack));
  const walk = (list: Node[], stack: unknown[]) => {
    for (const n of list) {
      if (out.length > MAX_OUTPUT) throw new Error('The text is too long: over 200,000 characters');
      if (typeof n === 'string') out += n;
      else if (!n.tag) out += n.raw ? text(value(n, stack)) : literal(text(value(n, stack)), /(^|\n)[ \t]*$/.test(out.slice(-80)));
      else {
        const v = value(n, stack);
        const empty = !v || blank(v);
        if (n.tag === '^') empty && walk(n.body, stack);
        else if (Array.isArray(v)) for (const item of v) walk(n.body, [...stack, item]);
        else if (!empty) walk(n.body, [...stack, v]);
      }
    }
  };
  try {
    walk(nodes, [variables]);
    return { output: out, error };
  } catch (err: any) {
    return { output: out, error: String(err?.message || err) };
  }
}
