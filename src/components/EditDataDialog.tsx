import { Component, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { Modal } from './Modal';
import { Err, blurOnEnter } from './ui';
import { FieldType } from '../types/model';
import { DataGrid } from './DataGrid';
import { frameFields, frameRows, reader } from '../runtime/frames';
import { fieldStats } from '../runtime/charts';
import { payloadSize } from '../runtime/payloads';
import { plural } from '../runtime/data';
import { downloadCSV } from '../runtime/save';

/**
 * Edit Data: rename the table and its columns, change column types, and see what uses it.
 */
export const EditDataDialog: Component<{ id: string; onClose: () => void; onReplace: () => void; onRelationships: () => void }> = (props) => {
  const [id, setId] = createSignal(props.id); // follows renames
  const [error, setError] = createSignal('');
  const src = () => store.doc.sources[id()];
  const frame = () => store.tableFrame(id());
  /** The table as a CSV file: its columns and values as stored, so Replace data… takes it back as it was. */
  const exportCSV = () => {
    const f = frame(), names = frameFields(f), reads = names.map((n) => reader(f, n)!);
    downloadCSV(id(), [names, ...Array.from({ length: f.length }, (_, k) => reads.map((r) => String(r(k) ?? '')))]);
  };
  // the grid shows the first rows as objects; the table itself stays in columns (its counts are read from them)
  const gridRows = createMemo(() => frameRows(frame(), 0, 200));
  const uses = createMemo(() => store.columnUses(id()));
  /** How many things (visuals, measures, relationships, filters, sort orders) use the table; the columns none uses. */
  const usedBy = () => new Set([...uses().values()].flat()).size;
  const unused = () => (src()?.structure ?? []).map(c => c.name).filter(n => !uses().get(n)?.length);

  /** Shows a store error (or clears it); true when there was none. */
  const ok = (err: string | null) => (setError(err || ''), !err);

  const rename = (input: HTMLInputElement) => {
    if (ok(store.renameSource(id(), input.value))) setId(input.value.trim());
    else input.value = id();
  };

  return (
    <Modal class="d-editdata d-editdata-tall" onClose={props.onClose} ok="Done" onOk={props.onClose}>
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
              onKeyDown={blurOnEnter}
            />
            <div class="d-editdata-meta">
              {frame().length.toLocaleString()} rows · {src()?.structure.length ?? 0} columns ·{' '}
              {((kb) => (kb === kb ? `${kb.toFixed(1)} KB stored` : 'compressing…'))(src() ? payloadSize(src().payload) / 1024 : 0)}
              {/* what uses the table (each column's uses on hover), and the columns nothing uses */}
              {' · '}
              <span class="d-uses" title={[...uses()].map(([c, u]) => `${c}: ${u.join(', ')}`).join('\n') || 'No visuals use this table yet'}>
                {usedBy() ? `used by ${usedBy()}` : 'unused'}
              </span>
              <Show when={usedBy() && unused().length}>
                {' · '}
                <span class="d-uses none" title={`Nothing uses:\n${unused().join('\n')}`}>
                  {plural(unused().length, 'column')} unused
                </span>
              </Show>
            </div>
          </div>
        </div>
        <div class="d-editdata-actions">
          <button class="btn-secondary" title="How this table connects to the others" onClick={props.onRelationships}>
            Relationships…
          </button>
          <button class="btn-secondary" title="Download this table as a CSV file, to edit and bring back with Replace data…" onClick={exportCSV}>
            Export CSV
          </button>
          <button class="btn-secondary d-replace-btn" title="Update this table from a CSV or JSON file" onClick={props.onReplace}>
            Replace data…
          </button>
        </div>
      </div>

      <Err text={error()} class="d-editdata-error" />
      <Show when={src()}>
          <div class="d-editdata-hint">
            Rename columns or change their types here. Updates apply throughout the report; original values are kept.
          </div>
          <div class="modal-body d-editdata-grid">
            <DataGrid
              columns={src().structure}
              rows={gridRows()}
              total={frame().length}
              limit={200}
              onType={(col, t) => store.setColumnType(id(), col, t as FieldType)}
              onSortBy={(col, by) => store.setSortBy(id(), col, by)}
              stats={(col) => fieldStats(frame(), col)}
              onRename={async (column, input) => {
                if (!ok(await store.renameColumn(id(), column, input.value))) input.value = column;
              }}
            />
          </div>
      </Show>
    </Modal>
  );
};
