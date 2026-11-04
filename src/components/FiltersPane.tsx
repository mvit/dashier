import { Component, Index, Match, Show, Switch, createSignal } from 'solid-js';
import { DroppedField, dropProps } from '../runtime/dnd';
import { store, FilterScope } from '../runtime/store';
import { DashFilter, isNumericType } from '../types/model';
import { DatePart, DateUnit, datePartKey, datePartLabel } from '../runtime/dates';

import { pickSummary, toggled } from '../runtime/data';
import { Check, RangeInputs, Seg, Select, CheckList, PickCard } from './ui';

// a date filter keeps a range, the last n days/weeks/months/years, or picked years, quarters or months
const DATE_MODES: [string, string, string][] = [['range', 'Range', 'From one date to another'], ['last', 'Last', 'The last n days, weeks, months or years'], ['year', 'Year', 'Pick years'], ['quarter', 'Qtr', 'Pick quarters'], ['month', 'Month', 'Pick months']];

/**
 * One filter, collapsible: its header says what it keeps ("is Software", "2025 Q4", "Last 3 months"); the body
 * picks values from a checklist (text, and dates grouped by year, quarter or month), a from–to range (numbers, dates)
 * or the last n days/weeks/months/years. Nothing set = all.
 */
const FilterCard: Component<{ scope: FilterScope; index: number; filter: DashFilter }> = (props) => {
  const f = () => props.filter;
  const list = () => store.filtersAt(props.scope);
  const update = (patch: Partial<DashFilter>, key?: string) =>
    store.setFilters(props.scope, list().map((x, i) => (i === props.index ? { ...x, ...patch } : x)), key);
  const [open, setOpen] = createSignal(true);
  const numeric = () => isNumericType(store.filterType(f()));
  const date = () => store.filterType(f()) === 'datetime';
  // a date filter grouped by year, quarter or month picks from those buckets
  const values = () => (f().datePart ? [...new Set(store.distinctValues({ ...f(), datePart: undefined }).map(v => datePartKey(v, f().datePart!)))].sort() : store.distinctValues(f()));
  const selected = () => f().values || [];
  const label = (v: string) => datePartLabel(v, f().datePart);
  /** What the filter keeps, in words; empty when it keeps everything. */
  const summary = () => pickSummary(f(), label, () => values().length);
  // numbers: the data's own range as the placeholders
  const bound = (m: 'min' | 'max') => {
    const ns = values().map(Number).filter(Number.isFinite);
    return ns.length ? String(Math[m](...ns)) : '';
  };
  const range = (type: 'date' | 'number', keys: ('from' | 'to' | 'min' | 'max')[]) => (
    <RangeInputs
      type={type}
      value={(i) => f()[keys[i]]}
      placeholder={(i) => (type === 'number' ? bound(i ? 'max' : 'min') : '')}
      set={(i, v) => update({ [keys[i]]: v === '' ? undefined : type === 'number' ? Number(v) : v }, `filter:${keys[i]}`)}
    />
  );

  /** The field's values (a grouped date's years, quarters or months), the first 200; text is always searchable. */
  const checklist = () => (
    <CheckList class="d-filter-values" values={values()} label={label} on={(v) => selected().includes(v)} flip={(v) => update({ values: toggled(selected(), v) })} search={f().datePart ? 8 : -1} limit={200}>
      <Check checked={!selected().length} set={() => update({ values: [] })}>
        Select All
      </Check>
    </CheckList>
  );

  const mode = () => (f().last ? 'last' : f().datePart ?? 'range');
  const setMode = (m: string) => {
    const clear = { from: undefined, to: undefined, last: undefined, values: undefined, datePart: undefined };
    update(m === 'last' ? { ...clear, last: { n: 3, unit: 'month' } } : m === 'range' ? clear : { ...clear, datePart: m as DatePart, values: [] });
  };

  return (
    <PickCard
      open={open()}
      flip={() => setOpen(!open())}
      name={f().field}
      sub={f().table}
      summary={summary()}
      clear={['Clear filter', () => update({ values: [], from: undefined, to: undefined, last: undefined, min: undefined, max: undefined })]}
      actions={<button class="d-filter-x" title="Remove filter" onClick={() => store.setFilters(props.scope, list().filter((_, i) => i !== props.index))}>×</button>}
    >
      <Switch fallback={checklist()}>
        <Match when={date()}>
          <Seg class="d-filter-mode" value={mode()} options={DATE_MODES} set={setMode} />
          <Switch fallback={range('date', ['from', 'to'])}>
            <Match when={f().datePart}>{checklist()}</Match>
            <Match when={f().last}>
              {(last) => (
                <div class="d-filter-range">
                  <input
                    type="number"
                    class="d-input"
                    min="1"
                    value={last().n}
                    onInput={(e) => Number(e.currentTarget.value) >= 1 && update({ last: { ...last(), n: Math.round(Number(e.currentTarget.value)) } }, 'filter:last')}
                  />
                  <Select value={last().unit} options={['day', 'week', 'month', 'year'].map(u => [u, u + 's'])} set={(unit: DateUnit) => update({ last: { ...last(), unit } })} />
                </div>
              )}
            </Match>
          </Switch>
        </Match>
        <Match when={numeric()}>{range('number', ['min', 'max'])}</Match>
      </Switch>
    </PickCard>
  );
};

/** A scope's filters, plus a drop box for adding one: drag a field from the Data pane onto it. */
const FilterSection: Component<{ scope: FilterScope; title: string }> = (props) => {
  const [over, setOver] = createSignal(false);
  const filters = () => store.filtersAt(props.scope);
  const add = (f: DroppedField) => f.field && !filters().some(x => x.field === f.field && x.table === f.table) && store.setFilters(props.scope, [...filters(), { field: f.field, table: f.table }]);
  return (
    <div class="d-filter-section">
      <div class="d-filter-section-title">
        {props.title}
        <Show when={filters().length}>
          <b>{filters().length}</b>
        </Show>
      </div>
      <Index each={filters()}>{(f, i) => <FilterCard scope={props.scope} index={i} filter={f()} />}</Index>
      <div class={`d-well-box d-droppable ${over() ? 'over' : ''}`} {...dropProps(add, setOver)}>
        <div class="d-well-empty">Add data fields here</div>
      </div>
    </div>
  );
};

export const FiltersPane: Component = () => (
  <>
    <Show when={store.getSelectedElement()}>
      <FilterSection scope="visual" title="On this visual" />
    </Show>
    <FilterSection scope="page" title="On this page" />
    <FilterSection scope="doc" title="On all pages" />
  </>
);
