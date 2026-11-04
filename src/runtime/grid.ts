/**
 * What the table and the matrix share that needs no page or reactivity: row heights for virtual scrolling, column
 * widths measured from text, their look and density, conditional formatting, how cells read, and the cells themselves.
 * (The reactive parts, virtual scrolling and sorting, are with TableShell in widgets/TableWidget.tsx.)
 */
import type { AggregationMethod, Compare, GridStyle, ShowAs } from '../types/model';
import { measurer } from './draw/svg';
import { formatValue, summaryLabel, valueLabel } from './charts';

/** A body row's height by the grid's density (`.d-table tbody td` reads it as --row-h, its least height). */
export const ROW_H = 28;
export const rowHeight = (g?: GridStyle) => (g?.density === 'compact' ? 22 : g?.density === 'roomy' ? 36 : ROW_H);

/** A grid's look on its table widget: row height and text size as variables, banding and lines as classes. */
export const gridLook = (g?: GridStyle) => ({
  class: `${g?.banded ? ' banded' : ''}${g?.lines ? ` lines-${g.lines}` : ''}`,
  style: { '--row-h': `${rowHeight(g)}px`, '--cell-size': g?.textSize ? `${g.textSize}px` : undefined }
});
/** Rows sampled to size the columns. */
export const SAMPLE = 300;


/**
 * Row heights for virtual scrolling: every row starts at `estimate` (its density's height) and takes its real height
 * once it's drawn and measured. Each row's difference from the estimate is kept in a Fenwick tree, so where a row
 * starts and which row is at an offset take O(log n), however many rows there are.
 */
export function rowHeights(n: number, estimate: number) {
  const tree = new Float64Array(n + 1), delta = new Float64Array(n);
  const sum = (i: number) => {
    let s = 0;
    for (; i > 0; i -= i & -i) s += tree[i];
    return s;
  };
  return {
    /** Where row i starts; top(n) is every row's height together. */
    top: (i: number) => i * estimate + sum(i),
    /** Row i measured at h: by how much its height changed (0 for less than half a pixel). */
    set(i: number, h: number) {
      const d = h - estimate - delta[i];
      if (i >= n || Math.abs(d) < 0.5) return 0;
      delta[i] += d;
      for (let j = i + 1; j <= n; j += j & -j) tree[j] += d;
      return d;
    },
    /** The row at offset y (the last row past the end). */
    at(y: number) {
      let pos = 0, acc = 0;
      for (let s = 1 << (31 - Math.clz32(n || 1)); s; s >>= 1) {
        const p = pos + s;
        if (p <= n && p * estimate + acc + tree[p] <= y) (pos = p), (acc += tree[p]);
      }
      return Math.min(pos, Math.max(0, n - 1));
    }
  };
}

/** What sizes a column: its header, its total and a sample of its cells, as text, and room its cells need beside their text (`inset`: an indent). */
export type ColText = { head: string; cells: string[]; total?: string; inset?: number };

/**
 * Column widths in px, measured in the table's own font (on a canvas, as the charts measure their labels): enough for
 * the header and its sort arrow, the total and the sampled cells, the text within [4em, 28em], plus the cells' padding.
 * They come from the sample, not from the rows drawn, so nothing jumps while scrolling.
 */
export function columnWidths(cols: ColText[], font = { family: 'sans-serif', size: 11.5 }) {
  const m = measurer(font.family), w = (s: string, bold?: boolean) => m.width(s, font.size, bold);
  return cols.map((c) =>
    Math.ceil(Math.min(Math.max(4 * font.size, w(c.head, true) + 12, w(c.total ?? '', true), ...c.cells.map((s) => w(s) + (c.inset ?? 0))), 28 * font.size) + 22)
  );
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

/** A summarized column's header: its measure's name, or its summary ("%GT " first when shown as a share). */
export const summaryHeader = (field: string, method: AggregationMethod | undefined, showAs: ShowAs | undefined, m?: { name: string } | null, c?: Compare) =>
  m ? valueLabel(m.name, showAs, c) : summaryLabel(field, method, showAs, c);

/** A cell's text: blank when empty, a share as a percentage, else in `format`, else `plain`. */
export const cellText = (v: any, share: unknown, format: string | undefined, plain: (v: any) => string) =>
  v == null || v === '' ? '' : share ? formatValue(v, 'percent') : format ? formatValue(v, format) : plain(v);

/** A plain number as the reader's locale writes it, to two decimals (one formatter, made once: toLocaleString makes one per call). */
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const plainNumber = (v: number) => NUMBER.format(v);

/**
 * A body cell, made directly: a screen of new rows is a thousand cells, and a row only changes with its data or its
 * columns, so a cell needs no reactive part of its own. Its text (a web address as a link), class, and the shade of
 * conditional formatting; its whole text shows on hover when it's cut short.
 */
export function td(text: string, cls: string, shade?: { background: string }) {
  const cell = document.createElement('td');
  cell.className = cls;
  if (shade) cell.style.background = shade.background;
  cell.onmouseenter = fullText;
  cell.append(/^https?:\/\/\S+$/i.test(text) ? Object.assign(document.createElement('a'), { href: text, target: '_blank', rel: 'noopener', textContent: text }) : text);
  return cell;
}

/** A cell's whole text as its tooltip, when the cell cuts it short (set on hover: only then is it measured). */
export const fullText = (e: MouseEvent) => {
  const t = e.currentTarget as HTMLElement;
  t.title = t.scrollWidth > t.clientWidth ? t.textContent! : '';
};
