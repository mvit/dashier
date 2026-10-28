import { Component, Show, For, JSX, createEffect, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { DroppedField, dropProps } from '../runtime/dnd';
import { chartKind, summaryLabel, valueLabel } from '../runtime/charts';
import type { DatePart } from '../runtime/dates';
import { isMeasureRef, measureName } from '../runtime/measures';
import { AggregationMethod, ChartType, Compare, MatrixField, MatrixValue, ShowAs, TableColumn, ValueSummary, WidgetType } from '../types/model';
import { FieldWell, MenuSection, WellItem, compareSections, condSection, dateSection, formatSection, showAsSection, summarizeSection, unitsSection } from './FieldWell';
import { ThemeEditor } from './ThemeEditor';
import { FormatPane } from './FormatPane';
import { TemplateSlots, bindingFor, variableName } from './TemplateSlots';

type GalleryItem = [title: string, type: WidgetType, chartType: ChartType | undefined, icon: JSX.Element];

/**
 * The gallery, by what a visual is for: comparisons, trends, parts of a whole, relationships and flows; then, on
 * a row of their own after a divider (null), single numbers, tables, filters and content.
 */
const GALLERY: (GalleryItem | null)[] = [
  ['Column chart', 'chart', 'bar', <g fill="currentColor"><rect x="4" y="10" width="4" height="10" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><rect x="16" y="13" width="4" height="7" rx="1" /></g>],
  ['Bar chart', 'chart', 'hbar', <g fill="currentColor"><rect x="4" y="4" width="10" height="4" rx="1" /><rect x="4" y="10" width="16" height="4" rx="1" /><rect x="4" y="16" width="7" height="4" rx="1" /></g>],
  ['Line and column chart', 'chart', 'combo', <g><g fill="currentColor" opacity="0.55"><rect x="4" y="12" width="4" height="8" rx="1" /><rect x="10" y="9" width="4" height="11" rx="1" /><rect x="16" y="13" width="4" height="7" rx="1" /></g><polyline points="3 10 9 5 15 8 21 3" fill="none" stroke="currentColor" stroke-width="2.2" /></g>],
  ['Line chart', 'chart', 'line', <polyline points="3 18 9 10 15 14 21 6" fill="none" stroke="currentColor" stroke-width="2.5" />],
  ['Area chart', 'chart', 'area', <g><path d="M3 20 L3 13 L9 8 L15 11 L21 5 L21 20 Z" fill="currentColor" opacity="0.4" /><polyline points="3 13 9 8 15 11 21 5" fill="none" stroke="currentColor" stroke-width="2.2" /></g>],
  ['Pie chart', 'chart', 'pie', <g fill="currentColor"><path d="M12 2 A 10 10 0 0 1 22 12 L 12 12 Z" /><path d="M10 12 L 10 2 A 10 10 0 1 0 22 10 L 10 10 Z" opacity="0.6" /></g>],
  ['Donut chart', 'chart', 'donut', <g fill="none" stroke="currentColor" stroke-width="5"><path d="M12 4.5 A 7.5 7.5 0 0 1 19.5 12" /><path d="M19.5 12 A 7.5 7.5 0 1 1 12 4.5" opacity="0.6" /></g>],
  ['Treemap', 'chart', 'treemap', <g fill="currentColor"><rect x="3" y="3" width="11" height="11" rx="1" /><rect x="16" y="3" width="5" height="7" rx="1" opacity="0.7" /><rect x="16" y="12" width="5" height="9" rx="1" opacity="0.5" /><rect x="3" y="16" width="11" height="5" rx="1" opacity="0.7" /></g>],
  ['Scatter chart', 'chart', 'scatter', <g fill="currentColor"><circle cx="6" cy="17" r="2" /><circle cx="10" cy="11" r="2" /><circle cx="14" cy="14" r="2" /><circle cx="17" cy="7" r="2" /><circle cx="19" cy="12" r="2" opacity="0.6" /></g>],
  ['Radar chart', 'chart', 'radar', <g fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 3 21 10 17.5 20 6.5 20 3 10" opacity="0.5" /><polygon points="12 8 16 11 15 16 9 16 8 11" /></g>],
  ['Sankey flow', 'chart', 'sankey', <g fill="none" stroke="currentColor" stroke-width="3"><path d="M4 6 C 12 6 12 16 20 16" /><path d="M4 12 C 12 12 12 7 20 7" opacity="0.6" /></g>],
  ['Gauge', 'chart', 'gauge', <path d="M4 17 A 8 8 0 0 1 20 17" fill="none" stroke="currentColor" stroke-width="3.5" />],
  null,
  ['Card (KPI)', 'card', undefined, <g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 12h10" /></g>],
  ['Table', 'table', undefined, <g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></g>],
  ['Matrix', 'matrix', undefined, <g fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M15 9v12" /><path d="M5 13h2M5 17h2" opacity="0.6" /></g>],
  ['Slicer', 'slicer', undefined, <g fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></g>],
  ['Text box', 'markdown', undefined, <path d="M4 7V4h16v3M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="2" />],
];

type Slot = 'x' | 'y' | 'group' | 'line' | 'detail' | 'field' | 'column' | 'row' | 'col' | 'value';
type List = 'rows' | 'columns' | 'values';

export const VisualsPane: Component = () => {
  const sel = () => store.getSelectedElement() as any;
  const update = (updates: object) => sel() && store.updateElement(store.activePageId(), sel().id, updates as any);
  const set = (prop: string, val: any) => update({ [prop]: val });
  // drops undefined entries (e.g. a column's cleared summary) from what's stored
  const setClean = (prop: string, val: any) => set(prop, JSON.parse(JSON.stringify(val)));
  const setIn = (prop: string, key: string, val: any) => set(prop, { ...(sel()?.[prop] || {}), [key]: val === '' ? undefined : val });
  const setAgg = (prop: string) => (m?: AggregationMethod) => set(prop, m === 'sum' ? undefined : { aggregate: m });
  const isType = (t: WidgetType, c?: ChartType) => sel()?.type === t && (!c || chartKind(sel().chartType) === c);
  const chartIs = (...types: ChartType[]) => isType('chart') && types.includes(chartKind(sel().chartType));

  const [over, setOver] = createSignal(false);
  /** A field dropped on a text box's text: inserts {{ name }} and binds it (summarized in the slot list below). */
  const textDrop = dropProps((f) => {
    const name = variableName(sel(), f);
    update({ content: `${sel().content ? sel().content + '\n' : ''}{{ ${name} }}`, bindings: { ...(sel().bindings || {}), [name]: bindingFor(f) } });
  }, setOver);

  // Fields are only ever dragged in: the first one decides the visual's table, later ones must be connected to it.
  createEffect(() => (sel()?.id, store.setDropNote('')));
  const take = (slot: Slot) => (f: DroppedField): boolean => {
    if (f.field) return store.assignField(sel(), slot, { table: f.table, field: f.field });
    store.setDropNote('Drop a field here, not a whole table.');
    return false;
  };

  /** A table's columns (one that names none shows every field of its table), or a matrix's rows, columns or values. */
  const list = (key: List): any[] =>
    sel()?.[key]?.length ? sel()[key] : isType('table') && sel().sourceId ? store.defaultColumns(sel().sourceId) : [];
  const patchAt = (key: List, i: number, patch: object) => setClean(key, list(key).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const moveIn = (key: List) => (from: number, to: number) => {
    const l = [...list(key)];
    l.splice(to, 0, ...l.splice(from, 1));
    setClean(key, l);
  };

  // --- Field wells ---
  const where = (ref: string) => store.describeRef(sel().sourceId, ref);
  const numeric = (ref: string) => store.isNumericRef(sel().sourceId, ref);
  const isDate = (ref?: string) => store.refType(sel().sourceId, ref) === 'datetime';
  const partName = (p?: string) => (p ? ` (${p[0].toUpperCase()}${p.slice(1)})` : '');

  /** The pill of field `ref` in `slot`. A table's or matrix's measure is described by its table. */
  const pill = (slot: Slot, ref: string, label: string, sections: MenuSection[] = [], more?: Partial<WellItem>): WellItem => ({
    key: ref,
    label,
    title: isMeasureRef(ref) && (slot === 'column' || slot === 'value') ? `${sel().sourceId} measure` : `${where(ref).table}.${where(ref).field}`,
    drag: where(ref),
    onRemove: () => store.clearField(sel(), slot, ref),
    sections,
    ...more
  });

  /** A category field (axis, legend, slicer, matrix header): a date can be grouped by month, quarter or year. */
  const category = (slot: Slot, ref: string, part: DatePart | undefined, setPart: (p?: DatePart) => void) =>
    pill(slot, ref, where(ref).field + partName(part), isDate(ref) ? [dateSection(part, setPart)] : []);

  /** A value's name: a measure's own, or its field's summary. */
  const valueName = (ref: string, agg: AggregationMethod, showAs?: ShowAs, c?: Compare) =>
    isMeasureRef(ref) ? valueLabel(measureName(ref), showAs, c) : summaryLabel(where(ref).field, agg, showAs, c);
  /** The Summarize section of a value, which a measure (a summary already) doesn't have. */
  const summarize = (ref: string, agg: AggregationMethod | undefined, onPick: (m?: AggregationMethod) => void, opts?: { allowNone?: boolean; values?: boolean }) =>
    isMeasureRef(ref) ? [] : [summarizeSection(agg, numeric(ref), onPick, opts)];

  /** A chart's category field: axis, legend or details. */
  const plain = (slot: 'x' | 'group' | 'detail'): WellItem[] => {
    const ref = sel().mapping?.[slot];
    return ref ? [category(slot, ref, sel().dateParts?.[slot], (p) => setClean('dateParts', { ...sel().dateParts, [slot]: p }))] : [];
  };

  // a value along a chart's axis: run up, or compared with the same category of another period
  const alongAxis = (s: ValueSummary | undefined, patch: (p: ValueSummary) => void) => [
    showAsSection(s?.showAs, (v) => patch({ showAs: v }), true),
    ...compareSections(s?.compare, (c) => patch({ compare: c }), false)
  ];

  const lineValue = (): WellItem[] => {
    const ref = sel().mapping?.line;
    const s = sel().lineSummary;
    const agg = s?.aggregate || 'sum';
    const patch = (p: ValueSummary) => setClean('lineSummary', { ...s, ...p });
    return ref
      ? [pill('line', ref, valueName(ref, agg, s?.showAs, s?.compare), [...summarize(ref, agg, (m) => patch({ aggregate: m === 'sum' ? undefined : m })), ...alongAxis(s, patch)], {
          drag: { ...where(ref), aggregate: agg }
        })]
      : [];
  };

  const chartValue = (): WellItem[] => {
    const ref = sel().mapping?.y;
    if (!ref) return [];
    const agg = sel().summary?.aggregate || 'sum';
    const showAs = sel().summary?.showAs;
    const setSummary = (patch: object) => setClean('summary', { ...sel().summary, ...patch });
    return [pill('y', ref, valueName(ref, agg, showAs, sel().summary?.compare), [
      ...summarize(ref, agg, (m) => setSummary({ aggregate: m === 'sum' ? undefined : m })),
      // along an axis a value can run up or compare periods; other charts show shares
      ...(chartIs('bar', 'hbar', 'line', 'area', 'combo') ? alongAxis(sel().summary, setSummary) : chartIs('gauge') ? [] : [showAsSection(showAs, (v) => setSummary({ showAs: v }))])
    ], { drag: { ...where(ref), aggregate: agg, showAs } })];
  };

  /** A scatter axis: the field per row, or with Details summarized over each point's rows. */
  const scatterValue = (slot: 'x' | 'y'): WellItem[] => {
    const ref = sel().mapping?.[slot];
    if (!ref) return [];
    const key = slot === 'x' ? 'xSummary' : 'summary';
    const agg = sel()[key]?.aggregate || 'sum';
    const sections = sel().mapping?.detail ? summarize(ref, agg, setAgg(key)) : [];
    return [pill(slot, ref, isMeasureRef(ref) || sections.length ? valueName(ref, agg) : where(ref).field, sections, { drag: { ...where(ref), aggregate: agg } })];
  };

  const cardValue = (): WellItem[] => {
    const ref = sel().aggregation?.field;
    const agg = sel().aggregation?.method || 'sum';
    return ref
      ? [pill('field', ref, valueName(ref, agg) + (sel().compare ? ` · ${store.compareLabel(sel(), sel().compare)}` : ''), [
          ...summarize(ref, agg, (m) => setIn('aggregation', 'method', m), { values: true }),
          formatSection(sel().format, (f) => set('format', f)),
          unitsSection(sel().units, (u) => set('units', u)),
          ...compareSections(sel().compare, (c) => set('compare', c))
        ], { drag: { ...where(ref), aggregate: agg } })]
      : [];
  };

  const tableItems = (): WellItem[] =>
    list('columns').map((c: TableColumn, i: number) => {
      const patch = (p: Partial<TableColumn>) => patchAt('columns', i, p);
      const showAs = showAsSection(c.showAs, (v) => patch({ showAs: v }));
      const formats = [condSection(c.cond, (v) => patch({ cond: v })), formatSection(c.format, (f) => patch({ format: f })), unitsSection(c.units, (u) => patch({ units: u }))];
      const onRename = (label: string) => patch({ label });
      // a measure column is always a summarized value, so no Summarize or date grouping
      return isMeasureRef(c.field)
        ? pill('column', c.field, c.label !== c.field ? c.label : valueName(c.field, 'sum', c.showAs), [showAs, ...formats], {
            onRename,
            renameValue: c.label === c.field ? measureName(c.field) : c.label
          })
        : pill('column', c.field, c.aggregate && c.label === c.field ? summaryLabel(where(c.field).field, c.aggregate, c.showAs) : c.label + partName(c.datePart), [
            ...(isDate(c.field) && !c.aggregate ? [dateSection(c.datePart, (p) => patch({ datePart: p }))] : []),
            summarizeSection(c.aggregate, numeric(c.field), (m) => patch({ aggregate: m, showAs: m ? c.showAs : undefined }), { allowNone: true, values: true }),
            ...(c.aggregate ? [showAs] : []),
            ...(numeric(c.field) || c.aggregate ? formats : [])
          ], { onRename, renameValue: c.label });
    });

  // --- Matrix wells: rows and columns are headers, values are summarized ---
  const matrixFields = (key: 'rows' | 'columns', slot: 'row' | 'col'): WellItem[] =>
    list(key).map((f: MatrixField, i: number) => category(slot, f.field, f.datePart, (p) => patchAt(key, i, { datePart: p })));
  const matrixValues = (): WellItem[] =>
    list('values').map((v: MatrixValue, i: number) => {
      const patch = (p: Partial<MatrixValue>) => patchAt('values', i, p);
      const name = valueName(v.field, v.aggregate ?? 'sum', v.showAs, v.compare);
      return pill('value', v.field, v.label ?? name, [
        ...summarize(v.field, v.aggregate ?? 'sum', (m) => patch({ aggregate: m === 'sum' ? undefined : m }), { values: true }),
        showAsSection(v.showAs, (s) => patch({ showAs: s }), true),
        ...compareSections(v.compare, (c) => patch({ compare: c }), false),
        condSection(v.cond, (c) => patch({ cond: c })),
        formatSection(v.format, (f) => patch({ format: f })),
        unitsSection(v.units, (u) => patch({ units: u }))
      ], { onRename: (label) => patch({ label: label === name ? undefined : label }), renameValue: v.label ?? name });
    });

  return (
    <>
      <div class="d-visual-matrix">
        <For each={GALLERY}>
          {(item) => {
            if (!item) return <div class="d-vis-break" />;
            const [title, type, chartType, icon] = item;
            return (
              <button
                class={`d-vis-icon ${isType(type, chartType) ? 'active' : ''}`}
                title={sel() ? `Change to ${title}` : `Add ${title}`}
                onClick={() => (sel() ? store.transformSelectedVisual : store.createElement)(type, chartType)}
              >
                <svg viewBox="0 0 24 24">{icon}</svg>
              </button>
            );
          }}
        </For>
      </div>

      <Show when={sel()} fallback={<ThemeEditor />}>
        <div class="d-subtab-strip">
          <For each={['Build', 'Format']}>
            {(t) => (
              <button class={`d-subtab-btn ${store.visualTab() === t.toLowerCase() ? 'active' : ''}`} onClick={() => store.setVisualTab(t.toLowerCase() as 'build' | 'format')}>
                {t}
              </button>
            )}
          </For>
        </div>

        <Show when={store.visualTab() === 'build'}>
          <div class="d-wells-container">
            <Show when={store.dropNote()}>
              <div class="d-drop-note">{store.dropNote()}</div>
            </Show>
            <Show when={isType('chart')}>
              <Show when={!chartIs('gauge')}>
                <FieldWell
                  label={chartIs('pie', 'donut', 'treemap') ? 'Category' : chartIs('radar') ? 'Axes' : chartIs('sankey') ? 'Source node' : 'X-axis'}
                  items={chartIs('scatter') ? scatterValue('x') : plain('x')}
                  onDropField={take('x')}
                />
              </Show>
              <FieldWell
                label={chartIs('pie', 'donut', 'treemap', 'gauge') ? 'Values' : chartIs('radar', 'sankey') ? 'Value' : chartIs('combo') ? 'Column values' : 'Y-axis'}
                items={chartIs('scatter') ? scatterValue('y') : chartValue()}
                onDropField={take('y')}
              />
              <Show when={chartIs('combo')}>
                <FieldWell label="Line values" items={lineValue()} onDropField={take('line')} />
              </Show>
              <Show when={!chartIs('pie', 'donut', 'gauge')}>
                <FieldWell
                  label={chartIs('sankey') ? 'Target node' : chartIs('treemap') ? 'Parent group' : chartIs('combo') ? 'Column legend' : 'Legend'}
                  items={plain('group')}
                  onDropField={take('group')}
                />
              </Show>
              <Show when={chartIs('scatter')}>
                <FieldWell label="Details" items={plain('detail')} onDropField={take('detail')} />
              </Show>
            </Show>

            <Show when={isType('card')}>
              <FieldWell label="Fields" items={cardValue()} onDropField={take('field')} />
            </Show>

            <Show when={isType('slicer')}>
              <FieldWell
                label="Field"
                items={sel().field ? [category('field', sel().field, sel().datePart, (p) => update({ datePart: p, selection: undefined }))] : []}
                onDropField={take('field')}
              />
            </Show>

            <Show when={isType('table')}>
              <FieldWell label="Columns" items={tableItems()} onDropField={take('column')} multiple onReorder={moveIn('columns')} />
            </Show>

            <Show when={isType('matrix')}>
              <FieldWell label="Rows" items={matrixFields('rows', 'row')} onDropField={take('row')} multiple onReorder={moveIn('rows')} />
              <FieldWell label="Columns" items={matrixFields('columns', 'col')} onDropField={take('col')} multiple onReorder={moveIn('columns')} />
              <FieldWell label="Values" items={matrixValues()} onDropField={take('value')} multiple onReorder={moveIn('values')} />
            </Show>

            <Show when={isType('markdown')}>
              <div class="d-field-well">
                <div class="d-well-header"><label>Text</label></div>
                <div class={`d-well-box d-droppable ${over() ? 'over' : ''}`} onDragOver={textDrop.onDragOver} onDragLeave={textDrop.onDragLeave} onDrop={textDrop.onDrop}>
                  <textarea class="d-textarea d-code" rows={10} spellcheck={false} value={sel().content || ''} onInput={(e) => set('content', e.currentTarget.value)} />
                </div>
              </div>
              <TemplateSlots element={sel()} set={set} />
            </Show>
          </div>
        </Show>

        <Show when={store.visualTab() === 'format'}>
          <FormatPane />
        </Show>
      </Show>
    </>
  );
};
