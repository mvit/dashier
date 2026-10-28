import { Component, For, Show, createMemo } from 'solid-js';
import { ColumnSchema, FieldType, isNumericType } from '../types/model';

/** Column types as Power Query shows them: a short glyph and a name. */
const TYPES: Record<FieldType, [string, string]> = {
  string: ['ABC', 'Text'],
  float: ['1.2', 'Decimal number'],
  int: ['123', 'Whole number'],
  uint: ['+123', 'Positive whole number'],
  datetime: ['DATE', 'Date / time'],
  boolean: ['T/F', 'True / false']
};

const blank = (v: unknown) => v == null || v === '';
/** Rows read for the distinct/blank counts. */
export const PROFILE = 50_000;

/** A type badge that opens the type list (a native select laid over the badge). */
const TypeChip: Component<{ type: FieldType; onChange?: (t: FieldType) => void }> = (props) => (
  <label class={`d-type-chip type-${props.type} ${props.onChange ? 'editable' : ''}`} title={`${TYPES[props.type]?.[1] ?? props.type}${props.onChange ? ' — click to change' : ''}`}>
    <span>{TYPES[props.type]?.[0] ?? '?'}</span>
    <Show when={props.onChange}>
      <select value={props.type} onChange={(e) => props.onChange!(e.currentTarget.value as FieldType)}>
        <For each={Object.entries(TYPES)}>{([t, [, name]]) => <option value={t}>{name}</option>}</For>
      </select>
    </Show>
  </label>
);

/**
 * A data preview grid: each column header carries its type (changeable with `onType`), its name (renamable
 * with `onRename`) and a profile of distinct and blank values over all `rows`. Only the first `limit` rows are drawn.
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
}> = (props) => {
  const shown = createMemo(() => props.rows.slice(0, props.limit ?? 100));
  const total = () => props.total ?? props.rows.length;
  // profiles read at most PROFILE rows: distinct sets over millions of values take seconds and a lot of memory
  const profiled = () => Math.min(props.rows.length, PROFILE);
  const profile = createMemo(() =>
    Object.fromEntries(
      props.columns.map(c => {
        const values = props.rows.slice(0, PROFILE).map(r => r[c.name]);
        return [c.name, { distinct: new Set(values.filter(v => !blank(v)).map(String)).size, blanks: values.filter(blank).length }];
      })
    )
  );
  const num = (c: ColumnSchema) => (isNumericType(c.type) ? 'num' : '');

  return (
    <div class="d-grid-wrap">
      <table class="d-grid">
        <thead>
          <tr>
            <th class="d-grid-rownum" />
            <For each={props.columns}>
              {(c) => (
                <th data-col={c.name} class={num(c)}>
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
                  <div class="d-col-profile">
                    {profile()[c.name]?.distinct ?? 0} distinct
                    <Show when={profile()[c.name]?.blanks}>
                      {' · '}
                      <span class="d-col-blank">{profile()[c.name].blanks} blank</span>
                    </Show>
                    <Show when={props.onSortBy}>
                      <select class="d-sortby" title="Order this column's values by another column (axes, legends, matrices, slicers)" onChange={(e) => props.onSortBy!(c.name, e.currentTarget.value)}>
                        <option value="">sorted by itself</option>
                        <For each={props.columns.filter(o => o.name !== c.name)}>{(o) => <option value={o.name} selected={c.sortBy === o.name}>sorted by {o.name}</option>}</For>
                      </select>
                    </Show>
                  </div>
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
                      <Show when={!blank(row[c.name])} fallback={<span class="d-null">null</span>}>
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
          {total() > profiled() ? ` · column counts from the first ${profiled().toLocaleString()}` : ''}
        </div>
      </Show>
    </div>
  );
};
