import { Component, For, Show, createSignal } from 'solid-js';
import { MenuEntry, openMenu, openMenuBelow } from './ContextMenu';
import { store } from '../runtime/store';
import { dragField } from '../runtime/dnd';
import { isNumericType } from '../types/model';
import { measureRef } from '../runtime/measures';

/** Tables and their fields. Fields are dragged into visuals; a right-click (or a table's ⋯) offers what can be done with one. */
export const DataPane: Component<{
  onGetData: () => void;
  onEditData: (id: string) => void;
  onReplaceData: (id: string) => void;
  /** A new measure on a table (from a field), or (with a name) edit that measure. */
  onMeasure: (table: string, name?: string, field?: string) => void;
}> = (props) => {
  const [search, setSearch] = createSignal('');
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const tableMenu = (id: string): MenuEntry[] => [
    { label: 'Create measure…', onSelect: () => props.onMeasure(id) },
    '-',
    { label: 'Edit data…', onSelect: () => props.onEditData(id) },
    { label: 'Replace data…', onSelect: () => props.onReplaceData(id) },
    '-',
    { label: 'Delete table', danger: true, onSelect: () => deleteTable(id) }
  ];
  const fieldMenu = (id: string, field: string): MenuEntry[] => [
    { label: 'Create measure…', onSelect: () => props.onMeasure(id, undefined, field) },
    '-',
    { label: 'Edit data…', onSelect: () => props.onEditData(id) }
  ];
  const measureMenu = (id: string, name: string): MenuEntry[] => [
    { label: 'Edit measure…', onSelect: () => props.onMeasure(id, name) },
    { label: 'Delete measure', danger: true, onSelect: () => deleteMeasure(id, name) }
  ];
  const moreButton = (items: () => MenuEntry[], title: string) => (
    <button class="d-table-more" title={title} onClick={(e) => openMenuBelow(e, items())}>
      ⋯
    </button>
  );
  const deleteMeasure = (table: string, name: string) => {
    if (!confirm(`Delete measure "${name}"? Visuals that use it lose it.`)) return;
    const err = store.deleteMeasure(table, name);
    if (err) alert(`Can't delete "${name}": ${err}`);
  };
  const matching = <T extends { name: string }>(items: T[]) => {
    const q = search().toLowerCase().trim();
    return items.filter(x => !q || x.name.toLowerCase().includes(q));
  };

  /** "table.field" ends related to a field. */
  const links = (table: string, field: string) =>
    store.relationshipsOf(table).filter(r => r.mine.field === field).map(r => `${r.other.table}.${r.other.field}`);

  const deleteTable = (id: string) => {
    const n = store.usagesOf(id).length;
    if (confirm(`Delete table "${id}"?${n ? ` ${n} visual${n > 1 ? 's use' : ' uses'} it and will lose its fields.` : ''}`)) store.removeDataSource(id);
  };

  return (
    <>
      <div class="d-pane-search">
        <input type="search" placeholder="Search" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
      </div>

      <div class="d-tables-tree">
        <For each={Object.keys(store.doc.sources)}>
          {(id) => (
            <div class="d-table-node">
              <div
                class="d-table-header"
                draggable={true}
                onDragStart={(e) => dragField(e, { table: id })}
                onClick={() => setCollapsed({ ...collapsed(), [id]: !collapsed()[id] })}
                onDblClick={() => props.onEditData(id)}
                onContextMenu={(e) => openMenu(e, tableMenu(id))}
              >
                <span class={`d-chevron ${collapsed()[id] ? '' : 'open'}`}>›</span>
                <span class="d-table-icon">▦</span>
                <span class="d-table-name" title={id}>{id}</span>
                {moreButton(() => tableMenu(id), 'Table options')}
              </div>

              <Show when={!collapsed()[id]}>
                <div class="d-columns-list">
                  <For each={matching(store.doc.sources[id]?.structure || [])}>
                    {(col) => (
                      <div class="d-field-item" draggable={true} onDragStart={(e) => dragField(e, { table: id, field: col.name })} onContextMenu={(e) => openMenu(e, fieldMenu(id, col.name))} title={`${col.name} · ${col.type}`}>
                        <span class="d-field-glyph">{isNumericType(col.type) ? '∑' : col.type === 'datetime' ? '◷' : ''}</span>
                        <span class="d-field-name">{col.name}</span>
                        <Show when={links(id, col.name).length}>
                          <span class="d-link" title={`Related to ${links(id, col.name).join(', ')}`}>⟷</span>
                        </Show>
                      </div>
                    )}
                  </For>
                  <For each={matching(store.measuresOf(id))}>
                    {(m) => (
                      <div
                        class="d-field-item d-measure-item"
                        draggable={true}
                        onDragStart={(e) => dragField(e, { table: id, field: measureRef(m.name) })}
                        onDblClick={() => props.onMeasure(id, m.name)}
                        onContextMenu={(e) => openMenu(e, measureMenu(id, m.name))}
                        title={`${m.name} · measure`}
                      >
                        <span class="d-field-glyph d-measure-glyph">⊞</span>
                        <span class="d-field-name">{m.name}</span>
                        {moreButton(() => measureMenu(id, m.name), 'Measure options')}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="d-data-pane-footer">
        <button class="d-get-data-btn" onClick={props.onGetData}>+ Get data</button>
      </div>
    </>
  );
};
