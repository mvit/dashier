import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { isBlank } from '../runtime/data';
import { ColumnSchema, FieldType, isNumericType } from '../types/model';
import { Select } from './ui';

/** Column types as Power Query shows them: a short glyph and a name. */
const TYPES: Record<FieldType, [string, string]> = {
  string: ['ABC', 'Text'],
  float: ['1.2', 'Decimal number'],
  int: ['123', 'Whole number'],
  uint: ['+123', 'Positive whole number'],
  datetime: ['DATE', 'Date / time'],
  boolean: ['T/F', 'True / false']
};


/** A type badge that opens the type list (a native select laid over the badge). */
const TypeChip: Component<{ type: FieldType; onChange?: (t: FieldType) => void }> = (props) => (
  <label class={`d-type-chip type-${props.type} ${props.onChange ? 'editable' : ''}`} title={`${TYPES[props.type]?.[1] ?? props.type}${props.onChange ? ' — click to change' : ''}`}>
    <span>{TYPES[props.type]?.[0] ?? '?'}</span>
    <Show when={props.onChange}>
      <Select class="" value={props.type} options={Object.entries(TYPES).map(([t, [, name]]) => [t, name])} set={props.onChange!} />
    </Show>
  </label>
);

/**
 * A data preview grid: each column header carries its type (changeable with `onType`) and its name (renamable with
 * `onRename`); hovering it shows the column's counts (`stats`). Only the first `limit` rows are drawn.
 */
export const DataGrid: Component<{
  columns: ColumnSchema[];
  rows: Record<string, any>[];
  /** Rows in the whole table, when `rows` is only its first part. */
  total?: number;
  limit?: number;
  onType?: (column: string, type: FieldType) => void;
  onRename?: (column: string, input: HTMLInputElement) => void;
  /** Orders a column's values by another column (axes, legends, matrices, slicers). */
  onSortBy?: (column: string, by: string) => void;
  /** A column's counts (blanks, distinct values, range): worked out when its header is first hovered. */
  stats?: (column: string) => string;
}> = (props) => {
  const shown = createMemo(() => props.rows.slice(0, props.limit ?? 100));
  const total = () => props.total ?? props.rows.length;
  // the hovered column's counts, worked out once per column and type (they can take a moment over millions of rows):
  // a type changed under the pointer gets its own
  const [hovered, setHovered] = createSignal('');
  const counted = createMemo(() => (props.rows, new Map<string, string>()));
  const tip = (c: ColumnSchema) => {
    if (!props.stats || hovered() !== c.name) return undefined;
    const key = `${c.name}\u0000${c.type}`;
    if (!counted().has(key)) counted().set(key, props.stats(c.name));
    return counted().get(key);
  };
  const num = (c: ColumnSchema) => (isNumericType(c.type) ? 'num' : '');

  return (
    <div class="d-grid-wrap">
      <table class="d-grid">
        <thead>
          <tr>
            <th class="d-grid-rownum" />
            <For each={props.columns}>
              {(c) => (
                <th data-col={c.name} class={num(c)} title={tip(c)} onPointerEnter={() => setHovered(c.name)}>
                  <div class="d-grid-head">
                    <TypeChip type={c.type} onChange={props.onType && ((t) => props.onType!(c.name, t))} />
                    <Show when={props.onRename} fallback={<span class="d-grid-name">{c.name}</span>}>
                      <input
                        class="d-name-input"
                        value={c.name}
                        title="Rename (everywhere it is used)"
                        spellcheck={false}
                        onChange={(e) => props.onRename!(c.name, e.currentTarget)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      />
                    </Show>
                  </div>
                  <Show when={props.onSortBy}>
                    <div class="d-col-profile">
                      <select class="d-sortby" title="Order this column's values by another column (axes, legends, matrices, slicers)" onChange={(e) => props.onSortBy!(c.name, e.currentTarget.value)}>
                        <option value="">sorted by itself</option>
                        <For each={props.columns.filter(o => o.name !== c.name)}>{(o) => <option value={o.name} selected={c.sortBy === o.name}>sorted by {o.name}</option>}</For>
                      </select>
                    </div>
                  </Show>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={shown()}>
            {(row, i) => (
              <tr>
                <td class="d-grid-rownum">{i() + 1}</td>
                <For each={props.columns}>
                  {(c) => (
                    <td class={num(c)}>
                      <Show when={!isBlank(row[c.name])} fallback={<span class="d-null">null</span>}>
                        {String(row[c.name])}
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={total() > shown().length}>
        <div class="d-grid-more">
          Showing the first {shown().length} of {total().toLocaleString()} rows
        </div>
      </Show>
    </div>
  );
};
