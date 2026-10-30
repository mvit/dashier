import { Component, For, Index, Show, createMemo, createSignal } from 'solid-js';
import { MatrixElement, MatrixValue } from '../../types/model';
import { store } from '../../runtime/store';
import { MatrixRow, buildMatrix } from '../../runtime/matrix';
import { pct, withUnits } from '../../runtime/charts';
import { sortOrder } from '../../runtime/data';
import { SAMPLE, cellText, colWidth, condStyle, createSort, createVirtualRows, rangeOf, rowHeight, summaryHeader } from './tableKit';
import { SortTh, TableShell } from './TableWidget';

/**
 * A matrix: row headers in a stepped hierarchy (each group expands into the next level), column
 * headers, the values at every crossing, subtotals on each group's row, and grand totals. Only the rows in
 * view are drawn; a header click sorts the rows by it (each group among its siblings).
 */
export const MatrixWidget: Component<{ element: MatrixElement }> = (props) => {
  const el = () => props.element;
  const measureOf = (ref: string) => store.measureInfo(el().sourceId, ref, el());
  const matrix = createMemo(() =>
    buildMatrix(el(), store.getFrame(el()), ref => measureOf(ref)?.fn, f => store.sortOrder(el().sourceId, f), c => {
      const o = store.comparedView(el(), c);
      return { ...o, measure: ref => o.measure(ref)?.fn };
    })
  );
  const values = () => el().values ?? [];
  const nv = () => values().length;
  /** Each row's cells by index: each column (and the Total column) has one per value. */
  const cellIndexes = createMemo(() => Array.from({ length: (matrix().cols + (matrix().totalCol ? 1 : 0)) * nv() }, (_, c) => c));

  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const toggle = (path: string) => {
    const next = new Set(collapsed());
    next.has(path) ? next.delete(path) : next.add(path);
    setCollapsed(next);
  };
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

  const valueLabel = (v: MatrixValue) =>
    v.label && v.label !== v.field ? v.label : summaryHeader(v.field, v.aggregate ?? 'sum', v.showAs, measureOf(v.field), v.compare);
  // a % change is a percent; otherwise the value's format and display units
  const cell = (x: number | string | null | undefined, v: MatrixValue) =>
    cellText(x, pct(v.showAs), v.compare && !v.compare.show ? 'percent' : withUnits(v.format || measureOf(v.field)?.format, v.units), x =>
      typeof x === 'number' ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(x)
    );
  /** A row's cells, blank on a group's row when subtotals are off. */
  const cellsOf = (r: MatrixRow) => (r.children.length && el().subtotals === false ? [] : r.cells);
  // the row fields' names, read as words: "region / cost_type" → "Region / cost type"
  const rowTitle = () => (el().rows ?? []).map(f => f.field.split('.').pop()!.replace(/_/g, ' ')).join(' / ').replace(/^./, c => c.toUpperCase());

  /** Each value's range over the innermost rows (not subtotals or totals), for conditional formatting. */
  const ranges = createMemo(() => {
    const leaves: MatrixRow[] = [];
    const walk = (rows: MatrixRow[]) => rows.forEach(r => (r.children.length ? walk(r.children) : leaves.push(r)));
    walk(matrix().rows);
    return values().map((v, i) => (v.cond ? rangeOf(leaves.length * matrix().cols, k => leaves[Math.floor(k / matrix().cols)].cells[(k % matrix().cols) * nv() + i]) : undefined));
  });

  /** Column widths: from the headers, the totals and a sample of rows. */
  const widths = createMemo(() => {
    const rows = visible().slice(0, SAMPLE);
    const label = Math.max(rowTitle().length, 5, ...rows.map(r => r.label.length + 2 * r.depth + 3));
    return [
      Math.min(label, 48) + 2,
      ...cellIndexes().map(c => {
        const v = values()[c % nv()];
        return colWidth(valueLabel(v), [cell(matrix().total[c], v), ...rows.map(r => cell(r.cells[c], v))], 40);
      })
    ];
  });

  const columnFields = () => (nv() ? el().columns ?? [] : []);
  const valueHeaders = () => columnFields().length === 0 || nv() > 1;
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
      widths={widths()}
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
          <tr class={`${r.children.length ? 'd-matrix-group-row' : ''} ${(virtual.range().start + i()) % 2 ? 'odd' : ''}`}>
            <th class="d-matrix-row" style={{ 'padding-left': `${10 + r.depth * 16}px` }}>
              <Show when={r.children.length} fallback={<span class="d-matrix-toggle" />}>
                <button class="d-matrix-toggle" title={collapsed().has(r.path) ? 'Expand' : 'Collapse'} onClick={() => toggle(r.path)}>
                  {collapsed().has(r.path) ? '+' : '−'}
                </button>
              </Show>
              {r.label}
            </th>
            <For each={cellIndexes()}>
              {(c) => {
                const v = () => values()[c % nv()];
                const x = () => cellsOf(r)[c];
                const inTotal = () => matrix().totalCol && c >= matrix().cols * nv();
                return (
                  <td class="td-right" style={!r.children.length && !inTotal() ? condStyle(v().cond, x(), ranges()[c % nv()]) : undefined}>
                    {cell(x(), v())}
                  </td>
                );
              }}
            </For>
          </tr>
        )}
      </For>
    </TableShell>
  );
};
