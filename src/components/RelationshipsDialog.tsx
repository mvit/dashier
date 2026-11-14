import { Component, For, Show, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { Modal } from './Modal';
import { Popover } from './ContextMenu';
import { Err, Select } from './ui';
import { DashRelationship as Rel } from '../types/model';
import { plural } from '../runtime/data';

const CARDS: [Rel['cardinality'], string][] = [[undefined, 'Many to one'], ['one-to-one', 'One to one'], ['many-to-many', 'Many to many']];
const key = (e: Rel['from']) => `${e.table}.${e.field}`;
/** A column of a table: the table's name, then the column's. */
const End = (p: { e: Rel['from'] }) => (
  <span class="d-rel-end">
    <b>{p.e.table}</b>.{p.e.field}
  </span>
);

/**
 * The model's relationships, a row each: its two columns, how many on each side and how many match. A row opens its
 * settings in a popover (as a field's menu opens), saved as they change. Same-named columns not yet related are
 * suggested on top; `start` (two tables a visual needs connected) opens a new relationship between them.
 */
export const RelationshipsDialog: Component<{ start?: [string, string]; onClose: () => void }> = (props) => {
  const [error, setError] = createSignal('');
  const [dismissed, setDismissed] = createSignal<string[]>([]);
  // the row whose settings are open (-1: the new one), and where its popover hangs
  const [open, setOpen] = createSignal<{ i: number; at: HTMLElement } | null>(null);
  const rels = () => store.doc.relationships ?? [];
  const tables = () => Object.keys(store.doc.sources);
  const names = (t: string) => store.fieldsOf(t).map((c) => c.name);

  /** The many side's values the one side has: how many, of how many. */
  const matched = (r: Rel) => {
    const to = new Set(store.distinct(r.to.table, r.to.field)), from = store.distinct(r.from.table, r.from.field);
    return [from.filter((v) => to.has(v)).length, from.length];
  };
  const pct = (r: Rel) => ((m, n) => (n ? Math.round((m / n) * 100) : 0))(...(matched(r) as [number, number]));
  /** As Power BI reads it from the data: the side with unique values is the one side (`to`); both, one to one. */
  const detect = (r: Rel): Rel => {
    if (!r.from.field || !r.to.field) return r;
    const a = !store.repeats(r.from.table, r.from.field), b = !store.repeats(r.to.table, r.to.field);
    const turned = a && !b ? { ...r, from: r.to, to: r.from } : r;
    return { ...turned, cardinality: a && b ? 'one-to-one' : a || b ? undefined : 'many-to-many' };
  };
  /** A relationship between two tables, on the columns they share a name for (blank when none). */
  const between = (a: string, b: string): Rel => {
    const f = names(a).find((n) => names(b).some((m) => m.toLowerCase() === n.toLowerCase())) ?? '';
    return detect({ from: { table: a, field: f }, to: { table: b, field: names(b).find((m) => m.toLowerCase() === f.toLowerCase()) ?? '' } });
  };
  const [draft, setDraft] = createSignal<Rel | null>(props.start ? between(...props.start) : null);
  const close = () => (setOpen(null), setDraft(null));
  const add = () => setDraft({ from: { table: '', field: '' }, to: { table: '', field: '' } });

  /** A change: a new column reads the cardinality from the data again; a saved one saves (or says why not). */
  const change = (i: number, r: Rel, patch: Partial<Rel>) => {
    const next = patch.from || patch.to ? detect({ ...r, ...patch }) : { ...r, ...patch };
    i < 0 ? setDraft(next) : setError(store.saveRelationship(next, i) || '');
  };

  /** Same-named columns of two tables (a number with a number, text with text) sharing values, not related yet. */
  const suggestions = () => {
    const ts = tables(), skip = new Set([...dismissed(), ...rels().flatMap((r) => [key(r.from) + key(r.to), key(r.to) + key(r.from)])]);
    return ts.flatMap((a, i) =>
      ts.slice(i + 1).flatMap((b) =>
        store.fieldsOf(a).flatMap((c) => {
          const d = store.fieldsOf(b).find((x) => x.name.toLowerCase() === c.name.toLowerCase());
          const r = d && store.isNumericRef(a, c.name) === store.isNumericRef(b, d.name) && detect({ from: { table: a, field: c.name }, to: { table: b, field: d.name } });
          return r && !skip.has(key(r.from) + key(r.to)) && pct(r) ? [r] : [];
        })
      )
    );
  };

  /** What a row says: how many on each side, and how many match (or what's wrong). */
  const pills = (r: Rel) => {
    const p = r.from.field && r.to.field ? pct(r) : null;
    const types = p != null && store.isNumericRef(r.from.table, r.from.field) !== store.isNumericRef(r.to.table, r.to.field);
    return (
      <>
        <span class="d-tag">{CARDS.find((c) => c[0] === r.cardinality)![1].toLowerCase()}</span>
        <span class={`d-tag ${types || (p ?? 100) < 50 ? 'warn' : 'ok'}`}>{types ? 'types differ' : p == null ? '—' : `${p}%`}</span>
      </>
    );
  };

  /** A relationship's settings, in its popover: its two columns, how many on each side, which way filters pass. */
  const settings = (i: number, r: Rel) => {
    const set = (patch: Partial<Rel>) => change(i, r, patch);
    const opts = (empty: string, xs: string[]) => xs.map((x): [string, string] => [x, x || empty]);
    const side = (label: string, k: 'from' | 'to') => (
      <div class="d-frow">
        <span class="d-flabel">{label}</span>
        <div class="d-rel-pick">
          <Select value={r[k].table} options={opts('Table…', [...(r[k].table ? [] : ['']), ...tables()])} set={(table: string) => set({ [k]: { table, field: names(table).includes(r[k].field) ? r[k].field : '' } })} />
          <Select value={r[k].field} options={opts('Column…', [...(r[k].field ? [] : ['']), ...names(r[k].table)])} set={(field: string) => set({ [k]: { ...r[k], field } })} />
        </div>
      </div>
    );
    const [m, n] = r.from.field && r.to.field ? matched(r) : [0, 0];
    return (
      <>
        {side('From', 'from')}
        {side('To', 'to')}
        <div class="d-frow">
          <span class="d-flabel">Each</span>
          <Select value={r.cardinality} options={CARDS} set={(cardinality) => set({ cardinality })} />
        </div>
        <div class="d-frow">
          <span class="d-flabel">Filters</span>
          <Select value={!!r.crossFilter} options={[[false, `${r.to.table || '…'} filters ${r.from.table || '…'}`], [true, 'Both ways']]} set={(b) => set({ crossFilter: b ? 'both' : undefined })} />
        </div>
        <Show when={n}>
          <p class="d-hint">
            {m.toLocaleString()} of {plural(n, `${r.from.field} value`)} found in {r.to.table}
            {!r.cardinality && store.repeats(r.to.table, r.to.field) ? `; ${key(r.to)} repeats values, so a row matches its first only` : ''}
          </p>
        </Show>
        <div class="d-rel-pop-foot">
          <Show when={i >= 0} fallback={<button class="btn-secondary" onClick={close}>Cancel</button>}>
            <button
              class="d-danger-link"
              onClick={() => {
                const n = store.linkedUsages(i).length;
                (!n || confirm(`${n} visual${n > 1 ? 's use' : ' uses'} fields through this relationship and will lose them. Delete it?`)) && (close(), store.removeRelationship(i));
              }}
            >
              Delete
            </button>
          </Show>
          <Show when={i < 0}>
            <button class="btn-primary" disabled={!r.from.field || !r.to.field} onClick={() => !setError(store.saveRelationship(r) || '') && close()}>
              Create
            </button>
          </Show>
        </div>
      </>
    );
  };

  /** A row: its columns and pills; a click opens its settings under it (the new one's open from the start). */
  const row = (i: number, r: () => Rel) => (
    <button
      type="button"
      class={`d-rel-row ${open()?.i === i ? 'open' : ''}`}
      ref={(el) => i < 0 && queueMicrotask(() => setOpen({ i, at: el }))}
      onClick={(e) => (open()?.i === i ? setOpen(null) : setOpen({ i, at: e.currentTarget }))}
    >
      <Show when={r().from.table} fallback={<span class="d-rel-end">New relationship</span>}>
        <End e={r().from} />
      </Show>
      <span class="d-rel-arrow">→</span>
      <Show when={r().to.table} fallback={<span />}>
        <End e={r().to} />
      </Show>
      {pills(r())}
    </button>
  );

  return (
    <Modal
      class="d-rels-dialog"
      title="Relationships"
      subtitle={`${plural(tables().length, 'table')} · ${plural(rels().length, 'relationship')} · filters pass from the one side to the many`}
      actions={<button class="btn-secondary" disabled={!!draft()} onClick={add}>New relationship…</button>}
      onClose={props.onClose}
      ok="Done"
      onOk={props.onClose}
    >
      <div class="modal-body d-rels">
        <Err text={error()} />
        <For each={suggestions()}>
          {(r) => (
            <div class="d-rel-suggest">
              <span class="d-tag">Suggested</span>
              <End e={r.from} /> → <End e={r.to} />
              <span class="d-tag ok">{pct(r)}% match</span>
              <span class="d-grow" />
              <button class="d-link-btn" onClick={() => setError(store.saveRelationship(r) || '')}>Add</button>
              <button class="d-link-btn d-quiet" onClick={() => setDismissed([...dismissed(), key(r.from) + key(r.to)])}>Dismiss</button>
            </div>
          )}
        </For>
        <div class="d-rel-list">
          <Show when={draft()}>{(r) => row(-1, r)}</Show>
          <For each={rels()} fallback={<Show when={!draft()}><p class="d-hint d-rel-none">No relationships yet. <button class="d-link-btn" onClick={add}>New relationship…</button></p></Show>}>
            {(r, i) => row(i(), () => r)}
          </For>
        </div>
      </div>
      <Show when={open()} keyed>
        {(o) => (
          <Popover class="d-rel-pop" anchor={o.at} onClose={() => setOpen(null)}>
            <Show when={o.i < 0 ? draft() : rels()[o.i]} keyed>{(r) => settings(o.i, r)}</Show>
          </Popover>
        )}
      </Show>
    </Modal>
  );
};
