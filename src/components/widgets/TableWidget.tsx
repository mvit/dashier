import { Component, For, JSX, Show, createMemo } from 'solid-js';
import { GridStyle, TableElement, TableColumn, isNumericType } from '../../types/model';
import { store } from '../../runtime/store';
import { aggregateValue, pct, summarizeValue, withUnits } from '../../runtime/charts';
import { sortOrder } from '../../runtime/data';
import { datePartKey, datePartLabel } from '../../runtime/dates';
import { Frame, frameFields, reader, subset } from '../../runtime/frames';
import { SAMPLE, cellText, colWidth, condStyle, createSort, createVirtualRows, gridLook, rangeOf, rowHeight, summaryHeader } from './tableKit';

type Row = Record<string, any>;
type Read = (k: number) => unknown;
/** What the table shows: rows read by position (a frame's rows, or one object per group). */
type View = { length: number; read: (i: number) => Read };
const nothing: Read = () => undefined;

/**
 * What the table and the matrix draw in: a title, then a scrolling table of fixed column widths (in ch) whose
 * body holds only the rows in view (`children`), between spacers as tall as the rows scrolled past.
 */
export const TableShell: Component<{ title?: string; show: unknown; class: string; grid?: GridStyle; widths: number[]; virtual: ReturnType<typeof createVirtualRows>; head: JSX.Element; foot: JSX.Element; children: JSX.Element }> = (props) => {
  const spacer = (h: () => number) => (
    <Show when={h() > 0}>
      <tr class="d-spacer">
        <td colSpan={props.widths.length} style={{ height: `${h()}px` }} />
      </tr>
    </Show>
  );
  return (
    <div class={`d-table-widget${gridLook(props.grid).class}`} style={gridLook(props.grid).style}>
      <Show when={props.title}>
        <div class="chart-title">{props.title}</div>
      </Show>
      <Show when={props.show} fallback={<div class="d-chart-empty">{store.editing() ? 'Drag fields here' : ''}</div>}>
        <div class="table-container" ref={props.virtual.track} onScroll={props.virtual.measure}>
          <table class={props.class} style={{ width: `max(100%, ${props.widths.reduce((a, b) => a + b, 0)}ch)` }}>
            <colgroup>
              <For each={props.widths}>{(w) => <col style={{ width: `${w}ch` }} />}</For>
            </colgroup>
            {props.head}
            <tbody>
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
export const TableWidget: Component<{ element: TableElement }> = (props) => {
  const { sort, toggle, arrow } = createSort<number>();
  const el = () => props.element;

  const source = createMemo<Frame>(() => store.getFrame(el()));

  // A table that names no columns shows every field of its table (documents written by hand)
  const columns = createMemo<TableColumn[]>(() =>
    el().columns?.length ? el().columns! : frameFields(source()).map(field => ({ field, label: field }))
  );
  // a measure column is worked out per row group, like a summarized column
  const measureOf = (c: TableColumn) => store.measureInfo(el().sourceId, c.field, el());
  const summarized = (c: TableColumn) => !!c.aggregate || !!measureOf(c);
  /** A summarized column's value over a frame's rows. */
  const valueOf = (c: TableColumn, f: Frame) => (measureOf(c) ? measureOf(c)!.fn(f) : aggregateValue(f, c.aggregate, c.field));
  const numeric = (c: TableColumn) => summarized(c) || isNumericType(store.refType(el().sourceId, c.field));
  /** A column read by frame position: its date bucket when the column groups dates. */
  const columnReader = (f: Frame, c: TableColumn): Read => {
    const read = reader(f, c.field) ?? nothing;
    return c.datePart ? (k) => datePartKey(String(read(k) ?? ''), c.datePart!) : read;
  };

  /**
   * Without summarized columns the table reads the frame itself (rows stay in columns, however many). With
   * them, one object per combination of the other columns: groups are built from positions, not row copies.
   */
  const view = createMemo<View>(() => {
    const f = source();
    // columns are read by their place: two columns can show one field (its sum and its max, say)
    const cols = columns().map((c, i) => [c, i] as const);
    const sums = cols.filter(([c]) => summarized(c));
    if (!sums.length) {
      const readers = cols.map(([c]) => columnReader(f, c));
      return { length: f.length, read: (i) => readers[i] ?? nothing };
    }
    const dims = cols.filter(([c]) => !summarized(c));
    const dimRead = dims.map(([d]) => columnReader(f, d));
    const groups = new Map<string, number[]>();
    for (let k = 0; k < f.length; k++) {
      const key = dimRead.length === 1 ? String(dimRead[0](k) ?? '') : JSON.stringify(dimRead.map(r => r(k) ?? null));
      const g = groups.get(key);
      g ? g.push(k) : groups.set(key, [k]);
    }
    // a share is of its column's grand total; of a zero total, it's blank
    const grand = sums.map(([c]) => (pct(c.showAs) ? Number(valueOf(c, f)) : 1));
    const out: Row[] = [...groups.values()].map(pos => {
      // a group of blanks is named, as in charts and matrices
      const row: Row = Object.fromEntries(dims.map(([, i], j) => [i, dimRead[j](pos[0])]).map(([i, v]) => [i, v == null || v === '' ? '(Blank)' : v]));
      sums.forEach(([c, i], j) => {
        const read = reader(f, c.field);
        const v = measureOf(c) ? measureOf(c)!.fn(subset(f, Int32Array.from(pos))) : read ? summarizeValue(pos.length, i => read(pos[i]), c.aggregate) : null;
        row[i] = typeof v === 'number' ? (grand[j] ? v / grand[j] : null) : v;
      });
      return row;
    });
    return { length: out.length, read: (i) => (k) => out[k][i] };
  });

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

  /** Objects for the rows on screen only (positions [start, end) of the sorted view). */
  const rowsAt = ({ start, end }: { start: number; end: number }): Row[] => {
    const v = view();
    const o = order();
    const reads = columns().map((_, i) => v.read(i));
    return Array.from({ length: Math.max(0, end - start) }, (_, j) => {
      const k = o ? o[start + j] : start + j;
      return reads.map(read => read(k));
    });
  };
  const virtual = createVirtualRows(() => view().length, () => rowHeight(el().grid));

  const cell = (v: any, c: TableColumn) =>
    cellText(v, pct(c.showAs) && summarized(c), withUnits(c.format || measureOf(c)?.format, c.units), v =>
      typeof v === 'number' ? v.toLocaleString() : c.datePart ? datePartLabel(String(v), c.datePart) : String(v)
    );
  const header = (c: TableColumn) => (c.label && c.label !== c.field ? c.label : summaryHeader(c.field, c.aggregate, c.showAs, measureOf(c)));
  const align = (c: TableColumn) => `td-${c.align || (numeric(c) ? 'right' : 'left')}`;
  // "Total" goes in the first column that has no total of its own
  const totalLabelAt = () => totals().findIndex(t => t == null);

  /** Column widths: from the header, the totals and a sample of rows. */
  const widths = createMemo(() =>
    columns().map((c, i) => {
      const read = view().read(i);
      return colWidth(header(c), [cell(totals()[i], c), ...Array.from({ length: Math.min(SAMPLE, view().length) }, (_, k) => cell(read(k), c))], 48);
    })
  );

  return (
    <TableShell
      title={el().title}
      grid={el().grid}
      show={columns().length}
      class="d-table"
      widths={widths()}
      virtual={virtual}
      head={
        <thead>
          <tr>
            <For each={columns()}>
              {(c, i) => (
                <th class={align(c)} onClick={() => toggle(i())}>
                  {header(c)}
                  <span class="sort-icon">{arrow(i())}</span>
                </th>
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
      <For each={rowsAt(virtual.range())}>
        {(row, i) => (
          // the row's parity in the whole table, for banded rows (only the rows in view are drawn)
          <tr class={(virtual.range().start + i()) % 2 ? 'odd' : ''}>
            <For each={columns()}>
              {(c, i) => (
                <td class={align(c)} style={condStyle(c.cond, row[i()], ranges()[i()])}>
                  {cell(row[i()], c)}
                </td>
              )}
            </For>
          </tr>
        )}
      </For>
    </TableShell>
  );
};
