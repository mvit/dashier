import { Component, For, JSX, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { GridStyle, TableElement, TableColumn, isNumericType } from '../../types/model';
import { store } from '../../runtime/store';
import { aggregateValue, pct, withUnits, valueOver } from '../../runtime/charts';
import { sortOrder, getOr } from '../../runtime/data';
import { datePartKey, datePartLabel } from '../../runtime/dates';
import { Frame, reader } from '../../runtime/frames';
import { empty } from './CardWidget';

import { ColText, ROW_H, SAMPLE, cellText, columnWidths, condStyle, gridLook, plainNumber, rangeOf, rowHeight, rowHeights, summaryHeader, td } from '../../runtime/grid';
import { observeSize } from '../../runtime/view';

type Row = Record<string, any>;
type Read = (k: number) => unknown;
/** What the table shows: rows read by position (a frame's rows, or one object per group). */
type View = { length: number; read: (i: number) => Read };
const nothing: Read = () => undefined;

/** Rows drawn beyond the visible ones on each side. */
const OVERSCAN = 12;
/** Tallest scroll height used: browsers cap element height (~33M px in Chrome), so beyond this, scrolling maps proportionally to rows. */
const MAX_H = 8_000_000;
/**
 * Virtual scrolling: only the rows in view (plus OVERSCAN) go in the DOM, between two spacer rows of heights
 * `before` and `after`. Rows start at `estimate` tall and are measured once drawn (`sized`, with the drawn rows in
 * order), so a row may be as tall as its content and the spacers still add up; when rows above the view turn out
 * taller or shorter, the scroll moves with them, so what's in view stays put. `track` is the scroller's ref and
 * `measure` its scroll handler.
 */
export function createVirtualRows(count: () => number, estimate: () => number = () => ROW_H) {
  let scroller: HTMLDivElement | undefined;
  const [scroll, setScroll] = createSignal({ top: 0, height: 400 });
  const [sizes, setSizes] = createSignal(0);
  // the rows' usual height once seen (a border makes a 28px row 29), so only rows that differ from it count as changed
  const [usual, setUsual] = createSignal<{ of: number; h: number }>();
  const step = () => (usual()?.of === estimate() ? usual()!.h : estimate());
  const measure = () => scroller && setScroll({ top: scroller.scrollTop, height: scroller.clientHeight });
  // the scroller exists only once there's something to show, so it's observed from its own ref
  const track = (el: HTMLDivElement) => {
    scroller = el;
    observeSize(el, measure);
  };
  const heights = createMemo(() => rowHeights(count(), step()));
  const range = createMemo(() => {
    sizes();
    const n = count(), h = heights(), full = h.top(n), total = Math.min(full, MAX_H), height = scroll().height;
    // the last scroll position may be past the end of rows that just shrank (filtered, grouped)
    const top = Math.min(scroll().top, Math.max(0, total - height));
    if (full <= MAX_H) {
      const start = Math.max(0, h.at(top) - OVERSCAN), end = Math.min(n, h.at(top + height) + 1 + OVERSCAN);
      return { start, end, before: h.top(start), after: full - h.top(end) };
    }
    // past MAX_H the scroll position maps proportionally to rows of their average height (the header and totals
    // rows add a little scroll height, so the fraction is clamped)
    const step = full / n, first = Math.min(1, top / Math.max(1, total - height)) * Math.max(0, n - height / step);
    const start = Math.max(0, Math.floor(first) - OVERSCAN), end = Math.min(n, Math.ceil(first + height / step) + OVERSCAN);
    const before = Math.max(0, top - (first - start) * step);
    return { start, end, before, after: Math.max(0, total - before - (end - start) * step) };
  });
  /** Rows measured: [position, height] (layout pixels, from a ResizeObserver: no layout of its own; a zoomed sheet doesn't change them). */
  const sized = (rows: [number, number][]) => {
    if (!scroller || !rows.length) return;
    // the first rows drawn set the usual height (the most common among them)
    if (usual()?.of !== estimate()) setUsual({ of: estimate(), h: rows.map((r) => r[1]).sort((a, b) => a - b)[rows.length >> 1] });
    const h = heights(), exact = h.top(count()) <= MAX_H, first = h.at(scroller.scrollTop);
    let changed = false, shift = 0;
    for (const [p, height] of rows) {
      const d = h.set(p, height);
      if (d) (changed = true), exact && p < first && (shift += d);
    }
    if (shift) scroller.scrollTop += shift;
    if (changed) setSizes((v) => v + 1);
  };
  return { track, measure, range, sized };
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

/** A header cell that sorts by `k` when clicked (`on` false: it doesn't sort), showing the sort's arrow. */
export const SortTh: Component<{ sort: ReturnType<typeof createSort<number>>; k: number; on?: boolean; class?: string; colSpan?: number; rowSpan?: number; children: JSX.Element }> = (p) => (
  <th class={p.class} colSpan={p.colSpan} rowSpan={p.rowSpan} onClick={() => p.on !== false && p.sort.toggle(p.k)}>
    {p.children}
    <span class="sort-icon">{p.on !== false ? p.sort.arrow(p.k) : ''}</span>
  </th>
);

/**
 * What the table and the matrix draw in: a title, then a scrolling table whose columns are measured from `cols` in the
 * table's own font, and whose body holds only the rows in view (`children`), between spacers as tall as the rows
 * scrolled past. The drawn rows are measured after every change, and whenever the body changes size.
 */
export const TableShell: Component<{ title?: string; show: unknown; class: string; grid?: GridStyle; cols: ColText[]; virtual: ReturnType<typeof createVirtualRows>; head: JSX.Element; foot: JSX.Element; children: JSX.Element }> = (props) => {
  let table: HTMLTableElement | undefined, body: HTMLTableSectionElement | undefined;
  // the font the cells are set in (the grid's text size, the report's font), read once drawn
  const [font, setFont] = createSignal<{ family: string; size: number }>();
  const readFont = () => table && (({ fontFamily: family, fontSize }) => setFont({ family, size: parseFloat(fontSize) }))(getComputedStyle(table));
  createEffect(() => (props.grid?.textSize, store.reportTheme(), readFont()));
  const widths = createMemo(() => columnWidths(props.cols, font()));
  // the drawn rows (each with its position, data-p) are watched: their heights come as the browser lays them out,
  // without a layout of their own, and again whenever one changes (a new column width wraps its text)
  const watched = new Set<Element>();
  const watch = new ResizeObserver((es) => props.virtual.sized(es.map((e) => [Number((e.target as HTMLElement).dataset.p), e.borderBoxSize[0]?.blockSize ?? e.contentRect.height])));
  onCleanup(() => watch.disconnect());
  createEffect(() => {
    props.virtual.range();
    if (!body) return;
    const now = new Set<Element>([...body.rows].filter((r) => r.dataset.p));
    for (const r of watched) if (!now.has(r)) watch.unobserve(r), watched.delete(r);
    for (const r of now) if (!watched.has(r)) watch.observe(r), watched.add(r);
  });
  const spacer = (h: () => number) => (
    <Show when={h() > 0}>
      <tr class="d-spacer">
        <td colSpan={widths().length} style={{ height: `${h()}px` }} />
      </tr>
    </Show>
  );
  return (
    <div class={`d-table-widget${gridLook(props.grid).class}`} style={gridLook(props.grid).style}>
      <Show when={props.title}>
        <div class="chart-title">{props.title}</div>
      </Show>
      <Show when={props.show} fallback={empty('Drag fields here')}>
        <div class="table-container" ref={props.virtual.track} onScroll={props.virtual.measure}>
          <table class={props.class} ref={(el) => ((table = el), queueMicrotask(readFont))} style={{ width: `max(100%, ${widths().reduce((a, b) => a + b, 0)}px)` }}>
            <colgroup>
              <For each={widths()}>{(w) => <col style={{ width: `${w}px` }} />}</For>
            </colgroup>
            {props.head}
            <tbody ref={body}>
              {spacer(() => props.virtual.range().before)}
              {props.children}
              {spacer(() => props.virtual.range().after)}
            </tbody>
            {props.foot}
          </table>
        </div>
      </Show>
    </div>
  );
};

/**
 * A table: scrolls inside its tile (only the rows in view are drawn, so large tables stay fast),
 * sorts by header click, groups rows when a column is summarized, and ends with a totals row.
 */
// A table's columns, values and rows, for its widget and its CSV alike

/** A measure column is worked out per row group, like a summarized column. */
const measureIn = (el: TableElement, c: TableColumn) => store.measureInfo(el.sourceId, c.field, el);
const isSummarized = (el: TableElement, c: TableColumn) => !!c.aggregate || !!measureIn(el, c);
/** A summarized column's value over a frame's rows. */
const valueIn = (el: TableElement, c: TableColumn, f: Frame) => (measureIn(el, c) ? measureIn(el, c)!.fn(f) : aggregateValue(f, c.aggregate, c.field));
/** A column read by frame position: its date bucket when the column groups dates. */
const readerOf = (f: Frame, c: TableColumn): Read => {
  const read = reader(f, c.field) ?? nothing;
  return c.datePart ? (k) => datePartKey(String(read(k) ?? ''), c.datePart!) : read;
};
const headerOf = (el: TableElement, c: TableColumn) => (c.label || summaryHeader(c.field, c.aggregate, c.showAs, measureIn(el, c)));

/**
 * What a table shows. Without summarized columns it reads the frame itself (rows stay in columns, however many).
 * With them, one object per combination of the other columns: groups are built from positions, not row copies.
 */
function viewOf(el: TableElement, f: Frame, columns: TableColumn[]): View {
  // columns are read by their place: two columns can show one field (its sum and its max, say)
  const cols = columns.map((c, i) => [c, i] as const);
  const sums = cols.filter(([c]) => isSummarized(el, c));
  if (!sums.length) {
    const readers = cols.map(([c]) => readerOf(f, c));
    return { length: f.length, read: (i) => readers[i] ?? nothing };
  }
  const dims = cols.filter(([c]) => !isSummarized(el, c));
  const dimRead = dims.map(([d]) => readerOf(f, d));
  const groups = new Map<string, number[]>();
  for (let k = 0; k < f.length; k++) {
    const key = dimRead.length === 1 ? String(dimRead[0](k) ?? '') : JSON.stringify(dimRead.map((r) => r(k) ?? null));
    getOr(groups, key, () => []).push(k);
  }
  // a share is of its column's grand total; of a zero total, it's blank
  const grand = sums.map(([c]) => (pct(c.showAs) ? Number(valueIn(el, c, f)) : 1));
  const over = sums.map(([c]) => valueOver(f, c.field, c.aggregate, measureIn(el, c)?.fn));
  const out: Row[] = [...groups.values()].map((pos) => {
    // a group of blanks is named, as in charts and matrices
    const row: Row = Object.fromEntries(dims.map(([, i], j) => [i, dimRead[j](pos[0])]).map(([i, v]) => [i, v == null || v === '' ? '(Blank)' : v]));
    sums.forEach(([, i], j) => {
      const v = over[j](pos);
      row[i] = typeof v === 'number' ? (grand[j] ? v / grand[j] : null) : v;
    });
    return row;
  });
  return { length: out.length, read: (i) => (k) => out[k][i] };
}

/** A table as CSV rows: its headers, then every row in its own order; numbers stay numbers (shares as fractions), dates as their buckets' names. */
export function tableCSV(el: TableElement): string[][] {
  const f = store.getFrame(el), columns = el.columns ?? [], v = viewOf(el, f, columns);
  const reads = columns.map((_, i) => v.read(i));
  const text = (x: unknown, c: TableColumn) => (x == null ? '' : c.datePart ? datePartLabel(String(x), c.datePart) : String(x));
  return [columns.map((c) => headerOf(el, c)), ...Array.from({ length: v.length }, (_, k) => columns.map((c, i) => text(reads[i](k), c)))];
}

export const TableWidget: Component<{ element: TableElement }> = (props) => {
  const sorter = createSort<number>(), { sort } = sorter;
  const el = () => props.element;

  const source = createMemo<Frame>(() => store.getFrame(el()));

  // plain copies: every cell reads its column's settings, and a store object's reads go through its proxy
  const columns = createMemo(() => (el().columns ?? []).map((c) => ({ ...c })));
  const measureOf = (c: TableColumn) => measureIn(el(), c);
  const summarized = (c: TableColumn) => isSummarized(el(), c);
  const valueOf = (c: TableColumn, f: Frame) => valueIn(el(), c, f);
  const numeric = (c: TableColumn) => summarized(c) || isNumericType(store.refType(el().sourceId, c.field));
  const view = createMemo<View>(() => viewOf(el(), source(), columns()));

  /** Sorted positions in the view (null: the view's own order). */
  const order = createMemo(() => {
    const s = sort();
    return s ? sortOrder(view().length, view().read(s.key), s.desc) : null;
  });

  /**
   * Totals: a summarized column's summary over all rows (100% when shown as a share);
   * "Don't summarize" columns (IDs, raw amounts) have none.
   */
  const totals = createMemo(() => columns().map(c => (summarized(c) ? (pct(c.showAs) ? (Number(valueOf(c, source())) ? 1 : null) : valueOf(c, source())) : null)));
  const hasTotals = () => el().totals !== false && view().length > 1 && totals().some(t => t != null);

  /** Range of each conditionally formatted column, for its color scale or data bars. */
  const ranges = createMemo(() => columns().map((c, i) => (c.cond ? rangeOf(view().length, view().read(i)) : undefined)));

  /** Each column's reader, and the row at position p of the sorted view (only rows on screen are read). */
  const reads = createMemo(() => columns().map((_, i) => view().read(i)));
  const rowAt = (p: number): Row => {
    const o = order(), k = o ? o[p] : p;
    return reads().map((read) => read(k));
  };
  const virtual = createVirtualRows(() => view().length, () => rowHeight(el().grid));
  // the positions on screen, as numbers: a row still in view after a scroll keeps its DOM, only new ones are made
  const positions = createMemo(() => ((r) => Array.from({ length: r.end - r.start }, (_, j) => r.start + j))(virtual.range()));

  const align = (c: TableColumn) => `td-${numeric(c) ? 'right' : 'left'}`;
  /** Each column's alignment and how its values read, worked out once for the column rather than per cell. */
  const looks = createMemo(() =>
    columns().map((c) => {
      const share = pct(c.showAs) && summarized(c), format = withUnits(c.format || measureOf(c)?.format, c.units);
      return { align: align(c), text: (v: any) => cellText(v, share, format, (v) => (typeof v === 'number' ? plainNumber(v) : c.datePart ? datePartLabel(String(v), c.datePart) : String(v))) };
    })
  );
  const cell = (v: any, c: TableColumn) => looks()[columns().indexOf(c)].text(v);
  /** A row's cells, made in one pass (grid.ts's td). */
  const cellsOf = (row: Row) => looks().map((l, i) => td(l.text(row[i]), l.align, condStyle(columns()[i].cond, row[i], ranges()[i])));
  const header = (c: TableColumn) => headerOf(el(), c);
  // "Total" goes in the first column that has no total of its own
  const totalLabelAt = () => totals().findIndex(t => t == null);

  /** What the columns are sized from: the header, the totals and a sample of rows. */
  const cols = createMemo(() =>
    columns().map((c, i) => {
      const read = view().read(i);
      return { head: header(c), total: i === totalLabelAt() ? 'Total' : cell(totals()[i], c), cells: Array.from({ length: Math.min(SAMPLE, view().length) }, (_, k) => cell(read(k), c)) };
    })
  );

  return (
    <TableShell
      title={el().title}
      grid={el().grid}
      show={columns().length}
      class="d-table"
      cols={cols()}
      virtual={virtual}
      head={
        <thead>
          <tr>
            <For each={columns()}>
              {(c, i) => (
                <SortTh sort={sorter} k={i()} class={align(c)}>
                  {header(c)}
                </SortTh>
              )}
            </For>
          </tr>
        </thead>
      }
      foot={
        <Show when={hasTotals()}>
          <tfoot>
            <tr>
              <For each={columns()}>{(c, i) => <td class={align(c)}>{i() === totalLabelAt() ? 'Total' : cell(totals()[i()], c)}</td>}</For>
            </tr>
          </tfoot>
        </Show>
      }
    >
      <For each={positions()}>
        {(p) => {
          const row = createMemo(() => rowAt(p));
          return (
            // the row's parity in the whole table, for banded rows (only the rows in view are drawn)
            <tr class={p % 2 ? 'odd' : ''} data-p={p}>
              {cellsOf(row())}
            </tr>
          );
        }}
      </For>
    </TableShell>
  );
};
