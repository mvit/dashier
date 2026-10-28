/**
 * What every chart is drawn with. Ported from Pele (https://github.com/obsidianmd/pele, MIT, © 2026 kepano),
 * whose way of drawing charts is the standard here: layouts are plain arithmetic, text is measured without
 * laying anything out, and a chart is one SVG string, inserted once. Unlike Pele, a chart is drawn at exactly
 * its tile's size, and Dashier draws the legends and titles (in HTML), so neither is here.
 */

/** Where a chart is drawn: the tile's size in px, and the report's font (for measuring text). */
export interface Area {
  w: number;
  h: number;
  font?: string;
}

/** Font sizes: Pele's 13px chart at its 0.875, 0.75 and 0.5625 steps. */
export const SIZE = 13;
export const SMALL = 11;
export const TINY = 10;
export const LEAST = 7;
/** Space around a chart. */
export const PAD = 8;
/** Length of an axis tick. */
export const TICK = 4;
const LINE_HEIGHT = 1.5;

// --- Writing SVG -------------------------------------------------------------------

const RE_NEEDS_ESC = /[&<>"\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const RE_ESC = /[&<>"]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Escapes text for XML and drops the control characters XML does not allow. */
export const esc = (text: string): string => (RE_NEEDS_ESC.test(text) ? text.replace(RE_ESC, c => ESC[c] ?? '') : text);

// The two decimals of a coordinate, by hundredths: building the string from integers is much faster than
// converting a double.
const FRACTION = Array.from({ length: 100 }, (_, i) => (i ? '.' + (i % 10 ? (i < 10 ? '0' + i : i) : i / 10) : ''));

export function num(value: number): string {
  const n = Math.round(value * 100);
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a < 1e11) {
    const q = Math.floor(a / 100);
    return (n < 0 ? '-' : '') + q + FRACTION[a - q * 100];
  }
  return String(n / 100);
}

/** A point, as a path writes it. */
export const pt = (x: number, y: number): string => num(x) + ',' + num(y);
/** The x and y attributes of a point. */
export const pos = (x: number, y: number): string => `x="${num(x)}" y="${num(y)}"`;
/** One line of text, its middle at y. */
export const textAt = (x: number, y: number, size: number, body: string, attrs = ''): string => `<text ${pos(x, y + size * 0.35)}${attrs}>${body}</text>`;
/** A group, left out when there is nothing in it. */
export const group = (attrs: string, body: string): string => (body ? `<g ${attrs}>${body}</g>` : '');

/** Color of the nth series, cycling through eight theme variables. */
export const seriesColor = (index: number): string => `var(--series-${(((index % 8) + 8) % 8) + 1})`;

// short names for the report theme's colors (see runtime/theme.ts), as the SVG repeats them; the font is the report's
const ROOT_STYLE =
  '--_bg:var(--surface);--_fg:var(--ink);--_m:var(--muted);--_a:var(--gridline);--_b:var(--line);color:var(--_fg);' +
  `font:${SIZE}px sans-serif;letter-spacing:normal;word-spacing:normal;text-transform:none;direction:ltr;font-family:inherit`;

