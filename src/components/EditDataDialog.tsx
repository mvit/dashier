import { Component, For, JSX, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { Modal } from './Modal';
import { DashRelationship, FieldType, isNumericType } from '../types/model';
import { DataGrid, PROFILE } from './DataGrid';
import { frameRows } from '../runtime/frames';
import { payloadSize } from '../runtime/payloads';

type Tab = 'data' | 'relationships' | 'usage';

const KIND_ICONS: Record<string, string> = { chart: '▥', card: '▭', table: '▦', markdown: 'T', slicer: '⧩' };

/** Cardinality as the editor shows it, from this table to the other: many to one, one to one, one to many, many to many. */
type Card = '*:1' | '1:1' | '1:*' | '*:*';
const CARDS: [Card, string][] = [['*:1', 'Many to one'], ['1:1', 'One to one'], ['1:*', 'One to many'], ['*:*', 'Many to many']];
/** A relationship being edited, seen from this table (`index` −1: a new one). */
type Draft = { index: number; mine: string; table: string; field: string; card: Card; both: boolean };

/**
 * A relationship as a card: this table's column, the cardinality, the other table's column; under them the cross
 * filter direction, then `children` (a new one's buttons go in a footer instead).
 */
const RelCard: Component<{
  table: string;
  d: Draft;
  flow: string;
  draft?: boolean;
  set: (patch: Partial<Draft>) => void;
  children: JSX.Element;
}> = (props) => {
  const select = (cls: string, title: string, value: string, options: string[], empty: string, onPick: (v: string) => void, label = (o: string) => o) => (
    <select class={cls} title={title} onChange={(e) => onPick(e.currentTarget.value)}>
      <Show when={!value}>
        <option value="">{empty}</option>
      </Show>
      <For each={options}>{(o) => <option value={o} selected={o === value}>{label(o)}</option>}</For>
    </select>
  );
  const fields = (t: string) => store.fieldsOf(t).map(c => c.name);
  return (
    <div class={`d-rel ${props.draft ? 'd-rel-draft d-rel-form' : ''}`}>
      <div class="d-rel-grid">
        <span class="d-rel-table-name">▦ {props.table}</span>
        <span />
        {select('d-rel-table d-rel-table-select', 'Other table', props.d.table, Object.keys(store.doc.sources).filter(t => t !== props.table), 'Choose a table…', (table) => props.set({ table }), (t) => `▦ ${t}`)}
        {select('d-rel-select d-rel-mine', `Column of ${props.table}`, props.d.mine, fields(props.table), 'Choose a column…', (mine) => props.set({ mine }))}
        {select('d-rel-card', 'Cardinality: read from the data, as Power BI does', props.d.card, CARDS.map(c => c[0]), '', (card) => props.set({ card: card as Card }), (c) => CARDS.find(x => x[0] === c)![1])}
        {select('d-rel-select d-rel-field', 'Column of the other table', props.d.field, fields(props.d.table), 'Choose a column…', (field) => props.set({ field }))}
      </div>
      <div class="d-rel-bottom">
        <select class="d-rel-select d-rel-dir" title="Cross filter direction" disabled={props.d.card === '1:1'} onChange={(e) => props.set({ both: e.currentTarget.value === 'both' })}>
          <option value="single" selected={!props.d.both}>{props.d.card === '1:1' ? 'Filters both ways' : props.flow}</option>
          <option value="both" selected={props.d.both}>Filters both ways</option>
        </select>
        <Show when={!props.draft}>{props.children}</Show>
      </div>
      <Show when={props.draft}>
        <div class="d-rel-foot">{props.children}</div>
      </Show>
    </div>
  );
};

/**
 * Edit Data: rename the table and its columns, change column types, edit the connections between this
 * table's fields and other tables' fields, and see which visuals use it.
 */
export const EditDataDialog: Component<{ id: string; onClose: () => void; onReplace: () => void }> = (props) => {
  const [id, setId] = createSignal(props.id); // follows renames
  const [tab, setTab] = createSignal<Tab>('data');
  const [error, setError] = createSignal('');
  const src = () => store.doc.sources[id()];
  const frame = () => store.tableFrame(id());
  // the grid shows (and profiles) the first rows as objects; the table itself stays in columns
  const gridRows = createMemo(() => frameRows(frame(), 0, PROFILE));
  const usages = () => store.usagesOf(id());
  const rels = () => store.relationshipsOf(id());

  /** Visuals using the table, grouped by page. */
  const usageByPage = createMemo(() => {
    const pages = new Map<string, ReturnType<typeof usages>>();
    for (const u of usages()) pages.set(u.page.id, [...(pages.get(u.page.id) ?? []), u]);
    return [...pages.values()];
  });

  /** Shows a store error (or clears it); true when there was none. */
  const ok = (err: string | null) => (setError(err || ''), !err);

  const rename = (input: HTMLInputElement) => {
    if (ok(store.renameSource(id(), input.value))) setId(input.value.trim());
    else input.value = id();
  };

  // --- relationships ---
  const others = () => Object.keys(store.doc.sources).filter(t => t !== id());
  const [adding, setAdding] = createSignal<Draft | null>(null);

  /** Share of this table's distinct values that also occur in the other table's field. */
  const matchRate = (mine: string, other: { table: string; field: string }) => {
    const a = new Set(store.distinct(id(), mine));
    const b = new Set(store.distinct(other.table, other.field));
    return a.size ? Math.round(([...a].filter(v => b.has(v)).length / a.size) * 100) : null;
  };

  /** What the data says, as Power BI tells it: unique on both sides 1:1, on the other only *:1, on this one 1:*, else *:*. */
  const detect = (mine: string, table: string, field: string): Card => {
    const a = !store.repeats(id(), mine);
    const b = !store.repeats(table, field);
    return a && b ? '1:1' : b ? '*:1' : a ? '1:*' : '*:*';
  };

  /** A stored relationship as the editor sees it from this table. */
  const draftOf = (index: number): Draft => {
    const r = store.doc.relationships![index];
    const [me, other] = r.from.table === id() ? [r.from, r.to] : [r.to, r.from];
    const card: Card = r.cardinality === 'one-to-one' ? '1:1' : r.cardinality === 'many-to-many' ? '*:*' : r.from.table === id() ? '*:1' : '1:*';
    return { index, mine: me.field, table: other.table, field: other.field, card, both: r.crossFilter === 'both' };
  };

  /** The relationship a draft stands for: the many side is `from`. */
  const relOf = (d: Draft): DashRelationship => {
    const me = { table: id(), field: d.mine };
    const other = { table: d.table, field: d.field };
    return {
      ...(d.card === '1:*' ? { from: other, to: me } : { from: me, to: other }),
      ...(d.card === '1:1' ? { cardinality: 'one-to-one' as const } : d.card === '*:*' ? { cardinality: 'many-to-many' as const } : {}),
      ...(d.both && d.card !== '1:1' ? { crossFilter: 'both' as const } : {})
    };
  };

  /** Which table filters which in one direction: the one side, or for *:* the other table. */
  const flow = (d: Draft) => (d.card === '1:*' ? `${id()} filters ${d.table || '…'}` : `${d.table || '…'} filters ${id()}`);

  /** The one sides a draft claims whose values repeat (each row then matches their first row only). */
  const repeated = (d: Draft) =>
    [...(d.card === '1:*' || d.card === '1:1' ? [[id(), d.mine]] : []), ...(d.card === '*:1' || d.card === '1:1' ? [[d.table, d.field]] : [])]
      .filter(([t, f]) => f && store.repeats(t, f))
      .map(([t, f]) => `${t}.${f}`);

  /**
   * A relationship changed: picking a column (or table) reads the cardinality from the data again. A saved one is
   * saved at once (a rejected change shows why and keeps the old), a new one waits for Create.
   */
  const change = (d0: Draft, patch: Partial<Draft>) => {
    const d = { ...d0, ...patch };
    if (patch.table) d.field = store.fieldsOf(d.table).find(c => c.name === d.mine)?.name ?? '';
    if ((patch.mine || patch.field || patch.table) && d.mine && d.field) d.card = detect(d.mine, d.table, d.field);
    d.index < 0 ? setAdding(d) : ok(store.saveRelationship(relOf(d), d.index));
  };

  /** Same-named columns in other tables that aren't connected yet. */
  const suggestions = () => {
    const linked = new Set(rels().map(r => `${r.mine.field}|${r.other.table}|${r.other.field}`));
    return others().flatMap(table =>
      store.fieldsOf(table).flatMap(c => {
        const mine = store.fieldsOf(id()).find(m => m.name.toLowerCase() === c.name.toLowerCase());
        return mine && !linked.has(`${mine.name}|${table}|${c.name}`) && isNumericType(mine.type) === isNumericType(c.type)
          ? [{ mine: mine.name, table, field: c.name }]
          : [];
      })
    );
  };

  const tabBtn = (t: Tab, label: string, count?: number) => (
    <button class={`d-dtab ${tab() === t ? 'active' : ''}`} onClick={() => setTab(t)}>
      {label}
      {count != null && <span class="d-dtab-count">{count}</span>}
    </button>
  );

  return (
    <Modal class="d-editdata" onClose={props.onClose}>
      <div class="modal-header">
        <div class="d-editdata-title">
          <span class="d-editdata-icon">▦</span>
          <div>
            <input
              class="d-title-input"
              value={id()}
              title="Rename table"
              spellcheck={false}
              onChange={(e) => rename(e.currentTarget)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <div class="d-editdata-meta">
              {frame().length.toLocaleString()} rows · {src()?.structure.length ?? 0} columns ·{' '}
              {src() ? (payloadSize(src().payload) / 1024).toFixed(1) : 0} KB stored
            </div>
          </div>
        </div>
        <div class="d-editdata-actions">
          <button class="btn-secondary d-replace-btn" title="Load an updated CSV or JSON file into this table" onClick={props.onReplace}>
            Replace data…
          </button>
          <button class="btn-close-modal" title="Close (Esc)" onClick={props.onClose}>×</button>
        </div>
      </div>

      <div class="d-dtabs d-dialog-tabs">
        {tabBtn('data', 'Data')}
        {tabBtn('relationships', 'Relationships', rels().length)}
        {tabBtn('usage', 'Used by', usages().length)}
      </div>

      <Show when={error()}>
        <div class="d-form-error d-editdata-error">{error()}</div>
      </Show>

      <Show when={src()}>
        <Show when={tab() === 'data'}>
          <div class="d-editdata-hint">
            Click a column name to rename it everywhere it's used. Click a type badge to change how its values are read; the
            stored data is unchanged, and values that don't fit the type show as blank.
          </div>
          <div class="modal-body d-editdata-grid">
            <DataGrid
              columns={src().structure}
              rows={gridRows()}
              total={frame().length}
              limit={200}
              onType={(col, t) => store.setColumnType(id(), col, t as FieldType)}
              onSortBy={(col, by) => store.setSortBy(id(), col, by)}
              onRename={async (column, input) => {
                if (!ok(await store.renameColumn(id(), column, input.value))) input.value = column;
              }}
            />
          </div>
        </Show>

        <Show when={tab() === 'relationships'}>
          <div class="modal-body d-rels-body">
            <p class="d-editdata-lead">
              A relationship links a column of <b>{id()}</b> to a column of another table. The one side (unique values, a
              dimension) filters the many side (its facts), through further relationships too; a visual can use the fields and
              measures of any connected table.
            </p>
            <Show when={rels().length || adding()} fallback={<div class="d-empty-state">No relationships yet.</div>}>
              <div class="d-rels">
                <For each={rels()}>
                  {(r) => {
                    const d = () => draftOf(r.index);
                    const rate = () => matchRate(r.mine.field, r.other);
                    return (
                      <RelCard table={id()} d={d()} flow={flow(d())} set={(patch) => change(d(), patch)}>
                        <span class="d-rel-meta">
                          <Show when={repeated(d()).length}>
                            <span class="d-badge warn" title="A one side should have unique values: rows match its first row only">{repeated(d())[0]} repeats values</span>
                          </Show>
                          <Show when={store.isNumericRef(id(), r.mine.field) !== store.isNumericRef(r.other.table, r.other.field)}>
                            <span class="d-badge warn">types differ</span>
                          </Show>
                          <Show when={rate() != null}>
                            <span class={`d-badge ${rate()! < 50 ? 'warn' : 'ok'}`}>{rate()}% match</span>
                          </Show>
                        </span>
                        <button
                          class="d-rel-x"
                          title="Delete relationship"
                          onClick={() => {
                            const n = store.linkedUsages(r.index).length;
                            (!n || confirm(`${n} visual${n > 1 ? 's use' : ' uses'} fields through this relationship and will lose them. Delete it?`)) && store.removeRelationship(r.index);
                          }}
                        >
                          ×
                        </button>
                      </RelCard>
                    );
                  }}
                </For>
                <Show when={adding()}>
                  {(d) => (
                    <RelCard table={id()} d={d()} flow={flow(d())} draft set={(patch) => change(d(), patch)}>
                      <button class="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
                      <button class="btn-primary" disabled={!d().mine || !d().table || !d().field} onClick={() => ok(store.saveRelationship(relOf(d()))) && setAdding(null)}>
                        Create
                      </button>
                    </RelCard>
                  )}
                </Show>
              </div>
            </Show>
            <Show when={!adding()}>
              {others().length ? (
                <button class="btn-secondary d-new-rel" onClick={() => setAdding({ index: -1, mine: '', table: '', field: '', card: '*:1', both: false })}>+ New relationship</button>
              ) : (
                <p class="d-hint">Add another table (Get data) to relate it to this one.</p>
              )}
            </Show>
            <Show when={suggestions().length}>
              <div class="d-suggests">
                <span class="d-suggests-label">Suggested</span>
                <For each={suggestions()}>
                  {(x) => (
                    <button class="d-suggest" title="Create this relationship (its cardinality read from the data)" onClick={() => ok(store.saveRelationship(relOf({ index: -1, ...x, card: detect(x.mine, x.table, x.field), both: false })))}>
                      {x.mine} ⟷ {x.table}.{x.field}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'usage'}>
          <div class="modal-body">
            <Show when={usages().length} fallback={<div class="d-empty-state">No visuals use this table yet.</div>}>
              <For each={usageByPage()}>
                {(group) => (
                  <div class="d-usage-group">
                    <div class="d-usage-page">{group[0].page.title}</div>
                    <div class="d-usages">
                      <For each={group}>
                        {(u) => (
                          <button class="d-usage" title="Go to this visual" onClick={() => (store.selectElement(u.page.id, u.element.id), props.onClose())}>
                            <span class="d-usage-icon">{KIND_ICONS[u.element.type] ?? '▭'}</span>
                            <span class="d-usage-main">
                              <b>{u.element.title || u.element.type}</b>
                              <span class="d-usage-fields">
                                <For each={u.fields}>{(f) => <span class="d-usage-field">{f}</span>}</For>
                              </span>
                            </span>
                            <span class="d-usage-go">Go to →</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </Show>

      <div class="modal-footer">
        <button class="btn-primary" onClick={props.onClose}>Done</button>
      </div>
    </Modal>
  );
};
