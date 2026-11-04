import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { ChartElement } from '../../types/model';
import { store } from '../../runtime/store';
import { buildChart, chartReady } from '../../runtime/charts';
import { ChartHost } from './ChartHost';
import { empty } from './CardWidget';



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

  const gauge = () => el().chartType === 'gauge';
  const names = createMemo(() => spec().names ?? []);
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
        <span class="chart-title">{el().title || 'Chart'}</span>
      </div>

      <Show
        when={chartReady(el())}
        fallback={empty('Drag fields from the Data pane into this chart’s slots')}
      >
        {/* rows whose values are all blank are no data either */}
        <Show when={rows().length > 0 && spec().draw} fallback={<div class="d-chart-empty">No data for these fields</div>}>
            {/* every chart's legend is this one: same swatches, font and placement */}
            <div class={`d-chart-body legend-${el().options?.legendPosition || 'bottom'}`}>
              <ChartHost
                draw={spec().draw}
                tip={spec().tip}
                minWidth={store.phone() && !store.printing() ? spec().minWidth : 0}
                picked={store.picked()?.from === el().id ? store.picked()!.mark : undefined}
                onPick={spec().pick && !store.printing() ? (t) => store.pickMark(el(), spec().pick!(t)) : undefined}
              />
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
    </div>
  );
};
