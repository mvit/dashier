import { Component, For, Index, JSX, Show, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { chartKind } from '../runtime/charts';
import { ChartType, DashElement, RefLine } from '../types/model';
import { chartNames } from './widgets/ChartWidget';
import { FORMAT_CHOICES, UNIT_CHOICES } from './FieldWell';

/**
 * The Format tab: every setting of the selected visual, in sections ordered as the visual reads (its title, what it
 * shows, its axes and legend, its colors and marks). Each setting is data: a path into the element
 * ("options.barWidth", "grid.density"), so sections know when they've been changed, reset in one click,
 * and can be searched; and a visual's format can be copied onto another.
 */

type Opt = [value: unknown, label: string];
type Field =
  // `words`: the visual's own text (a title, a subtitle), not a format: never "changed", reset or copied
  | { kind: 'text'; label: string; key: string; placeholder?: string; words?: boolean }
  | { kind: 'number'; label: string; key: string; min?: number; max?: number; placeholder?: string }
  | { kind: 'range'; label: string; key: string; min: number; max: number; step: number; at: number; show: (v: number) => string }
  | { kind: 'select'; label: string; key: string; options: Opt[] }
  | { kind: 'seg'; label: string; key: string; options: Opt[] }
  | { kind: 'switch'; label: string; key: string; on?: boolean }
  | { kind: 'color'; label: string; key: string }
  | { kind: 'custom'; label: string; keys: string[]; render: () => JSX.Element };

interface Section {
  id: string;
  title: string;
  /** A switch in the header turns the whole thing on or off (`on`: its default). */
  toggle?: { key: string; on: boolean };
  fields: Field[];
}

/** Sections opened, kept while selecting other visuals. */
const [opened, setOpened] = createSignal(new Set(['title']));
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
const px = (v: number) => `${v}px`;
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
    const obj = JSON.parse(JSON.stringify(el()[top] ?? {}));
    let o = obj;
    for (const k of rest.slice(0, -1)) o = o[k] ??= {};
    blank ? delete o[rest[rest.length - 1]] : (o[rest[rest.length - 1]] = v);
    store.updateElement(store.activePageId(), el().id, { [top]: Object.keys(obj).length ? obj : undefined } as any);
  };
  const keysOf = (s: Section) => [...(s.toggle ? [s.toggle.key] : []), ...s.fields.flatMap(f => (f.kind === 'custom' ? f.keys : f.kind === 'text' && f.words ? [] : [f.key]))];
  const changed = (s: Section) => keysOf(s).some(k => get(k) !== undefined);
  const reset = (s: Section) => keysOf(s).forEach(k => put(k, undefined));

  /** The sections the selected visual has, in reading order. */
  const sections = (): Section[] => {
    const e = el();
    const t = e.type;
    const out: Section[] = [];
    const add = (when: unknown, s: Section) => when && out.push(s);

    add(true, {
      id: 'title',
      title: t === 'card' ? 'Label' : 'Title',
      fields: [{ kind: 'text', label: 'Text', key: 'title', placeholder: t === 'card' ? 'The value’s name' : 'No title', words: true }]
    });

    // --- cards ---
    add(t === 'card', {
      id: 'callout',
      title: 'Callout value',
      fields: [
        // unset, a card shows its measure's format and units
        { kind: 'select', label: 'Format', key: 'format', options: [[undefined, 'As its measure'], ...FORMATS.slice(1)] },
        { kind: 'select', label: 'Units', key: 'units', options: [[undefined, 'As its measure'], ...UNIT_CHOICES.slice(1)] },
        { kind: 'number', label: 'Size', key: 'callout.size', min: 10, max: 120, placeholder: 'fits' },
        { kind: 'color', label: 'Color', key: 'callout.color' },
        { kind: 'seg', label: 'Align', key: 'callout.align', options: [[undefined, 'Center'], ['left', 'Left']] }
      ]
    });
    add(t === 'card', {
      id: 'subtitle',
      title: 'Subtitle and comparison',
      fields: [
        { kind: 'text', label: 'Subtitle', key: 'subtitle', placeholder: 'None', words: true },
        ...(e.compare ? [{ kind: 'text', label: 'Comparison', key: 'compare.label', placeholder: 'vs 2024', words: true } as Field] : [])
      ]
    });

    // --- charts ---
    add(t === 'chart' && !is('sankey'), {
      id: 'values',
      title: 'Values',
      fields: [
        { kind: 'select', label: 'Format', key: 'options.format', options: FORMATS },
        { kind: 'select', label: 'Units', key: 'options.units', options: UNITS }
      ]
    });
    add(is('sankey'), { id: 'values', title: 'Values', fields: [{ kind: 'select', label: 'Units', key: 'options.units', options: UNITS }] });
    add(xy() || is('pie', 'donut', 'scatter'), {
      id: 'labels',
      title: 'Data labels',
      toggle: { key: 'options.showValues', on: false },
      fields: []
    });
    add(xy() || is('scatter'), {
      id: 'valueAxis',
      title: is('scatter') ? 'Y axis' : 'Value axis',
      toggle: { key: 'options.valueAxis', on: true },
      fields: [
        { kind: 'text', label: 'Title', key: 'options.yAxisLabel', placeholder: 'The value’s name' },
        { kind: 'number', label: 'Minimum', key: 'options.min', placeholder: 'auto' },
        { kind: 'number', label: 'Maximum', key: 'options.max', placeholder: 'auto' },
        ...(is('scatter') ? [] : [{ kind: 'switch', label: 'Gridlines', key: 'options.gridlines', on: true } as Field])
      ]
    });
    add(xy(), {
      id: 'categoryAxis',
      title: 'Category axis',
      toggle: { key: 'options.categoryAxis', on: true },
      fields: [{ kind: 'text', label: 'Title', key: 'options.xAxisLabel', placeholder: 'None' }]
    });
    add(is('radar', 'gauge'), {
      id: 'scale',
      title: 'Scale',
      fields: [
        { kind: 'number', label: is('radar') ? 'Center' : 'Minimum', key: 'options.min', placeholder: '0' },
        { kind: 'number', label: is('radar') ? 'Rim' : 'Target', key: 'options.max', placeholder: 'auto' }
      ]
    });
    add(t === 'chart' && !is('sankey', 'gauge'), {
      id: 'legend',
      title: 'Legend',
      toggle: { key: 'options.showLegend', on: true },
      fields: [{ kind: 'seg', label: 'Position', key: 'options.legendPosition', options: [[undefined, 'Bottom'], ['top', 'Top'], ['right', 'Right'], ['left', 'Left']] }]
    });
    add(t === 'chart' && !is('sankey'), {
      id: 'colors',
      title: 'Colors',
      fields: [
        ...(is('bar', 'hbar') ? [{ kind: 'switch', label: 'Color per bar', key: 'options.varyColors', on: false } as Field] : []),
        { kind: 'custom', label: 'Colors', keys: ['options.colors'], render: colorList }
      ]
    });
    add(is('bar', 'hbar', 'combo'), {
      id: 'bars',
      title: 'Bars',
      fields: [
        { kind: 'range', label: 'Width', key: 'options.barWidth', min: 0.2, max: 1, step: 0.05, at: 0.7, show: share },
        { kind: 'range', label: 'Corners', key: 'options.barRadius', min: 0, max: 12, step: 1, at: 0, show: px },
        { kind: 'select', label: 'Stack', key: 'options.stack', options: is('combo') ? [[undefined, 'Side by side'], ['stacked', 'Stacked']] : [[undefined, 'Side by side'], ['stacked', 'Stacked'], ['percent', '100% stacked']] }
      ]
    });
    add(is('line', 'area', 'combo'), {
      id: 'lines',
      title: 'Lines',
      fields: [
        { kind: 'range', label: 'Width', key: 'options.lineWidth', min: 1, max: 6, step: 0.5, at: 2, show: px },
        { kind: 'seg', label: 'Points', key: 'options.markers', options: [[undefined, 'Auto'], [true, 'Always'], [false, 'Never']] },
        ...(is('area') ? [{ kind: 'select', label: 'Stack', key: 'options.stack', options: [[undefined, 'Overlapping'], ['stacked', 'Stacked'], ['percent', '100% stacked']] } as Field] : [])
      ]
    });
    add(is('donut'), { id: 'donut', title: 'Donut', fields: [{ kind: 'range', label: 'Hole', key: 'options.donutHole', min: 0.2, max: 0.85, step: 0.05, at: 0.55, show: share }] });
    add(xy() || is('pie', 'donut', 'radar'), {
      id: 'order',
      title: 'Order',
      fields: [
        { kind: 'select', label: 'Sort by', key: 'options.sort', options: SORTS },
        { kind: 'number', label: 'Top N', key: 'options.topN', min: 1, placeholder: 'All' }
      ]
    });
    add(xy(), { id: 'refLines', title: 'Reference lines', fields: [{ kind: 'custom', label: 'Reference lines', keys: ['options.refLines'], render: refLines }] });

    // --- tables, matrices, slicers, text ---
    add(t === 'table' || t === 'matrix', {
      id: 'grid',
      title: 'Grid',
      fields: [
        { kind: 'seg', label: 'Rows', key: 'grid.density', options: [['compact', 'Compact'], [undefined, 'Normal'], ['roomy', 'Roomy']] },
        { kind: 'switch', label: 'Banded rows', key: 'grid.banded', on: false },
        { kind: 'seg', label: 'Lines', key: 'grid.lines', options: [[undefined, 'Rows'], ['both', 'Rows and columns'], ['none', 'None']] },
        { kind: 'number', label: 'Text size', key: 'grid.textSize', min: 8, max: 24, placeholder: '11.5' }
      ]
    });
    add(t === 'table', { id: 'totals', title: 'Totals', toggle: { key: 'totals', on: true }, fields: [] });
    add(t === 'matrix', {
      id: 'totals',
      title: 'Totals',
      fields: [
        { kind: 'select', label: 'Totals', key: 'totals', options: [[undefined, 'Row and column'], ['row', 'Total row only'], ['column', 'Total column only'], [false, 'None']] },
        { kind: 'switch', label: 'Subtotals', key: 'subtotals', on: true }
      ]
    });
    add(t === 'slicer', {
      id: 'slicer',
      title: 'Slicer',
      fields: [
        { kind: 'select', label: 'Style', key: 'style', options: [[undefined, 'Automatic'], ['list', 'List'], ['dropdown', 'Dropdown'], ['tiles', 'Tiles'], ['range', 'Between (numbers)']] },
        { kind: 'switch', label: 'Single select', key: 'single', on: false }
      ]
    });
    add(t === 'markdown', {
      id: 'text',
      title: 'Text',
      fields: [
        { kind: 'number', label: 'Size', key: 'textSize', min: 8, max: 48, placeholder: '12.5' },
        { kind: 'seg', label: 'Align', key: 'align', options: [[undefined, 'Left'], ['center', 'Center'], ['right', 'Right']] }
      ]
    });

    return out;
  };

  // --- search: sections whose title matches show whole; otherwise only the matching settings ---
  const [query, setQuery] = createSignal('');
  const q = () => query().trim().toLowerCase();
  const shown = () =>
    sections().flatMap(s => {
      if (!q() || s.title.toLowerCase().includes(q())) return [s];
      const fields = s.fields.filter(f => f.label.toLowerCase().includes(q()));
      return fields.length ? [{ ...s, fields }] : [];
    });
  const isOpen = (s: Section) => !!q() || opened().has(s.id);
  const flip = (s: Section) => setOpened(o => (o.has(s.id) ? (o.delete(s.id), new Set(o)) : new Set(o.add(s.id))));

  // --- copy and paste format ---
  const copy = () => {
    const keys = FORMAT_KEYS[el().type] ?? [];
    const format = Object.fromEntries(keys.map(k => [k, el()[k] === undefined ? undefined : JSON.parse(JSON.stringify(el()[k]))]));
    // a chart's title text and its data choices (sort, top N) stay with it
    if (format.options) format.options = { ...format.options, title: undefined, sort: undefined, topN: undefined };
    setCopied({ type: el().type, format });
  };
  const paste = () => {
    const c = copied();
    if (!c || c.type !== el().type) return;
    const format = { ...c.format };
    if (format.options) format.options = { ...format.options, title: el().options?.title, sort: el().options?.sort, topN: el().options?.topN };
    store.updateElement(store.activePageId(), el().id, JSON.parse(JSON.stringify(format)) as any);
  };

  // --- controls ---
  const control = (f: Field): JSX.Element => {
    switch (f.kind) {
      case 'text':
        return <input type="text" class="d-input" value={get(f.key) ?? ''} placeholder={f.placeholder} onInput={(e) => put(f.key, e.currentTarget.value)} />;
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
        return (
          <select class="d-well-select" onChange={(e) => put(f.key, f.options[Number(e.currentTarget.value)][0])}>
            <For each={f.options}>{(o, i) => <option value={i()} selected={get(f.key) === o[0]}>{o[1]}</option>}</For>
          </select>
        );
      case 'seg':
        return (
          <div class="d-seg d-fseg">
            <For each={f.options}>{(o) => <button class={get(f.key) === o[0] ? 'on' : ''} onClick={() => put(f.key, o[0])}>{o[1]}</button>}</For>
          </div>
        );
      case 'switch':
        return <Switch on={get(f.key) ?? f.on ?? false} set={(v) => put(f.key, v === (f.on ?? false) ? undefined : v)} />;
      case 'color':
        return <Color value={get(f.key)} set={(v) => put(f.key, v)} />;
      default:
        return f.render();
    }
  };

  /** Each colorable name of the chart (series, slices, groups) with its color: the palette's unless picked. */
  function colorList() {
    const names = () => chartNames()[el().id] ?? [];
    const colors = () => (el().options?.colors ?? {}) as Record<string, string>;
    const set = (name: string, c?: string) => put('options.colors', JSON.parse(JSON.stringify({ ...colors(), [name]: c })));
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
    const save = (l: RefLine[]) => put('options.refLines', l.length ? JSON.parse(JSON.stringify(l)) : undefined);
    const patch = (i: number, p: Partial<RefLine>) => save(lines().map((l, j) => (j === i ? { ...l, ...p } : l)));
    return (
      <div class="d-frefs">
        <Index each={lines()}>
          {(l, i) => (
            <div class="d-fref">
              <select class="d-well-select" onChange={(e) => patch(i, { stat: (STATS[Number(e.currentTarget.value)][0] as RefLine['stat']) ?? undefined, value: undefined })}>
                <For each={STATS}>{(o, k) => <option value={k()} selected={l().stat === o[0]}>{o[1]}</option>}</For>
              </select>
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
    <div class="d-fpane">
      <div class="d-ftools">
        <input type="search" class="d-input" placeholder="Search format settings" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        <button class="d-fbtn" title="Copy this visual's format" onClick={copy}>Copy</button>
        <button
          class="d-fbtn"
          title={!copied() ? 'Copy a format first' : copied()!.type === el().type ? 'Paste the copied format here' : `The copied format is a ${copied()!.type}'s`}
          disabled={copied()?.type !== el().type}
          onClick={paste}
        >
          Paste
        </button>
      </div>
      <For each={shown()} fallback={<div class="d-fhint">No setting matches “{query()}”.</div>}>
        {(s) => (
          <section class={`d-fsec ${isOpen(s) ? 'open' : ''}`}>
            <div class="d-fsec-head">
              <button class="d-fsec-title" onClick={() => flip(s)}>
                <span class="d-fcaret">{isOpen(s) ? '▾' : '▸'}</span>
                {s.title}
                <Show when={changed(s)}>
                  <i class="d-fchanged" title="Changed from the default" />
                </Show>
              </button>
              <Show when={changed(s)}>
                <button class="d-freset" title="Back to the default" onClick={() => reset(s)}>↺</button>
              </Show>
              <Show when={s.toggle}>
                {(tg) => <Switch on={get(tg().key) ?? tg().on} set={(v) => put(tg().key, v === tg().on ? undefined : v)} />}
              </Show>
            </div>
            <Show when={isOpen(s) && s.fields.length}>
              {/* a section switched off greys its settings: they keep their values for when it's back on */}
              <div class={`d-fsec-body ${s.toggle && (get(s.toggle.key) ?? s.toggle.on) === false ? 'off' : ''}`}>
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
              </div>
            </Show>
          </section>
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
const Color: Component<{ value?: string; auto?: string; set: (v?: string) => void }> = (props) => (
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
