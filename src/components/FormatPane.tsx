import { clone } from '../runtime/data';
import { Component, For, Index, JSX, Show, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { chartKind } from '../runtime/charts';
import { ChartType, DashElement, RefLine } from '../types/model';
import { chartNames } from './widgets/ChartWidget';
import { FORMAT_CHOICES, UNIT_CHOICES } from './FieldWell';
import { Card, Search, Select } from './ui';

/**
 * Settings panes: the Format tab (every setting of the selected visual, in sections ordered as the visual reads: its
 * title, what it shows, its axes and legend, its colors and marks) and the report's (ThemeEditor). Each setting is
 * data: a path ("options.barWidth", "grid.density"), so sections know when they've been changed, reset in one click
 * and can be searched; and a visual's format can be copied onto another.
 */

export type Opt = [value: unknown, label: string];
export type Field =
  // `words`: the visual's own text (a title, a subtitle), not a format: never "changed", reset or copied;
  // `suggest`: values offered as it's typed (fonts)
  | { kind: 'text'; label: string; key: string; placeholder?: string; words?: boolean; suggest?: string[] }
  | { kind: 'number'; label: string; key: string; min?: number; max?: number; placeholder?: string }
  | { kind: 'range'; label: string; key: string; min: number; max: number; step: number; at: number; show: (v: number) => string }
  | { kind: 'select'; label: string; key: string; options: Opt[] }
  | { kind: 'seg'; label: string; key: string; options: Opt[] }
  | { kind: 'switch'; label: string; key: string; on?: boolean }
  // `auto`: the color it has while unset
  | { kind: 'color'; label: string; key: string; auto?: () => string }
  | { kind: 'custom'; label: string; keys: string[]; render: () => JSX.Element };

export interface Section {
  id: string;
  title: string;
  /** A switch in the header turns the whole thing on or off (`on`: its default). */
  toggle?: { key: string; on: boolean };
  fields: Field[];
}

/** Sections opened, kept while selecting other visuals (the report's are "theme-…"). */
const [opened, setOpened] = createSignal(new Set(['title', 'theme-colors']));
/** A copied format: the element's type and its format settings. */
const [copied, setCopied] = createSignal<{ type: string; format: Record<string, unknown> } | null>(null);

/** What each type's format is: what Copy format carries (never the data, fields or text). */
const FORMAT_KEYS: Record<string, string[]> = {
  chart: ['options'],
  card: ['format', 'units', 'callout'],
  table: ['grid', 'totals'],
  matrix: ['grid', 'totals', 'subtotals'],
  slicer: ['style', 'single'],
  markdown: ['textSize', 'align']
};

const FORMATS: Opt[] = FORMAT_CHOICES;
// a chart's numbers are compact by default; fixed units put every axis label and data label in one
const UNITS: Opt[] = [[undefined, 'Automatic (compact)'], ...UNIT_CHOICES.slice(2)];
const SORTS: Opt[] = [[undefined, 'Data order'], ['value-desc', 'Value, high to low'], ['value-asc', 'Value, low to high'], ['label', 'Name, A to Z']];
const STATS: Opt[] = [[undefined, 'Value'], ['average', 'Average'], ['median', 'Median'], ['min', 'Minimum'], ['max', 'Maximum']];
const STACK: Opt[] = [[undefined, 'Side by side'], ['stacked', 'Stacked'], ['percent', '100% stacked']];

/** Settings by kind: a label and a path into what's being set, then what the kind takes. */
export const F = {
  text: (label: string, key: string, placeholder?: string, words?: boolean, suggest?: string[]): Field => ({ kind: 'text', label, key, placeholder, words, suggest }),
  num: (label: string, key: string, placeholder = 'auto', min?: number, max?: number): Field => ({ kind: 'number', label, key, placeholder, min, max }),
  range: (label: string, key: string, min: number, max: number, step: number, at: number, show: (v: number) => string): Field => ({ kind: 'range', label, key, min, max, step, at, show }),
  select: (label: string, key: string, options: Opt[]): Field => ({ kind: 'select', label, key, options }),
  seg: (label: string, key: string, options: Opt[]): Field => ({ kind: 'seg', label, key, options }),
  // `on`: the switch's default
  sw: (label: string, key: string, on = false): Field => ({ kind: 'switch', label, key, on }),
  color: (label: string, key: string, auto?: () => string): Field => ({ kind: 'color', label, key, auto })
};
/** A card of settings (false ones are left out), with a switch in its head for `toggle`: [path, its default]. */
export const sec = (id: string, title: string, fields: (Field | false)[], toggle?: [string, boolean]): Section => ({
  id,
  title,
  fields: fields.filter(Boolean) as Field[],
  toggle: toggle && { key: toggle[0], on: toggle[1] }
});
export const px = (v: number) => `${v}px`;
const share = (v: number) => `${Math.round(v * 100)}%`;

export const FormatPane: Component = () => {
  const el = () => store.getSelectedElement() as any as DashElement & Record<string, any>;
  const kind = () => (el().type === 'chart' ? chartKind(el().chartType) : null);
  const is = (...types: ChartType[]) => !!kind() && types.includes(kind()!);
  const xy = () => is('bar', 'hbar', 'line', 'area', 'combo');

  // a setting's value at its path, and setting it (blank clears it; an object left empty goes too)
  const get = (path: string) => path.split('.').reduce<any>((o, k) => o?.[k], el());
  const put = (path: string, v: unknown) => {
    const [top, ...rest] = path.split('.');
    const blank = v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
    if (!rest.length) return store.updateElement(store.activePageId(), el().id, { [top]: blank ? undefined : v } as any);
    const obj = clone(el()[top] ?? {});
    let o = obj;
    for (const k of rest.slice(0, -1)) o = o[k] ??= {};
    blank ? delete o[rest[rest.length - 1]] : (o[rest[rest.length - 1]] = v);
    store.updateElement(store.activePageId(), el().id, { [top]: Object.keys(obj).length ? obj : undefined } as any);
  };
  /** The sections the selected visual has, in reading order. */
  const sections = (): Section[] => {
    const e = el();
    const t = e.type;
    const out: Section[] = [];
    const add = (when: unknown, s: Section) => when && out.push(s);

    add(true, sec('title', t === 'card' ? 'Label' : 'Title', [F.text('Text', 'title', t === 'card' ? 'The value’s name' : 'No title', true)]));

    // --- cards: unset, a card shows its measure's format and units ---
    add(t === 'card', sec('callout', 'Callout value', [
      F.select('Format', 'format', [[undefined, 'As its measure'], ...FORMATS.slice(1)]),
      F.select('Units', 'units', [[undefined, 'As its measure'], ...UNIT_CHOICES.slice(1)]),
      F.num('Size', 'callout.size', 'fits', 10, 120),
      F.color('Color', 'callout.color'),
      F.seg('Align', 'callout.align', [[undefined, 'Center'], ['left', 'Left']])
    ]));
    add(t === 'card', sec('subtitle', 'Subtitle and comparison', [F.text('Subtitle', 'subtitle', 'None', true), !!e.compare && F.text('Comparison', 'compare.label', 'vs 2024', true)]));

    // --- charts ---
    add(t === 'chart', sec('values', 'Values', [!is('sankey') && F.select('Format', 'options.format', FORMATS), F.select('Units', 'options.units', UNITS)]));
    add(xy() || is('pie', 'donut', 'scatter'), sec('labels', 'Data labels', [], ['options.showValues', false]));
    add(xy() || is('scatter'), sec('valueAxis', is('scatter') ? 'Y axis' : 'Value axis', [
      F.text('Title', 'options.yAxisLabel', 'The value’s name'),
      F.num('Minimum', 'options.min'),
      F.num('Maximum', 'options.max'),
      !is('scatter') && F.sw('Gridlines', 'options.gridlines', true)
    ], ['options.valueAxis', true]));
    add(xy(), sec('categoryAxis', 'Category axis', [F.text('Title', 'options.xAxisLabel', 'None')], ['options.categoryAxis', true]));
    add(is('radar', 'gauge'), sec('scale', 'Scale', [F.num(is('radar') ? 'Center' : 'Minimum', 'options.min', '0'), F.num(is('radar') ? 'Rim' : 'Target', 'options.max')]));
    add(t === 'chart' && !is('sankey', 'gauge'), sec('legend', 'Legend', [F.seg('Position', 'options.legendPosition', [[undefined, 'Bottom'], ['top', 'Top'], ['right', 'Right'], ['left', 'Left']])], ['options.showLegend', true]));
    add(t === 'chart' && !is('sankey'), sec('colors', 'Colors', [is('bar', 'hbar') && F.sw('Color per bar', 'options.varyColors'), { kind: 'custom', label: 'Colors', keys: ['options.colors'], render: colorList }]));
    add(is('bar', 'hbar', 'combo'), sec('bars', 'Bars', [
      F.range('Width', 'options.barWidth', 0.2, 1, 0.05, 0.7, share),
      F.range('Corners', 'options.barRadius', 0, 12, 1, 0, px),
      F.select('Stack', 'options.stack', STACK.slice(0, is('combo') ? 2 : 3))
    ]));
    add(is('line', 'area', 'combo'), sec('lines', 'Lines', [
      F.range('Width', 'options.lineWidth', 1, 6, 0.5, 2, px),
      F.seg('Points', 'options.markers', [[undefined, 'Auto'], [true, 'Always'], [false, 'Never']]),
      is('area') && F.select('Stack', 'options.stack', [[undefined, 'Overlapping'], ...STACK.slice(1)])
    ]));
    add(is('donut'), sec('donut', 'Donut', [F.range('Hole', 'options.donutHole', 0.2, 0.85, 0.05, 0.55, share)]));
    add(xy() || is('pie', 'donut', 'radar'), sec('order', 'Order', [F.select('Sort by', 'options.sort', SORTS), F.num('Top N', 'options.topN', 'All', 1)]));
    add(xy(), sec('refLines', 'Reference lines', [{ kind: 'custom', label: 'Reference lines', keys: ['options.refLines'], render: refLines }]));

    // --- tables, matrices, slicers, text ---
    add(t === 'table' || t === 'matrix', sec('grid', 'Grid', [
      F.seg('Rows', 'grid.density', [['compact', 'Compact'], [undefined, 'Normal'], ['roomy', 'Roomy']]),
      F.sw('Banded rows', 'grid.banded'),
      F.seg('Lines', 'grid.lines', [[undefined, 'Rows'], ['both', 'Rows and columns'], ['none', 'None']]),
      F.num('Text size', 'grid.textSize', '11.5', 8, 24)
    ]));
    add(t === 'table', sec('totals', 'Totals', [], ['totals', true]));
    add(t === 'matrix', sec('totals', 'Totals', [
      F.select('Totals', 'totals', [[undefined, 'Row and column'], ['row', 'Total row only'], ['column', 'Total column only'], [false, 'None']]),
      F.sw('Subtotals', 'subtotals', true)
    ]));
    add(t === 'slicer', sec('slicer', 'Slicer', [
      F.select('Style', 'style', [[undefined, 'Automatic'], ['list', 'List'], ['dropdown', 'Dropdown'], ['tiles', 'Tiles'], ['range', 'Between']]),
      F.sw('Single select', 'single')
    ]));
    add(t === 'markdown', sec('text', 'Text', [F.num('Size', 'textSize', '12.5', 8, 48), F.seg('Align', 'align', [[undefined, 'Left'], ['center', 'Center'], ['right', 'Right']])]));

    return out;
  };

  // --- copy and paste format ---
  const copy = () => {
    const keys = FORMAT_KEYS[el().type] ?? [];
    const format = Object.fromEntries(keys.map(k => [k, el()[k] === undefined ? undefined : clone(el()[k])]));
    // a chart's title text and its data choices (sort, top N) stay with it
    if (format.options) format.options = { ...format.options, title: undefined, sort: undefined, topN: undefined };
    setCopied({ type: el().type, format });
  };
  const paste = () => {
    const c = copied();
    if (!c || c.type !== el().type) return;
    const format = { ...c.format };
    if (format.options) format.options = { ...format.options, title: el().options?.title, sort: el().options?.sort, topN: el().options?.topN };
    store.updateElement(store.activePageId(), el().id, clone(format) as any);
  };

  /** Each colorable name of the chart (series, slices, groups) with its color: the palette's unless picked. */
  function colorList() {
    const names = () => chartNames()[el().id] ?? [];
    const colors = () => (el().options?.colors ?? {}) as Record<string, string>;
    const set = (name: string, c?: string) => put('options.colors', clone({ ...colors(), [name]: c }));
    const palette = (i: number) => store.reportTheme().palette[i % store.reportTheme().palette.length];
    return (
      <Show when={names().length} fallback={<div class="d-fhint">Place fields in the chart to color its series.</div>}>
        <div class="d-fcolors">
          <Index each={names()}>
            {(name, i) => (
              <div class="d-frow">
                <span class="d-flabel" title={name()}>{name()}</span>
                <Color value={colors()[name()]} auto={el().type === 'chart' && kind() === 'gauge' ? undefined : palette(i)} set={(c) => set(name(), c)} />
              </div>
            )}
          </Index>
        </div>
      </Show>
    );
  }

  /** Reference lines: a fixed value or a statistic of the first series, each with a label and a color. */
  function refLines() {
    const lines = (): RefLine[] => el().options?.refLines ?? [];
    const save = (l: RefLine[]) => put('options.refLines', l.length ? clone(l) : undefined);
    const patch = (i: number, p: Partial<RefLine>) => save(lines().map((l, j) => (j === i ? { ...l, ...p } : l)));
    return (
      <div class="d-frefs">
        <Index each={lines()}>
          {(l, i) => (
            <div class="d-fref">
              <Select value={l().stat} options={STATS} set={(stat) => patch(i, { stat, value: undefined })} />
              <Show when={!l().stat}>
                <input type="number" class="d-input" placeholder="Value" value={l().value ?? ''} onInput={(e) => patch(i, { value: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })} />
              </Show>
              <input type="text" class="d-input" placeholder="Label" value={l().label ?? ''} onInput={(e) => patch(i, { label: e.currentTarget.value || undefined })} />
              <Color value={l().color} set={(c) => patch(i, { color: c })} />
              <button class="d-fx" title="Remove the line" onClick={() => save(lines().filter((_, j) => j !== i))}>×</button>
            </div>
          )}
        </Index>
        <button class="d-link-btn" onClick={() => save([...lines(), { stat: 'average' }])}>+ Add a line</button>
      </div>
    );
  }

  return (
    <SettingsPane
      sections={sections()}
      get={get}
      put={put}
      search="Search format settings"
      tools={
        <>
          <button class="d-fbtn" title="Copy this visual's format" onClick={copy}>Copy</button>
          <button
            class="d-fbtn"
            title={!copied() ? 'Copy a format first' : copied()!.type === el().type ? 'Paste the copied format here' : `The copied format is a ${copied()!.type}'s`}
            disabled={copied()?.type !== el().type}
            onClick={paste}
          >
            Paste
          </button>
        </>
      }
    />
  );
};

/**
 * Settings in cards: each a path read with `get` and written with `put` (undefined: back to its default). A card
 * marks its changed settings and resets them; the search shows the cards (or the settings) whose names match.
 */
export const SettingsPane: Component<{ sections: Section[]; get: (path: string) => any; put: (path: string, v: unknown) => void; search: string; tools?: JSX.Element }> = (props) => {
  const { get, put } = props;
  const keysOf = (s: Section) => [...(s.toggle ? [s.toggle.key] : []), ...s.fields.flatMap(f => (f.kind === 'custom' ? f.keys : f.kind === 'text' && f.words ? [] : [f.key]))];
  const changed = (s: Section) => keysOf(s).some(k => get(k) !== undefined);
  const reset = (s: Section) => keysOf(s).forEach(k => put(k, undefined));

  // --- search: sections whose title matches show whole; otherwise only the matching settings ---
  const [query, setQuery] = createSignal('');
  const q = () => query().trim().toLowerCase();
  const shown = () =>
    props.sections.flatMap(s => {
      if (!q() || s.title.toLowerCase().includes(q())) return [s];
      const fields = s.fields.filter(f => f.label.toLowerCase().includes(q()));
      return fields.length ? [{ ...s, fields }] : [];
    });
  const isOpen = (s: Section) => !!q() || opened().has(s.id);
  const flip = (s: Section) => setOpened(o => (o.has(s.id) ? (o.delete(s.id), new Set(o)) : new Set(o.add(s.id))));

  // --- controls ---
  const control = (f: Field): JSX.Element => {
    switch (f.kind) {
      case 'text':
        return (
          <>
            <input type="text" class="d-input" list={f.suggest && `d-suggest-${f.key}`} value={get(f.key) ?? ''} placeholder={f.placeholder} onInput={(e) => put(f.key, e.currentTarget.value)} />
            <Show when={f.suggest}>
              <datalist id={`d-suggest-${f.key}`}>
                <For each={f.suggest}>{(v) => <option value={v} />}</For>
              </datalist>
            </Show>
          </>
        );
      case 'number':
        return (
          <input
            type="number"
            class="d-input"
            min={f.min}
            max={f.max}
            value={get(f.key) ?? ''}
            placeholder={f.placeholder ?? 'auto'}
            onInput={(e) => put(f.key, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
          />
        );
      case 'range':
        return (
          <div class="d-frange">
            <input type="range" min={f.min} max={f.max} step={f.step} value={get(f.key) ?? f.at} onInput={(e) => put(f.key, Number(e.currentTarget.value))} />
            <span>{f.show(get(f.key) ?? f.at)}</span>
          </div>
        );
      case 'select':
        return <Select value={get(f.key)} options={f.options} set={(v) => put(f.key, v)} />;
      case 'seg':
        return (
          <div class="d-seg d-fseg">
            <For each={f.options}>{(o) => <button class={get(f.key) === o[0] ? 'on' : ''} onClick={() => put(f.key, o[0])}>{o[1]}</button>}</For>
          </div>
        );
      case 'switch':
        return <Switch on={get(f.key) ?? f.on ?? false} set={(v) => put(f.key, v === (f.on ?? false) ? undefined : v)} />;
      case 'color':
        return <Color value={get(f.key)} auto={f.auto?.()} set={(v) => put(f.key, v)} />;
      default:
        return f.render();
    }
  };

  return (
    <div class="d-fpane">
      <div class="d-ftools">
        <Search class="d-input" placeholder={props.search} value={query()} set={setQuery} />
        {props.tools}
      </div>
      <For each={shown()} fallback={<div class="d-fhint">No setting matches “{query()}”.</div>}>
        {(s) => (
          <Card
            class="d-fsec"
            open={isOpen(s)}
            flip={() => flip(s)}
            empty={!s.fields.length}
            // a section switched off greys its settings: they keep their values for when it's back on
            body={s.toggle && (get(s.toggle.key) ?? s.toggle.on) === false ? 'off' : ''}
            title={
              <>
                {s.title}
                <Show when={changed(s)}>
                  <i class="d-fchanged" title="Changed from the default" />
                </Show>
              </>
            }
            actions={
              <>
                <Show when={changed(s)}>
                  <button class="d-freset" title="Back to the default" onClick={() => reset(s)}>↺</button>
                </Show>
                <Show when={s.toggle}>
                  {(tg) => <Switch on={get(tg().key) ?? tg().on} set={(v) => put(tg().key, v === tg().on ? undefined : v)} />}
                </Show>
              </>
            }
          >
            <For each={s.fields}>
              {(f) =>
                f.kind === 'custom' ? (
                  control(f)
                ) : (
                  <div class="d-frow">
                    <span class="d-flabel">{f.label}</span>
                    {control(f)}
                  </div>
                )
              }
            </For>
          </Card>
        )}
      </For>
    </div>
  );
};

/** An on/off switch. */
const Switch: Component<{ on: boolean; set: (v: boolean) => void }> = (props) => (
  <button class={`d-switch ${props.on ? 'on' : ''}`} role="switch" aria-checked={props.on} onClick={(e) => (e.preventDefault(), props.set(!props.on))}>
    <i />
  </button>
);

/** A color: a swatch to pick one, its value (or "Auto", the default's), and a way back to the default. */
export const Color: Component<{ value?: string; auto?: string; set: (v?: string) => void }> = (props) => (
  <div class="d-fcolor">
    <label class="d-fswatch" style={{ background: props.value ?? props.auto }}>
      <input type="color" value={props.value ?? props.auto ?? '#888888'} onInput={(e) => props.set(e.currentTarget.value)} />
    </label>
    <span class="d-fcolor-name">{props.value ?? 'Auto'}</span>
    <Show when={props.value}>
      <button class="d-fx" title="Back to the default" onClick={() => props.set(undefined)}>×</button>
    </Show>
  </div>
);
