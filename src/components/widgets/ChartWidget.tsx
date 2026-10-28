import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { ChartElement } from '../../types/model';
import { store } from '../../runtime/store';
import { aggregate, buildChart, chartKind, chartReady, formatCompact, formatValue } from '../../runtime/charts';
import { ChartHost } from './ChartHost';
import type { Frame } from '../../runtime/frames';
import type { ChartFormat } from '../../runtime/charts';

/** A round number at or past `v`, away from zero: 1.2K → 2K, −34 → −40. */
const nice = (v: number) => {
  const mag = 10 ** Math.floor(Math.log10(Math.abs(v) || 1));
  return Math.sign(v) * Math.ceil(Math.abs(v) / mag) * mag;
};

/** Half-ring gauge: sum of mapping.y between options.min and options.max (round numbers past the value when unset). */
const Gauge: Component<{ element: ChartElement; frame: Frame }> = (props) => {
  const o = () => props.element.options;
  const y = () => props.element.mapping?.y;
  const mi = () => store.measureInfo(props.element.sourceId, y(), props.element);
  const value = () => (mi() ? mi()!.fn(props.frame) : aggregate(props.frame, props.element.summary?.aggregate || 'sum', y())) ?? 0;
  const fmt = () => o()?.format ?? mi()?.format;
  // the ends left free: 0, and a round number past the value (below it when it's negative) or past the other end
  const min = () => o()?.min ?? Math.min(0, nice(Math.min(value(), o()?.max ?? 0) * 1.2));
  const max = () => {
    const top = Math.max(value(), min(), 0);
    return o()?.max ?? (top ? nice(top * 1.2) : min() < 0 ? 0 : 1);
  };
  const point = (t: number) => {
    const a = Math.PI * (1 - Math.max(0, Math.min(1, t)));
    return `${50 + 40 * Math.cos(a)} ${55 - 40 * Math.sin(a)}`;
  };
  const arc = (t: number) => `M${point(0)}A40 40 0 0 1 ${point(t)}`;
  return (
    <svg class="d-gauge" viewBox="0 0 100 64">
      <path d={arc(1)} stroke="var(--chrome-2)" stroke-width="10" fill="none" />
      <path d={arc((value() - min()) / (max() - min() || 1))} stroke="var(--gauge-color, var(--accent))" stroke-width="10" fill="none" />
      <text x="50" y="52" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">{formatValue(value(), fmt())}</text>
      <text x="10" y="63" text-anchor="middle" font-size="5" fill="var(--muted)">{formatCompact(min(), fmt() as ChartFormat)}</text>
      <text x="90" y="63" text-anchor="middle" font-size="5" fill="var(--muted)">{formatCompact(max(), fmt() as ChartFormat)}</text>
    </svg>
  );
};

/** Each chart's colorable names (series, slices, groups; a gauge's value), by element id: the format pane's Colors list. */
const [chartNames, setChartNames] = createSignal<Record<string, string[]>>({});
export { chartNames };

export const ChartWidget: Component<{ element: ChartElement }> = (props) => {
  const el = () => props.element;
  const isDate = (ref?: string) => store.refType(el().sourceId, ref) === 'datetime';
  // date grouping (Year/Quarter/Month) is read off each row by the chart: rows are never copied
  const rows = createMemo(() => store.getFrame(el()));
  const spec = createMemo(() =>
    buildChart(el(), rows(), {
      xDate: isDate(el().mapping?.x),
      groupDate: isDate(el().mapping?.group),
      measure: (ref) => store.measureInfo(el().sourceId, ref, el()),
      order: (ref) => store.sortOrder(el().sourceId, ref),
      compared: (c) => store.comparedView(el(), c)
    })
  );

  const gauge = () => chartKind(el().chartType) === 'gauge';
  const names = createMemo(() => (gauge() ? [store.measureInfo(el().sourceId, el().mapping?.y, el())?.name ?? el().mapping?.y ?? 'Value'] : spec().names ?? []));
  createEffect(() => {
    const id = el().id;
    const list = names();
    setChartNames(m => (m[id]?.join('\u0000') === list.join('\u0000') ? m : { ...m, [id]: list }));
  });
  // a color picked for a name overrides its palette color here only: the marks, legend and tooltips all read it
  const colors = () =>
    Object.fromEntries(names().flatMap((n, i) => (el().options?.colors?.[n] ? [[gauge() ? '--gauge-color' : `--series-${(i % 8) + 1}`, el().options!.colors![n]]] : [])));

  return (
    <div class="d-chart-widget" style={colors()}>
      <div class="chart-header">
        <span class="chart-title">{el().options?.title || el().title || 'Chart'}</span>
      </div>

      <Show
        when={chartReady(el())}
        fallback={<div class="d-chart-empty">{store.editing() ? 'Drag fields from the Data pane into this chart’s slots' : ''}</div>}
      >
        {/* rows whose values are all blank are no data either */}
        <Show when={rows().length > 0 && (spec().draw || chartKind(el().chartType) === 'gauge')} fallback={<div class="d-chart-empty">No data for these fields</div>}>
          <Show when={chartKind(el().chartType) !== 'gauge'} fallback={<Gauge element={el()} frame={rows()} />}>
            {/* every chart's legend is this one: same swatches, font and placement */}
            <div class={`d-chart-body legend-${el().options?.legendPosition || 'bottom'}`}>
              <ChartHost draw={spec().draw} tip={spec().tip} />
              <Show when={spec().legend.length}>
                <div class="d-legend">
                  <For each={spec().legend}>
                    {(s) => (
                      <span>
                        <i class={s.line ? 'line' : ''} style={{ background: `var(--series-${(s.index % 8) + 1})` }} />
                        {s.name}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};
