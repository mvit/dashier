/** What the table and the matrix share: virtual scrolling and conditional formatting. */
import { createMemo, createSignal } from 'solid-js';
import { observeSize } from '../../runtime/view';
import type { AggregationMethod, Compare, GridStyle, ShowAs } from '../../types/model';
import { formatValue, summaryLabel, valueLabel } from '../../runtime/charts';

/** A body row's height by the grid's density (`.d-table tbody td` reads it as --row-h). */
export const ROW_H = 28;
export const rowHeight = (g?: GridStyle) => (g?.density === 'compact' ? 22 : g?.density === 'roomy' ? 36 : ROW_H);

/** A grid's look on its table widget: row height and text size as variables, banding and lines as classes. */
export const gridLook = (g?: GridStyle) => ({
  class: `${g?.banded ? ' banded' : ''}${g?.lines ? ` lines-${g.lines}` : ''}`,
  style: { '--row-h': `${rowHeight(g)}px`, '--cell-size': g?.textSize ? `${g.textSize}px` : undefined }
});
/** Rows drawn beyond the visible ones on each side. */
const OVERSCAN = 12;
/** Tallest scroll height used: browsers cap element height (~33M px in Chrome), so beyond this, scrolling maps proportionally to rows. */
const MAX_H = 8_000_000;
/** Rows sampled to size the columns. */
export const SAMPLE = 300;

/**
 * Virtual scrolling: only the rows in view (plus OVERSCAN) go in the DOM, between two spacer rows of heights
 * `before` and `after`. `track` is the scroller's ref and `measure` its scroll handler.
 */
export function createVirtualRows(count: () => number, rowH: () => number = () => ROW_H) {
  let scroller!: HTMLDivElement;
  const [scroll, setScroll] = createSignal({ top: 0, height: 400 });
  const measure = () => setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
  // the scroller exists only once there's something to show, so it's observed from its own ref
  const track = (el: HTMLDivElement) => {
    scroller = el;
    observeSize(el, measure);
  };
  const range = createMemo(() => {
    const n = count();
    const step = rowH();
    const full = n * step;
    const total = Math.min(full, MAX_H);
    // the last scroll position may be past the end of rows that just shrank (filtered, grouped)
    const height = scroll().height;
    const top = Math.min(scroll().top, Math.max(0, total - height));
    // the (fractional) row at the top of the view; past MAX_H the scroll position maps proportionally
    // (the header and totals rows add a little scroll height, so the fraction is clamped)
    const first = full <= MAX_H ? top / step : Math.min(1, top / Math.max(1, total - height)) * Math.max(0, n - height / step);
    const start = Math.max(0, Math.floor(first) - OVERSCAN);
    const end = Math.min(n, Math.ceil(first + height / step) + OVERSCAN);
    const before = full <= MAX_H ? start * step : Math.max(0, top - (first - start) * step);
    return { start, end, before, after: Math.max(0, total - before - (end - start) * step) };
  });
  return { track, measure, range };
}

/** A conditionally formatted cell's background: a color scale, or a data bar, by where `v` falls in [lo, hi]. */
export function condStyle(cond: 'scale' | 'bars' | undefined, v: unknown, r: { lo: number; hi: number } | undefined) {
  if (!cond || !r || !Number.isFinite(Number(v)) || r.hi === r.lo) return undefined;
  const t = (Number(v) - r.lo) / (r.hi - r.lo);
  return cond === 'scale'
    ? { background: `color-mix(in srgb, var(--accent) ${Math.round(6 + t * 50)}%, transparent)` }
    : { background: `linear-gradient(90deg, color-mix(in srgb, var(--accent) 32%, transparent) ${(t * 100).toFixed(1)}%, transparent 0)` };
}

/** The range [min(0, lowest), max(0, highest)] of numbers read from `count` cells. */
export function rangeOf(count: number, read: (k: number) => unknown) {
  let lo = 0, hi = 0;
  for (let k = 0; k < count; k++) {
    const v = Number(read(k));
    if (Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  }
  return { lo, hi };
}

/** Header-click sorting by `key`: ascending, descending, then back to the original order. `arrow` marks the header. */
export function createSort<K>() {
  const [sort, setSort] = createSignal<{ key: K; desc: boolean } | null>(null);
  const toggle = (key: K) => {
    const s = sort();
    setSort(s?.key !== key ? { key, desc: false } : s.desc ? null : { key, desc: true });
  };
  const arrow = (key: K) => (sort()?.key === key ? (sort()!.desc ? ' ▼' : ' ▲') : '');
  return { sort, toggle, arrow };
}

/** A summarized column's header: its measure's name, or its summary ("%GT " first when shown as a share). */
export const summaryHeader = (field: string, method: AggregationMethod | undefined, showAs: ShowAs | undefined, m?: { name: string } | null, c?: Compare) =>
  m ? valueLabel(m.name, showAs, c) : summaryLabel(field, method, showAs, c);

/** A cell's text: blank when empty, a share as a percentage, else in `format`, else `plain`. */
export const cellText = (v: any, share: unknown, format: string | undefined, plain: (v: any) => string) =>
  v == null || v === '' ? '' : share ? formatValue(v, 'percent') : format ? formatValue(v, format) : plain(v);

/**
 * A column's width in ch, fixed from its header (and sort arrow) and cells' text, so that nothing jumps while
 * scrolling (as it would with the browser sizing columns from whatever rows happen to be drawn).
 */
export const colWidth = (header: string, cells: string[], max: number) => Math.min(Math.max(5, header.length + 2, ...cells.map(s => s.length)), max) + 3;

/** A cell's whole text as its tooltip, when the cell cuts it short (set on hover: only then is it measured). */
export const fullText = (e: MouseEvent) => {
  const t = e.currentTarget as HTMLElement;
  t.title = t.scrollWidth > t.clientWidth ? t.textContent! : '';
};
