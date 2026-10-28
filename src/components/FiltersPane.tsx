import { Component, For, Index, Match, Show, Switch, createSignal } from 'solid-js';
import { DroppedField, dropProps } from '../runtime/dnd';
import { store, FilterScope } from '../runtime/store';
import { DashFilter, isNumericType } from '../types/model';
import { DatePart, DateUnit, datePartKey, datePartLabel } from '../runtime/dates';
import { ClearFilterIcon } from './icons';

// a date filter keeps a range, the last n days/weeks/months/years, or picked years, quarters or months
const DATE_MODES = [['range', 'Range', 'From one date to another'], ['last', 'Last', 'The last n days, weeks, months or years'], ['year', 'Year', 'Pick years'], ['quarter', 'Qtr', 'Pick quarters'], ['month', 'Month', 'Pick months']];

/**
 * One filter, collapsible: its header says what it keeps ("is Software", "2025 Q4", "Last 3 months", "All"); the body
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
  // long lists are searched; the checklist shows the first 200 matches
  const [search, setSearch] = createSignal('');
  const shown = () => {
    const q = search().toLowerCase();
    return (q ? values().filter(v => label(v).toLowerCase().includes(q)) : values()).slice(0, 200);
  };
  /** What the filter keeps, in words; empty when it keeps everything. */
  const summary = () => {
    const { last, from, to, min, max } = f();
    const s = selected();
    if (last) return `Last ${last.n} ${last.unit}${last.n > 1 ? 's' : ''}`;
    if (from || to) return from && to ? `${from} – ${to}` : from ? `from ${from}` : `to ${to}`;
    if (min != null || max != null) return min != null && max != null ? `${min} – ${max}` : min != null ? `≥ ${min}` : `≤ ${max}`;
    return s.length ? (s.length < 3 ? `is ${s.map(label).join(', ')}` : `${s.length} of ${values().length}`) : '';
  };
  const toggle = (v: string) => update({ values: selected().includes(v) ? selected().filter(x => x !== v) : [...selected(), v] });
  // numbers: the data's own range as the placeholders
  const bound = (m: 'min' | 'max') => {
    const ns = values().map(Number).filter(Number.isFinite);
    return ns.length ? String(Math[m](...ns)) : '';
  };
  const range = (type: string, keys: ('from' | 'to' | 'min' | 'max')[]) => (
    <div class="d-filter-range">
      <For each={keys}>
        {(key, i) => (
          <label>
            {i() ? 'To' : 'From'}
            <input
              type={type}
              class="d-input"
              placeholder={type === 'number' ? bound(i() ? 'max' : 'min') : ''}
              value={f()[key] ?? ''}
              onInput={(e) => {
                const v = e.currentTarget.value;
                update({ [key]: v === '' ? undefined : type === 'number' ? Number(v) : v }, `filter:${key}`);
              }}
            />
          </label>
        )}
      </For>
    </div>
  );

  /** A checklist of the field's values (a grouped date's years, quarters or months); text is always searchable. */
  const checklist = () => (
    <>
      <Show when={!f().datePart || values().length > 8}>
        <input type="search" class="d-input d-slicer-search" placeholder="Search" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
      </Show>
      <div class="d-filter-values">
        <label class="d-checkbox-label">
          <input type="checkbox" checked={!selected().length} onChange={() => update({ values: [] })} />
          <i>All</i>
        </label>
        <For each={shown()}>
          {(v) => (
            <label class="d-checkbox-label">
              <input type="checkbox" checked={selected().includes(v)} onChange={() => toggle(v)} />
              <span>{label(v)}</span>
            </label>
          )}
        </For>
      </div>
    </>
  );

  const mode = () => (f().last ? 'last' : f().datePart ?? 'range');
  const setMode = (m: string) => {
    const clear = { from: undefined, to: undefined, last: undefined, values: undefined, datePart: undefined };
    update(m === 'last' ? { ...clear, last: { n: 3, unit: 'month' } } : m === 'range' ? clear : { ...clear, datePart: m as DatePart, values: [] });
  };
  const stop = (e: Event, then: () => void) => (e.stopPropagation(), then());

  return (
    <div class={`d-filter-card ${summary() ? 'active' : ''}`}>
      <div class="d-filter-card-header" onClick={() => setOpen(!open())}>
        <span class="d-filter-caret">{open() ? '▾' : '▸'}</span>
        <span class="filter-name">
          {f().field}
          <small>{f().table}</small>
        </span>
        <span class="filter-type">{summary() || 'All'}</span>
        <Show when={summary()}>
          <button class="d-filter-x" title="Clear the filter" onClick={(e) => stop(e, () => update({ values: [], from: undefined, to: undefined, last: undefined, min: undefined, max: undefined }))}>
            <ClearFilterIcon />
          </button>
        </Show>
        <button class="d-filter-x" title="Remove filter" onClick={(e) => stop(e, () => store.setFilters(props.scope, list().filter((_, i) => i !== props.index)))}>×</button>
      </div>
      <Show when={open()}>
        <Switch fallback={checklist()}>
          <Match when={date()}>
            <div class="d-seg d-filter-mode">
              <For each={DATE_MODES}>{([m, name, tip]) => <button data-mode={m} title={tip} class={mode() === m ? 'on' : ''} onClick={() => setMode(m)}>{name}</button>}</For>
            </div>
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
                    <select class="d-well-select" value={last().unit} onChange={(e) => update({ last: { ...last(), unit: e.currentTarget.value as DateUnit } })}>
                      <For each={['day', 'week', 'month', 'year']}>{(u) => <option value={u}>{u}s</option>}</For>
                    </select>
                  </div>
                )}
              </Match>
            </Switch>
          </Match>
          <Match when={numeric()}>{range('number', ['min', 'max'])}</Match>
        </Switch>
      </Show>
    </div>
  );
};

/** A scope's filters, plus a drop box for adding one: drag a field from the Data pane onto it. */
const FilterSection: Component<{ scope: FilterScope; title: string }> = (props) => {
  const [over, setOver] = createSignal(false);
  const filters = () => store.filtersAt(props.scope);
  const add = (f: DroppedField) => f.field && !filters().some(x => x.field === f.field && (x.table ?? f.table) === f.table) && store.setFilters(props.scope, [...filters(), { field: f.field, table: f.table }]);
  return (
    <div class="d-filter-section">
      <div class="d-filter-section-title">
        {props.title}
        <Show when={filters().length}>
          <b>{filters().length}</b>
        </Show>
      </div>
      <Index each={filters()}>{(f, i) => <FilterCard scope={props.scope} index={i} filter={f()} />}</Index>
      <div class={`d-well-box d-droppable d-filter-drop ${over() ? 'over' : ''}`} {...dropProps(add, setOver)}>
        <div class="d-well-empty">+ Drag a field here</div>
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
