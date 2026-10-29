import { Component, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { Modal } from './Modal';
import { columnsText, csvHead, inferStructure, parseCSV, parseJSON, textToColumnsAsync } from '../runtime/hydrate';
import { holdText } from '../runtime/payloads';
import { columnsFromRows } from '../runtime/columns';
import { frameRows, tableFrame } from '../runtime/frames';
import { FieldType } from '../types/model';
import { DataGrid } from './DataGrid';

/** Rows parsed for the preview (and for guessing the column types). */
const PREVIEW = 100;

/** A table name: lower case letters (any alphabet), digits and _ (a dot would read as "table.field"). */
const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_|_$/g, '') || 'table';
const taken = (id: string) => Object.hasOwn(store.doc.sources, id);

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

const unique = (base: string) => {
  let n = base;
  for (let i = 2; taken(n); i++) n = `${base}_${i}`;
  return n;
};

/**
 * Get Data: drop or browse a CSV/JSON file (or paste the text), check the preview and the column types,
 * name the table and load it. It is stored gzip+base64 with the column types as its manifest.
 * With `replaceId`, the data of that table is swapped for the new data instead: its name, relationships and
 * visuals stay, columns it already had keep their types, and columns the new data lacks are flagged first.
 */
export const AddDataDialog: Component<{ onClose: () => void; replaceId?: string }> = (props) => {
  const [source, setSource] = createSignal<'none' | 'file' | 'paste'>('none');
  const [fileName, setFileName] = createSignal('');
  const [text, setText] = createSignal('');
  const [name, setName] = createSignal('');
  const [types, setTypes] = createSignal<Record<string, FieldType>>({});
  const [error, setError] = createSignal('');
  /** What the dialog is busy with (reading a file, loading rows), and how far it has got (0–1). */
  const [busy, setBusy] = createSignal<{ text: string; share?: number } | null>(null);
  const paint = () => new Promise(r => setTimeout(r)); // let the page show the new step before a long one
  const [over, setOver] = createSignal(false);
  let fileInput!: HTMLInputElement;

  /** The rows when the text is JSON; anything else (a CSV whose first header is "[id]", say) is read as CSV. */
  const json = createMemo(() => {
    if (!/^\s*[[{]/.test(text())) return null;
    try {
      return parseJSON(text());
    } catch {
      return null;
    }
  });
  const format = () => (json() ? 'json' : 'csv');

  /**
   * The first rows (for the preview and the column types) and how many there are, or why they can't be read.
   * Only a CSV's first rows are parsed here; loading parses the rest straight into columns.
   */
  const parsed = createMemo(() => {
    const t = text().trim();
    if (!t) return { rows: [], total: 0 };
    try {
      const rows = json();
      if (rows) {
        return { rows: rows.slice(0, PREVIEW), total: rows.length };
      }
      const { head, total } = csvHead(t, PREVIEW);
      return { rows: parseCSV(head), total };
    } catch (err: any) {
      return { rows: [], total: 0, error: String(err?.message || err) };
    }
  });
  const old = () => (props.replaceId ? store.fieldsOf(props.replaceId) : []);
  const structure = createMemo(() =>
    inferStructure(parsed().rows).map(c => ({ ...c, type: types()[c.name] ?? old().find(o => o.name === c.name)?.type ?? c.type }))
  );

  /** Replacing: the columns the new data drops and adds, and what still uses the dropped ones. */
  const diff = createMemo(() => {
    const now = new Set(structure().map(c => c.name));
    const before = new Set(old().map(c => c.name));
    const missing = [...before].filter(c => !now.has(c));
    // only a replaced table has columns to miss
    const visuals = missing.length && store.usagesOf(props.replaceId!).filter(u => u.fields.some(f => missing.includes(f))).length;
    const rels = missing.length && store.relationshipsOf(props.replaceId!).filter(r => missing.includes(r.mine.field)).length;
    return { missing, added: [...now].filter(c => !before.has(c)), visuals, rels };
  });
  // typed as the table will be, as Edit Data shows it
  const preview = createMemo(() => frameRows(tableFrame(columnsFromRows(parsed().rows, structure()))));
  const ready = () => parsed().total > 0;

  const openFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setTypes({});
    setBusy({ text: `Reading ${file.name} (${(file.size / 1e6).toFixed(file.size < 1e7 ? 1 : 0)} MB)…` });
    const content = await file.text();
    setBusy({ text: `Counting rows in ${file.name}…` });
    await paint();
    setText(content);
    setBusy(null);
    setFileName(file.name);
    setName(props.replaceId ?? unique(slug(file.name.replace(/\.[^.]+$/, ''))));
    setSource('file');
  };

  const startPaste = () => {
    setSource('paste');
    setName(props.replaceId ?? unique('table'));
  };

  const reset = () => {
    setSource('none');
    setText('');
    setFileName('');
    setName('');
    setTypes({});
    setError('');
  };

  const load = async () => {
    setError('');
    const id = props.replaceId ?? slug(name());
    if (!props.replaceId && taken(id)) {
      setError(`A table named "${id}" already exists.`);
      return;
    }
    try {
      const t = text().trim();
      const total = parsed().total;
      setBusy({ text: 'Packing the data into the file…' });
      // stored as columns (a line each): smaller, and faster to open
      const payload = await holdText(await columnsText(t, format()));
      const table = await textToColumnsAsync(t, format(), structure(), (s) =>
        s.step === 'read' && setBusy({ text: `Reading rows: ${s.rows.toLocaleString()} of ${total.toLocaleString()}`, share: s.share })
      );
      setBusy({ text: 'Adding the table…', share: 1 });
      await paint();
      await store.addDataSource(id, { format: 'csv-columns', encoding: 'gzip+base64', structure: structure(), payload }, table);
      props.onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
      setBusy(null);
    }
  };

  return (
    <Modal
      class={`d-getdata ${over() ? 'over' : ''}`}
      title={props.replaceId ? `Replace data · ${props.replaceId}` : 'Get data'}
      subtitle={
        props.replaceId
          ? 'Load an updated CSV or JSON file. The table keeps its name, relationships and visuals.'
          : "Add a table from a CSV or JSON file. It's saved inside this dashboard file."
      }
      onClose={props.onClose}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        openFile(e.dataTransfer?.files?.[0]);
      }}
    >
      <input type="file" accept=".csv,.json,.txt,text/csv,application/json" hidden ref={fileInput} onChange={(e) => openFile(e.currentTarget.files?.[0])} />

      <div class="modal-body d-getdata-body">
        <Show when={source() === 'none'}>
          <div class={`d-dropzone ${over() ? 'over' : ''}`} onClick={() => fileInput.click()}>
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 34H11a8 8 0 0 1-1-15.9A12 12 0 0 1 33.5 15 8.5 8.5 0 0 1 37 34h-3" />
              <path d="M24 40V22M17 29l7-7 7 7" />
            </svg>
            <Show
              when={busy()}
              fallback={
                <>
                  <div class="d-dropzone-title">Drop a CSV or JSON file here</div>
                  <div class="d-dropzone-sub">
                    or <span class="d-link-btn">browse your files</span>
                  </div>
                </>
              }
            >
              {(b) => <div class="d-dropzone-title">{b().text}</div>}
            </Show>
          </div>
          <div class="d-or">or</div>
          <button class="btn-secondary d-paste-btn" onClick={startPaste}>
            Paste data
          </button>
        </Show>

        <Show when={source() !== 'none'}>
          <div class="d-getdata-top">
            <Show when={!props.replaceId}>
              <div class="d-getdata-field">
                <label>Table name</label>
                <input class="d-input d-getdata-name" value={name()} spellcheck={false} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && ready() && load()} />
              </div>
            </Show>
            <div class="d-getdata-meta">
              <Show when={fileName()}>
                <span class="d-file-name" title={fileName()}>{fileName()}</span>
              </Show>
              <Show when={ready()}>
                <span class="tag">{format().toUpperCase()}</span>
                {parsed().total.toLocaleString()} rows · {structure().length} columns
              </Show>
            </div>
            <button class="d-link-btn" onClick={reset}>Change source</button>
          </div>

          <Show when={source() === 'paste'}>
            <textarea
              class="d-textarea d-mono d-paste-area"
              rows={6}
              spellcheck={false}
              placeholder={'Paste CSV with a header row, e.g.\ncity,sales\nParis,120\n\n…or a JSON array of objects'}
              value={text()}
              ref={(el) => setTimeout(() => el.focus())}
              onInput={(e) => {
                setText(e.currentTarget.value);
                setTypes({});
              }}
            />
          </Show>

          <Show
            when={ready()}
            fallback={
              <div class="d-getdata-empty">
                {parsed().error ? `Couldn't read this data: ${parsed().error}` : source() === 'paste' ? 'A preview appears here as you paste.' : 'No data rows found in this file.'}
              </div>
            }
          >
            <Show when={props.replaceId}>
              <Show when={diff().missing.length}>
                <div class="d-schema-note warn">
                  <b>
                    {diff().missing.length} column{diff().missing.length > 1 ? 's are' : ' is'} missing:
                  </b>{' '}
                  {diff().missing.join(', ')}.
                  <Show when={diff().visuals || diff().rels}>
                    {` Used by ${[diff().visuals && plural(diff().visuals, 'visual'), diff().rels && plural(diff().rels, 'relationship')]
                      .filter(Boolean)
                      .join(' and ')}, which will lose ${diff().missing.length > 1 ? 'them' : 'it'}.`}
                  </Show>
                </div>
              </Show>
              <Show when={diff().added.length}>
                <div class="d-schema-note">
                  <b>{plural(diff().added.length, 'new column')}:</b> {diff().added.join(', ')}
                </div>
              </Show>
              <Show when={!diff().missing.length && !diff().added.length}>
                <div class="d-schema-note ok">Same columns as before.</div>
              </Show>
            </Show>
            <div class="d-getdata-hint">Preview — check each column's type (click its badge to change it).</div>
            <DataGrid columns={structure()} rows={preview()} limit={100} onType={(col, t) => setTypes({ ...types(), [col]: t })} />
          </Show>
        </Show>

        <Show when={error()}>
          <div class="d-form-error">{error()}</div>
        </Show>
      </div>

      <div class="modal-footer">
        <Show when={source() !== 'none' && busy()}>
          {(b) => (
            <div class="d-load-progress">
              {b().text}
              <Show when={b().share != null}>
                <div class="d-load-bar">
                  <i style={{ width: `${Math.round(b().share! * 100)}%` }} />
                </div>
              </Show>
            </div>
          )}
        </Show>
        <button class="btn-secondary" onClick={props.onClose}>Cancel</button>
        <button class="btn-primary" disabled={!!busy() || !ready() || !name().trim()} onClick={load}>
          {busy() ? 'Loading…' : !props.replaceId ? 'Load' : diff().missing.length ? 'Replace anyway' : 'Replace'}
        </button>
      </div>
    </Modal>
  );
};
