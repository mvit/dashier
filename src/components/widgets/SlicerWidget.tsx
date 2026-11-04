import { Component, For, Show, createMemo } from 'solid-js';
import { SlicerElement, isNumericType } from '../../types/model';
import { store } from '../../runtime/store';
import { datePartLabel } from '../../runtime/dates';
import { ClearButton } from '../icons';
import { RangeInputs, CheckList } from '../ui';
import { empty } from './CardWidget';
import { toggled } from '../../runtime/data';

/** A slicer: picking values here filters every other visual on the page. */
export const SlicerWidget: Component<{ element: SlicerElement }> = (props) => {
  const el = () => props.element;
  const options = createMemo(() => store.slicerOptions(el()));
  const type = () => store.refType(el().sourceId, el().field);
  const numeric = () => isNumericType(type());
  // a date slicer picks a from–to range of dates without date grouping or when it's set to Between; grouped dates
  // list their years, quarters or months
  const dateRange = () => type() === 'datetime' && (!el().datePart || el().style === 'range');
  const show = (v: string) => datePartLabel(v, el().datePart);
  const style = () => (dateRange() ? 'dates' : el().style || (numeric() ? 'range' : 'list'));
  const sel = () => el().selection;
  const select = (s: SlicerElement['selection']) => store.setSlicerSelection(store.activePageId(), el().id, s);
  const picked = () => sel()?.values || [];
  const setValues = (values: string[]) => select({ values });
  const toggle = (v: string) => {
    const cur = picked();
    if (el().single) setValues(cur.length === 1 && cur[0] === v ? [] : [v]);
    else setValues(toggled(cur, v));
  };
  const setBound = (key: 'min' | 'max', raw: string) => {
    const next = { ...sel(), [key]: raw === '' ? undefined : Number(raw) };
    // the full range is the same as no filter
    if (next.min != null && next.min <= (options().min ?? -Infinity)) next.min = undefined;
    if (next.max != null && next.max >= (options().max ?? Infinity)) next.max = undefined;
    select(next);
  };

  const slider = (key: 'min' | 'max') => (
    <input type="range" min={options().min} max={options().max} step="any" value={sel()?.[key] ?? options()[key]} onChange={(e) => setBound(key, e.currentTarget.value)} />
  );

  return (
    <div class="d-slicer">
      <div class="d-slicer-header">
        <span class="d-slicer-title">{el().title || el().field || 'Slicer'}</span>
        <Show when={sel()}>
          <ClearButton class="d-slicer-clear" title="Clear selection" onClick={() => select(undefined)} />
        </Show>
      </div>

      <Show when={el().field} fallback={empty('Drag a field here')}>
        <Show when={style() === 'dates'}>
          <RangeInputs type="date" change value={(i) => sel()?.[i ? 'to' : 'from']} set={(i, v) => select({ ...sel(), [i ? 'to' : 'from']: v || undefined })} />
        </Show>

        <Show when={style() === 'range'}>
          <RangeInputs type="number" change value={(i) => sel()?.[i ? 'max' : 'min']} placeholder={(i) => String(options()[i ? 'max' : 'min'] ?? '')} set={(i, v) => setBound(i ? 'max' : 'min', v)} />
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
            value={picked().length <= 1 ? picked()[0] ?? '' : ''}
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
          <CheckList class="d-slicer-list" values={options().values} label={show} on={(v) => picked().includes(v)} flip={toggle} radio={el().single} search={8} />
        </Show>
      </Show>
    </div>
  );
};