/** The chart's <svg>, `type` naming its kind (c-xychart, c-pie, …), themed by the report's variables. */
export const svgDocument = (type: string, { w, h }: Area, content: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="c c-${type}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="${ROOT_STYLE}" fill="var(--_fg)" role="img">${content}</svg>`;

/** A rect's rounded corners. */
export const ROUNDED = ' rx="4"';

// --- Measuring text ------------------------------------------------------------------

export interface Measurer {
  width(text: string, size: number, bold?: boolean): number;
}

/** Estimated widths, where there is no canvas (tests): about 0.55em a character, bold about 7% wider. */
const metrics: Measurer = { width: (text, size, bold) => text.length * size * 0.55 * (bold ? 1.07 : 1) };

const MAX_CACHED = 20000;
const measurers = new Map<string, Measurer>();

/** The browser's own text widths for `font`, cached per font and text; estimated where there is no canvas. */
export function measurer(font = 'sans-serif'): Measurer {
  let m = measurers.get(font);
  if (m) return m;
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return metrics;
  const caches = new Map<string, Map<string, number>>();
  let current = '';
  m = {
    width(text, size, bold) {
      const key = (bold ? 'bold ' : '') + size + 'px ' + font;
      let cache = caches.get(key);
      if (!cache) caches.set(key, (cache = new Map()));
      let w = cache.get(text);
      if (w === undefined) {
        if (key !== current) ctx.font = current = key;
        w = ctx.measureText(text).width;
        if (cache.size >= MAX_CACHED) cache.clear();
        cache.set(text, w);
      }
      return w;
    }
  };
  measurers.set(font, m);
  return m;
}

/** A line or a few of text, measured: wrapped at a width, as Pele lays out a plain label. */
export interface Label {
  lines: string[];
  width: number;
  height: number;
  size: number;
  lineHeight: number;
}

const EMPTY: Label = { lines: [], width: 0, height: 0, size: 0, lineHeight: 0 };

/** Wraps at `max`; a line still wider than `limit` (a long word) is cut short with an ellipsis. */
export function layoutLabel(raw: string | undefined, m: Measurer, size: number, max: number, limit = max): Label {
  const text = raw?.trim();
  if (!text) return EMPTY;
  const lineHeight = Math.round(size * LINE_HEIGHT);
  const full = m.width(text, size);
  if (full <= max || (full <= limit && !text.includes(' '))) return { lines: [text], width: full, height: lineHeight, size, lineHeight };
  const lines: string[] = [];
  let line = '';
  let widest = 0;
  const commit = () => {
    line = line.trimEnd();
    if (m.width(line, size) > limit) line = fitText(line, limit, size, size, m)?.text ?? '…';
    lines.push(line);
    widest = Math.max(widest, m.width(line, size));
    line = '';
  };
  for (let piece of text.match(/\S+\s*/g) ?? []) {
    if (line && m.width(line + piece.trimEnd(), size) > max) {
      commit();
      piece = piece.trimStart();
    }
    line += piece;
  }
  commit();
  return { lines, width: widest, height: lines.length * lineHeight, size, lineHeight };
}

/** A label as SVG text centered on (cx, cy). */
export function labelSvg({ lines, size, height, lineHeight }: Label, cx: number, cy: number): string {
  const y = cy - height / 2 + lineHeight / 2;
  if (lines.length < 2) return lines.length ? textAt(cx, y, size, esc(lines[0]), ' text-anchor="middle"') : '';
  const top = y + size * 0.35;
  return `<text text-anchor="middle">${lines.map((l, i) => `<tspan ${pos(cx, top + i * lineHeight)}>${esc(l)}</tspan>`).join('')}</text>`;
}

/** A label with its left edge, center or right edge at x. */
export function aligned(label: Label, x: number, y: number, anchor: 'start' | 'middle' | 'end'): string {
  if (label.lines.length === 1) return textAt(x, y, label.size, esc(label.lines[0]), ` text-anchor="${anchor}"`);
  return labelSvg(label, x + (anchor === 'start' ? label.width / 2 : anchor === 'end' ? -label.width / 2 : 0), y);
}

/** A title up the left side of a plot, centered on y. */
export const sideTitle = (label: Label, y: number): string =>
  `<g transform="translate(${pt(PAD + label.height / 2, y)}) rotate(-90)">${labelSvg(label, 0, 0)}</g>`;

interface Fitted {
  text: string;
  size: number;
  width: number;
}

/**
 * Fits one line of text into a width: first by shrinking the font down to `min`, then by cutting the text
 * and adding an ellipsis. Undefined when not even one character fits.
 */
export function fitText(text: string, max: number, size: number, min: number, m: Measurer, bold = false): Fitted | undefined {
  if (text === '' || max <= 0) return undefined;
  let width = m.width(text, size, bold);
  if (width <= max) return { text, size, width };
  // width grows with font size, so one division lands on the right size or just above it
  for (let fitted = Math.max(min, Math.floor((size * max) / width)); fitted >= min; fitted--) {
    width = m.width(text, fitted, bold);
    if (width <= max) return { text, size: fitted, width };
  }
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (m.width(chars.slice(0, mid).join('').trimEnd() + '…', min, bold) <= max) low = mid;
    else high = mid - 1;
  }
  if (low === 0) return undefined;
  const cut = chars.slice(0, low).join('').trimEnd() + '…';
  width = m.width(cut, min, bold);
  return width <= max ? { text: cut, size: min, width } : undefined;
}

