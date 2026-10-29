import { Component, createSignal, Show } from 'solid-js';
import { openMenuBelow } from './ContextMenu';
import { store } from '../runtime/store';
import { Logo, RedoIcon, UndoIcon } from './icons';
import { PasswordDialog } from './PasswordDialog';

export const TopBar: Component<{ onAbout: () => void }> = (props) => {
  const [notification, setNotification] = createSignal('');
  const [asking, setAsking] = createSignal(false);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  };

  const save = async (saveAs = false) => {
    try {
      const res = await store.save(saveAs);
      if (res.success) notify(`Saved to ${res.fileName} (${res.mode === 'file-handle' ? 'in place' : 'downloaded'})`);
    } catch (err: any) {
      notify(`Save error: ${err.message}`);
    }
  };

  /** A password set or removed is saved at once, so the file says what the menu did. */
  const setPassword = async (password: string | null) => {
    setAsking(false);
    await store.setPassword(password);
    await save();
  };

  const openJSON = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const doc = JSON.parse(await file.text());
        if (!Array.isArray(doc.pages) || !doc.pages.length) throw new Error('no pages');
        store.importDoc({ sources: {}, ...doc });
        notify(`Opened ${file.name}`);
      } catch (err: any) {
        notify(`Not a dashboard JSON: ${err.message}`);
      }
    };
    input.click();
  };

  return (
    <header class="ed-topbar">
      <Show when={notification()}>
        <div class="ed-toast">✓ {notification()}</div>
      </Show>
      <Show when={asking()}>
        <PasswordDialog confirm onSubmit={setPassword} onClose={() => setAsking(false)} />
      </Show>

      <div class="ed-group ed-group-title">
        <button class="ed-logo" title="About Dashier" onClick={props.onAbout}>
          <Logo size={22} />
        </button>
        <input
          type="text"
          class="ed-title"
          value={store.doc.title}
          // the whole title, however long: the field is as wide as its text (up to the space the bar has)
          size={Math.max(8, (store.doc.title || '').length + 1)}
          onInput={(e) => store.setTitle(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          title="Rename dashboard"
        />
      </div>

      <div class="ed-group ed-group-right">
        <div class="ed-btn-cluster">
          <button class="ed-btn ed-btn-icon" title="Undo (Ctrl+Z)" disabled={!store.canUndo()} onClick={() => store.undo()}><UndoIcon /></button>
          <button class="ed-btn ed-btn-icon" title="Redo (Ctrl+Y)" disabled={!store.canRedo()} onClick={() => store.redo()}><RedoIcon /></button>
        </div>

        <button class="ed-btn" title="See the report as a recipient will (Esc to return)" onClick={() => store.setPreview(true)}>
          ▶ Preview
        </button>

        <button
          class="ed-btn ed-btn-primary"
          disabled={store.isSaving()}
          title={store.isDirty() ? 'Unsaved changes (Ctrl+S saves)' : 'Saved'}
          onClick={(e) =>
            openMenuBelow(e, [
              { label: 'Save', kbd: 'Ctrl+S', onSelect: () => save() },
              { label: 'Save a copy…', onSelect: () => save(true) },
              { label: 'Print…', kbd: 'Ctrl+P', onSelect: () => store.print() },
              '-',
              { label: 'Encrypt with password…', onSelect: () => setAsking(true) },
              { label: 'Remove encryption', disabled: !store.encrypted(), onSelect: () => setPassword(null) },
              '-',
              { label: 'Export JSON', onSelect: () => store.exportJSON() },
              { label: 'Open JSON…', onSelect: openJSON }
            ])
          }
        >
          {store.isSaving() ? 'Saving…' : 'Share ▾'}
          {/* unsaved changes: a badge on the button that saves them */}
          <Show when={store.isDirty()}>
            <span class="ed-dirty" />
          </Show>
        </button>
      </div>
    </header>
  );
};
