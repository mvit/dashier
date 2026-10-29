import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { SlicerElement, isNumericType } from '../../types/model';
import { store } from '../../runtime/store';
import { datePartLabel } from '../../runtime/dates';
import { ClearFilterIcon } from '../icons';

/** A slicer: picking values here filters every other visual on the page. */
export const SlicerWidget: Component<{ element: SlicerElement }> = (props) => {
  const el = () => props.element;
  const [search, setSearch] = createSignal('');
  const options = createMemo(() => store.slicerOptions(el()));
  const type = () => store.refType(el().sourceId, el().field);
  const numeric = () => isNumericType(type());
  // a date slicer without date grouping picks a from–to range; grouped dates list their years/quarters/months
  const dateRange = () => type() === 'datetime' && !el().datePart;
  const show = (v: string) => datePartLabel(v, el().datePart);
  const style = () => (dateRange() ? 'dates' : el().style || (numeric() ? 'range' : 'list'));
  const sel = () => el().selection;
  const select = (s: SlicerElement['selection']) => store.setSlicerSelection(store.activePageId(), el().id, s);
  const picked = () => sel()?.values || [];
  const setValues = (values: string[]) => select({ values });
  const toggle = (v: string) => {
    const cur = picked();
    if (el().single) setValues(cur.length === 1 && cur[0] === v ? [] : [v]);
    else setValues(cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]);
  };
  const setBound = (key: 'min' | 'max', raw: string) => {
    const next = { ...sel(), [key]: raw === '' ? undefined : Number(raw) };
    // the full range is the same as no filter
    if (next.min != null && next.min <= (options().min ?? -Infinity)) next.min = undefined;
    if (next.max != null && next.max >= (options().max ?? Infinity)) next.max = undefined;
    select(next);
  };

  const shown = () => {
    const q = search().toLowerCase();
    return q ? options().values.filter(v => show(v).toLowerCase().includes(q)) : options().values;
  };
  const active = () => picked().length > 0 || sel()?.min != null || sel()?.max != null || !!(sel()?.from || sel()?.to);

  const dateInput = (key: 'from' | 'to') => (
    <input type="date" class="d-input" value={sel()?.[key] ?? ''} onChange={(e) => select({ ...sel(), [key]: e.currentTarget.value || undefined })} />
  );
  const boundInput = (key: 'min' | 'max') => (
    <input type="number" class="d-input" placeholder={String(options()[key] ?? key)} value={sel()?.[key] ?? ''} onChange={(e) => setBound(key, e.currentTarget.value)} />
  );
  const slider = (key: 'min' | 'max') => (
    <input type="range" min={options().min} max={options().max} step="any" value={sel()?.[key] ?? options()[key]} onChange={(e) => setBound(key, e.currentTarget.value)} />
  );

  return (
    <div class="d-slicer">
      <div class="d-slicer-header">
        <span class="d-slicer-title">{el().title || el().field || 'Slicer'}</span>
        <Show when={active()}>
          <button class="d-slicer-clear" title="Clear selection" onClick={() => select(undefined)}>
            <ClearFilterIcon />
          </button>
        </Show>
      </div>

      <Show when={el().field} fallback={<div class="d-chart-empty">{store.editing() ? 'Drag a field here' : ''}</div>}>
        <Show when={style() === 'dates'}>
          <div class="d-slicer-range">
            {dateInput('from')}
            –
            {dateInput('to')}
          </div>
        </Show>

        <Show when={style() === 'range'}>
          <div class="d-slicer-range">
            {boundInput('min')}
            –
            {boundInput('max')}
          </div>
          <Show when={options().min != null && options().max! > options().min!}>
            <div class="d-slicer-sliders">
              {slider('min')}
              {slider('max')}
            </div>
          </Show>
        </Show>

        <Show when={style() === 'dropdown'}>
          <select
            class="d-well-select d-slicer-dropdown"
            value={el().single || picked().length <= 1 ? picked()[0] ?? '' : ''}
            onChange={(e) => setValues(e.currentTarget.value ? [e.currentTarget.value] : [])}
          >
            <option value="">{picked().length > 1 ? `${picked().length} selected` : 'All'}</option>
            <For each={options().values}>{(v) => <option value={v}>{show(v)}</option>}</For>
          </select>
        </Show>

        <Show when={style() === 'tiles'}>
          <div class="d-slicer-tiles">
            <For each={options().values}>
              {(v) => (
                <button class={`d-slicer-tile ${picked().includes(v) ? 'on' : ''}`} onClick={() => toggle(v)}>
                  {show(v)}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={style() === 'list'}>
          <Show when={options().values.length > 8}>
            <input type="search" class="d-input d-slicer-search" placeholder="Search" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
          </Show>
          <div class="d-slicer-list">
            <For each={shown().slice(0, 500)}>
              {(v) => (
                <label class="d-checkbox-label">
                  <input type={el().single ? 'radio' : 'checkbox'} checked={picked().includes(v)} onClick={() => toggle(v)} />
                  {show(v)}
                </label>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};
