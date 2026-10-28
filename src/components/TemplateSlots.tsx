import { Component, For, Show, createMemo } from 'solid-js';
import { store } from '../runtime/store';
import { templateVariables } from '../runtime/template';
import { DroppedField } from '../runtime/dnd';
import { summaryLabel } from '../runtime/charts';
import { isMeasureRef, measureName } from '../runtime/measures';
import { DataBinding } from '../types/model';
import { FieldWell, MenuSection, WellItem, compareSections, formatSection, summarizeSection, unitsSection } from './FieldWell';

/** A new binding for a dropped field: numbers are summed, other fields counted; a whole table is counted (its menu switches to all rows, for {{#name}} lists). */
export function bindingFor({ table, field }: DroppedField): DataBinding {
  if (!field) return { table, aggregate: 'count' };
  if (isMeasureRef(field)) return { table, field };
  return store.isNumericRef(table, field) ? { table, field, aggregate: 'sum', format: 'number' } : { table, field, aggregate: 'count' };
}

/** A template variable name for a dropped field that doesn't clash with the text box's other variables or the tables. */
export function variableName(element: any, f: DroppedField): string {
  const base = (f.field ? measureName(f.field) : f.table).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') || 'value';
  const used = templateVariables(element.content || '').names;
  const taken = (n: string) => used.includes(n) || !!store.doc.sources[n] || ['rows', 'title', 'page'].includes(n);
  let name = base;
  for (let i = 2; taken(name); i++) name = `${base}_${i}`;
  return name;
}

/**
 * Reads the text box's template and shows each variable it uses as a field well: drop a field or table from
 * the Data pane on it, then summarize and format it from the field's menu.
 */
export const TemplateSlots: Component<{ element: any; set: (prop: string, val: any) => void }> = (props) => {
  const parsed = createMemo(() => templateVariables(props.element.content || ''));

  const bind = (name: string, binding: DataBinding) => props.set('bindings', { ...(props.element.bindings || {}), [name]: binding });
  const clear = (name: string) => {
    const { [name]: _, ...next } = props.element.bindings || {};
    props.set('bindings', Object.keys(next).length ? next : undefined);
  };

  const items = (name: string): WellItem[] => {
    const b: DataBinding | undefined = props.element.bindings?.[name];
    if (!b) return [];
    const patch = (p: Partial<DataBinding>) => bind(name, JSON.parse(JSON.stringify({ ...b, ...p })));
    const format = formatSection(b.format, (f) => patch({ format: f }));
    const units = unitsSection(b.units, (u) => patch({ units: u }));
    // a single value can show its comparison instead ("+6.4%"), against another value of the text box's filters
    const compare = compareSections(b.compare, (c) => patch({ compare: c }));
    const item = { key: name, drag: { table: b.table, field: b.field }, onRemove: () => clear(name) };
    const vs = b.compare ? ` · ${store.compareLabel(props.element, b.compare)}` : '';
    if (isMeasureRef(b.field)) return [{ ...item, label: measureName(b.field) + vs, title: `${b.table} measure`, sections: [format, units, ...compare] }];
    const sections: MenuSection[] = b.field
      ? [summarizeSection(b.aggregate, store.isNumericRef(b.table, b.field), (m) => patch({ aggregate: m }), { allowNone: true, values: true })]
      : [{
          title: 'Summarize',
          options: [
            { label: 'All rows', checked: !b.aggregate, onSelect: () => patch({ aggregate: undefined }) },
            { label: 'Count', checked: b.aggregate === 'count', onSelect: () => patch({ aggregate: 'count' }) }
          ]
        }];
    if (b.aggregate) sections.push(format, units, ...compare);
    return [{
      ...item,
      label: (b.aggregate ? summaryLabel(b.field || b.table, b.aggregate) : b.field || `${b.table} (rows)`) + (b.aggregate ? vs : ''),
      title: b.field ? `${b.table}.${b.field}` : b.table,
      sections
    }];
  };

  return (
    <div class="d-slots">
      <Show when={parsed().names.length} fallback={<div class="d-hint">Drop a field on the text to show its value.</div>}>
        <For each={parsed().names}>
          {(name) => {
            const source = () => store.variableSource(props.element, name);
            return (
              <FieldWell label={<code>{name}</code>} items={items(name)} onDropField={(f) => bind(name, bindingFor(f))} warn={source().kind === 'unbound'}>
                {source().kind === 'auto' ? <span class="d-well-auto">{source().label}</span> : undefined}
              </FieldWell>
            );
          }}
        </For>
      </Show>
      <Show when={parsed().error}>
        <div class="d-form-error">{parsed().error}</div>
      </Show>
    </div>
  );
};
