import { Component, For, Index, Show, createMemo, createSignal } from 'solid-js';
import { MatrixElement, MatrixValue } from '../../types/model';
import { store } from '../../runtime/store';
import { MatrixRow, buildMatrix } from '../../runtime/matrix';
import { pct, withUnits } from '../../runtime/charts';
import { sortOrder, flipped } from '../../runtime/data';
import { SAMPLE, cellText, condStyle, plainNumber, rangeOf, rowHeight, summaryHeader, td } from '../../runtime/grid';
import { SortTh, TableShell, createSort, createVirtualRows } from './TableWidget';

const measureOf = (el: MatrixElement, ref: string) => store.measureInfo(el.sourceId, ref, el);
/** A matrix's numbers, under its filters: what its widget draws and its CSV holds. */
const matrixOf = (el: MatrixElement) =>
  buildMatrix(el, store.getFrame(el), (ref) => measureOf(el, ref)?.fn, (f) => store.sortOrder(el.sourceId, f), (c) => {
    const o = store.comparedView(el, c);
    return { ...o, measure: (ref) => o.measure(ref)?.fn };
  });
/** A value's header: its label, else its summary or measure's name. */
const valueLabelOf = (el: MatrixElement, v: MatrixValue) =>
  v.label || summaryHeader(v.field, v.aggregate ?? 'sum', v.showAs, measureOf(el, v.field), v.compare);
/** The row fields' names, read as words: "region / cost_type" → "Region / cost type". */
const rowTitleOf = (el: MatrixElement) => (el.rows ?? []).map((f) => f.field.split('.').pop()!.replace(/_/g, ' ')).join(' / ').replace(/^./, (c) => c.toUpperCase());

/**
 * A matrix as CSV rows: a header (each column's keys, and with several values, the value), every row group expanded
 * (indented by depth), and the totals. Numbers stay numbers (shares as fractions), for a spreadsheet to format.
 */
export function matrixCSV(el: MatrixElement): string[][] {
  const m = matrixOf(el), vals = el.values ?? [], nv = vals.length, n = (m.cols + (m.totalCol ? 1 : 0)) * nv;
  // each column's keys, a level at a time (a header spans the columns under it)
  const keysOf = (col: number) =>
    m.headers.map((level) => {
      let at = 0;
      return level.find((h) => (at += h.span) > col)?.label ?? 'Total';
    });
  const head = Array.from({ length: n }, (_, c) => [...keysOf(Math.floor(c / nv)), ...(nv > 1 || !m.headers.length ? [valueLabelOf(el, vals[c % nv])] : [])].join(' · '));
  const line = (label: string, cells: (number | string | null)[]) => [label, ...Array.from({ length: n }, (_, c) => String(cells[c] ?? ''))];
  const out = [[rowTitleOf(el), ...head]];
  const walk = (rows: MatrixRow[]) => rows.forEach((r) => (out.push(line('  '.repeat(r.depth) + r.label, r.cells)), walk(r.children)));
  walk(m.rows);
  out.push(line('Total', m.total));
  return out;
}

/**
 * A matrix: row headers in a stepped hierarchy (each group expands into the next level), column
 * headers, the values at every crossing, subtotals on each group's row, and grand totals. Only the rows in
 * view are drawn; a header click sorts the rows by it (each group among its siblings).
 */
