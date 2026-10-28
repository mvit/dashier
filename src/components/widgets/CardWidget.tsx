import { Component, Show } from 'solid-js';
import { CardElement } from '../../types/model';
import { store } from '../../runtime/store';
import { formatValue, summaryLabel, withUnits } from '../../runtime/charts';

/** A KPI: one big number with its label underneath, and optionally how it compares ("+6.4% vs FY2024"). */
export const CardWidget: Component<{ element: CardElement }> = (props) => {
  const el = () => props.element;
  const field = () => el().aggregation?.field;
  const measure = () => store.measureInfo(el().sourceId, field(), el());
  const fmt = () => withUnits(el().format ?? measure()?.format, el().units);
  const value = () => {
    const s = el().staticValue;
    if (s != null && s !== '') return String(s);
    const v = store.valueOf(el(), el().sourceId, field(), el().aggregation?.method);
    return v == null ? '—' : formatValue(v, fmt());
  };
  // how the value compares (another period, a target), colored by direction
  const compared = () => {
    const c = el().compare;
    const r = c && el().staticValue == null && store.comparedOf(el(), el().sourceId, field(), el().aggregation?.method, c, fmt());
    return r && { text: `${r.text} ${store.compareLabel(el(), c!)}`.trim(), dir: c!.show === 'value' || !r.d ? '' : (r.d > 0) !== !!c!.invert ? 'up' : 'down' };
  };
  const label = () =>
    el().title || measure()?.name || (field() ? summaryLabel(store.describeRef(el().sourceId, field()!).field, el().aggregation!.method) : '');

  return (
    <div
      class={`d-card-widget ${el().callout?.align === 'left' ? 'left' : ''}`}
      style={{ '--callout-size': el().callout?.size ? `${el().callout!.size}px` : undefined, '--callout-color': el().callout?.color }}
    >
      <Show when={field() || el().staticValue != null} fallback={<div class="d-chart-empty">{store.editing() ? 'Drag a field here' : ''}</div>}>
        <div class="card-value">{value()}</div>
        <div class="card-title">{label()}</div>
        <Show when={compared()}>
          {(c) => <div class={`card-compare ${c().dir}`}>{c().text}</div>}
        </Show>
        <Show when={el().subtitle}>
          <div class="card-subtitle">{el().subtitle}</div>
        </Show>
      </Show>
    </div>
  );
};