// --- Value axes ----------------------------------------------------------------------

/**
 * A step of 1, 2 or 5 times a power of ten that divides `span` into about `count` parts. A step below one
 * comes back as the negative of its inverse, a whole number, so that tick values are found by division and
 * print without rounding noise (0.3, not 0.30000000000000004).
 */
export function tickStep(span: number, count: number): number {
  const raw = span / Math.max(count, 1);
  const power = Math.floor(Math.log10(raw));
  const unit = raw / 10 ** power;
  const factor = unit >= 7.07 ? 10 : unit >= 3.16 ? 5 : unit >= 1.41 ? 2 : 1;
  return power < 0 ? -(10 ** -power) / factor : factor * 10 ** power;
}

const tickIndex = (step: number, value: number) => (step > 0 ? value / step : value * -step);
const tickValue = (step: number, index: number) => (step > 0 ? index * step : index / -step);

/** The multiples of a step from `lo` to `hi`, both included. */
export function ticksBetween(lo: number, hi: number, step: number): number[] {
  let first = Math.round(tickIndex(step, lo));
  if (tickValue(step, first) < lo) first++;
  let last = Math.round(tickIndex(step, hi));
  if (tickValue(step, last) > hi) last--;
  const out: number[] = [];
  for (let i = first; i <= last && out.length < 100; i++) out.push(tickValue(step, i));
  return out;
}

/** Axis tick labels, with as many decimals as it takes to tell them apart (0.02, not 0, beside 0.01). */
export function tickLabels(ticks: number[], format: (v: number, digits: number) => string): string[] {
  for (let d = 1; ; d++) {
    const out = ticks.map(v => format(v, d));
    if (d > 6 || new Set(out).size === out.length) return out;
  }
}

/**
 * A value axis over [lo, hi] with about `count` ticks. A bound left free grows to a whole step; a fixed one
 * (the chart's minimum or maximum) is kept. An empty range is opened up around its value.
 */
export function valueAxis(lo: number, hi: number, count: number, fixed: { min?: number; max?: number } = {}): { lo: number; hi: number; ticks: number[] } {
  const { min, max } = fixed;
  if (min !== undefined) lo = min;
  if (max !== undefined) hi = max;
  // one fixed end past the data: the other end moves, so the fixed one is kept
  if (!(lo < hi) && (min === undefined) !== (max === undefined)) min === undefined ? (lo = hi - (Math.abs(hi) || 1)) : (hi = lo + (Math.abs(lo) || 1));
  if (!(lo < hi)) {
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === 0) hi = 1;
    else (lo -= Math.abs(lo) / 2), (hi += Math.abs(hi) / 2);
  }
  const step = tickStep(hi - lo, Math.max(2, Math.min(10, count)));
  if (min === undefined) lo = tickValue(step, Math.floor(tickIndex(step, lo) + 1e-9));
  if (max === undefined) hi = tickValue(step, Math.ceil(tickIndex(step, hi) - 1e-9));
  return { lo, hi, ticks: ticksBetween(lo, hi, step) };
}