export const MatrixWidget: Component<{ element: MatrixElement }> = (props) => {
  const el = () => props.element;
  const matrix = createMemo(() => matrixOf(el()));
  // plain copies: every cell reads its value's settings, and a store object's reads go through its proxy
  const values = createMemo(() => (el().values ?? []).map((v) => ({ ...v })));
  const nv = () => values().length;
  /** Each row's cells by index: each column (and the Total column) has one per value. */
  const cellIndexes = createMemo(() => Array.from({ length: (matrix().cols + (matrix().totalCol ? 1 : 0)) * nv() }, (_, c) => c));

  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const toggle = (path: string) => setCollapsed((s) => flipped(s, path));
  // a header click sorts by that cell (−1: the row labels)
  const sorter = createSort<number>(), { sort } = sorter;

  /** The rows on screen in order: each expanded group followed by its children, siblings sorted. */
  const visible = createMemo(() => {
    const s = sort();
    // as a table sorts: numbers by value, text naturally, blanks last
    const order = (rows: MatrixRow[]) => (s ? Array.from(sortOrder(rows.length, k => (s.key < 0 ? rows[k].key : rows[k].cells[s.key]), s.desc), k => rows[k]) : rows);
    const out: MatrixRow[] = [];
    const walk = (rows: MatrixRow[]) => {
      for (const r of order(rows)) {
        out.push(r);
        if (r.children.length && !collapsed().has(r.path)) walk(r.children);
      }
    };
    walk(matrix().rows);
    return out;
  });
  const virtual = createVirtualRows(() => visible().length, () => rowHeight(el().grid));

  const valueLabel = (v: MatrixValue) => valueLabelOf(el(), v);
  // a % change is a percent; otherwise the value's format and display units
  /** How each value's cells read, worked out once for the value rather than per cell. */
  const looks = createMemo(() =>
    values().map((v) => {
      const format = v.compare && !v.compare.show ? 'percent' : withUnits(v.format || measureOf(el(), v.field)?.format, v.units);
      return (x: number | string | null | undefined) => cellText(x, pct(v.showAs), format, (x) => (typeof x === 'number' ? plainNumber(x) : String(x)));
    })
  );
  const cell = (x: number | string | null | undefined, v: MatrixValue) => looks()[values().indexOf(v)](x);
  /** A row's cells, blank on a group's row when subtotals are off. */
  const cellsOf = (r: MatrixRow) => (r.children.length && el().subtotals === false ? [] : r.cells);
  const rowTitle = () => rowTitleOf(el());

  /** Each value's range over the innermost rows (not subtotals or totals), for conditional formatting. */
  const ranges = createMemo(() => {
    const leaves: MatrixRow[] = [];
    const walk = (rows: MatrixRow[]) => rows.forEach(r => (r.children.length ? walk(r.children) : leaves.push(r)));
    walk(matrix().rows);
    return values().map((v, i) => (v.cond ? rangeOf(leaves.length * matrix().cols, k => leaves[Math.floor(k / matrix().cols)].cells[(k % matrix().cols) * nv() + i]) : undefined));
  });

  const columnFields = () => (nv() ? el().columns ?? [] : []);
  const valueHeaders = () => columnFields().length === 0 || nv() > 1;

  /**
   * What the columns are sized from: the headers, the totals and a sample of rows. The row headers are indented by
   * their depth after a collapse button; with one value, each column's header is its own column key.
   */
  const cols = createMemo(() => {
    const rows = visible().slice(0, SAMPLE);
    const keys = columnFields().length && nv() === 1 ? matrix().headers.at(-1) : undefined;
    return [
      { head: rowTitle(), total: 'Total', cells: rows.map((r) => r.label), inset: 18 + 16 * Math.max(0, ...rows.map((r) => r.depth)) },
      ...cellIndexes().map((c) => {
        const v = values()[c % nv()];
        return { head: keys ? keys[c]?.label ?? 'Total' : valueLabel(v), total: cell(matrix().total[c], v), cells: rows.map((r) => cell(r.cells[c], v)) };
      })
    ];
  });

  // the top-left header: the row fields' names; a click sorts by them
  const corner = (rowSpan?: number) => (
    <SortTh sort={sorter} k={-1} class="d-matrix-corner" rowSpan={rowSpan}>
      {rowTitle()}
    </SortTh>
  );

  return (
    <TableShell
      title={el().title}
      grid={el().grid}
      show={(el().rows?.length || 0) + (el().columns?.length || 0) + nv()}
      class="d-table d-matrix"
      cols={cols()}
      virtual={virtual}
      head={
        <thead>
          {/* one header row per column field, then (with several values) one naming the values */}
          <Index each={columnFields()}>
            {(_, level) => (
              <tr>
                <Show when={level === 0}>{corner(columnFields().length + (valueHeaders() ? 1 : 0))}</Show>
                <For each={matrix().headers[level]}>
                  {(h, i) => {
                    // the last level's headers are the columns themselves; with one value they sort
                    const leaf = level === columnFields().length - 1 && nv() === 1;
                    return (
                      <SortTh sort={sorter} k={i()} on={leaf} class="d-matrix-group" colSpan={h.span * nv()}>
                        {h.label}
                      </SortTh>
                    );
                  }}
                </For>
                <Show when={level === 0 && matrix().totalCol}>
                  <SortTh sort={sorter} k={matrix().cols} on={nv() === 1} class="d-matrix-group" colSpan={nv()} rowSpan={columnFields().length}>
                    Total
                  </SortTh>
                </Show>
              </tr>
            )}
          </Index>
          <Show when={valueHeaders()}>
            <tr>
              <Show when={!columnFields().length}>{corner()}</Show>
              <For each={cellIndexes()}>
                {(c) => (
                  <SortTh sort={sorter} k={c} class="td-right">
                    {valueLabel(values()[c % nv()])}
                  </SortTh>
                )}
              </For>
            </tr>
          </Show>
        </thead>
      }
      foot={
        <Show when={nv() && ((el().totals !== false && el().totals !== 'column') || !el().rows?.length)}>
          <tfoot>
            <tr>
              <th class="d-matrix-row">Total</th>
              <For each={cellIndexes()}>{(c) => <td class="td-right">{cell(matrix().total[c], values()[c % nv()])}</td>}</For>
            </tr>
          </tfoot>
        </Show>
      }
    >
      <For each={visible().slice(virtual.range().start, virtual.range().end)}>
        {(r, i) => (
          <tr class={`${r.children.length ? 'd-matrix-group-row' : ''} ${(virtual.range().start + i()) % 2 ? 'odd' : ''}`} data-p={virtual.range().start + i()}>
            <th class="d-matrix-row" style={{ 'padding-left': `${10 + r.depth * 16}px` }}>
              <Show when={r.children.length} fallback={<span class="d-matrix-toggle" />}>
                <button class="d-matrix-toggle" title={collapsed().has(r.path) ? 'Expand' : 'Collapse'} onClick={() => toggle(r.path)}>
                  {collapsed().has(r.path) ? '+' : '−'}
                </button>
              </Show>
              {r.label}
            </th>
            {/* the row's cells, made in one pass (grid.ts's td); a group's subtotals and the Total column aren't shaded */}
            {cellIndexes().map((c) => {
              const i = c % nv(), x = cellsOf(r)[c];
              const plain = r.children.length || (matrix().totalCol && c >= matrix().cols * nv());
              return td(looks()[i](x), 'td-right', plain ? undefined : condStyle(values()[i].cond, x, ranges()[i]));
            })}
          </tr>
        )}
      </For>
    </TableShell>
  );
};
