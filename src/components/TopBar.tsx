import { Component, createSignal, Show } from 'solid-js';
import { MAC, MOD, openMenuBelow } from './ContextMenu';
import { store } from '../runtime/store';
import { Logo, RedoIcon, UndoIcon } from './icons';
import { PasswordDialog } from './PasswordDialog';

export const TopBar: Component<{ onAbout: () => void; onExportJSON: () => void }> = (props) => {
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
        <PasswordDialog confirm={store.encrypted() ? 'Change password' : 'Add a password'} onSubmit={setPassword} onClose={() => setAsking(false)} />
      </Show>
      {/* an encrypted JSON just opened (older exports): its password, as when opening the file; Cancel goes back to the report before */}
      <Show when={store.locked()}>
        <PasswordDialog onSubmit={async (pw) => ((await store.unlock(pw)) ? void store.hydrate() : 'Wrong password')} onClose={store.undo} />
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
          <button class="ed-btn ed-btn-icon" title={`Undo (${MOD}Z)`} disabled={!store.canUndo()} onClick={() => store.undo()}><UndoIcon /></button>
          <button class="ed-btn ed-btn-icon" title={`Redo (${MAC ? '⇧⌘Z' : 'Ctrl+Y'})`} disabled={!store.canRedo()} onClick={() => store.redo()}><RedoIcon /></button>
        </div>

        <button class="ed-btn" title="See the report as a recipient will (Esc to return)" onClick={() => store.setPreview(true)}>
          ▶ Preview
        </button>

        <button
          class="ed-btn ed-btn-primary"
          disabled={store.isSaving()}
          title={store.isDirty() ? `Unsaved changes (${MOD}S saves)` : 'Saved'}
          onClick={(e) =>
            openMenuBelow(e, [
              // the file, then printing; its password; the report as JSON, the hand-over format (to people and agents)
              { label: 'Save', kbd: `${MOD}S`, onSelect: () => save() },
              { label: 'Save as…', hint: 'Save to a new file, and keep working in it', onSelect: () => save(true) },
              { label: 'Print…', kbd: `${MOD}P`, hint: 'Every page, one per sheet. To make a PDF, choose Save as PDF in the print dialog', onSelect: () => store.print() },
              '-',
              ...(store.encrypted()
                ? [
                    { label: 'Change password…', onSelect: () => setAsking(true) },
                    { label: 'Remove password', hint: 'Save the data readable again: anyone with the file can open it', onSelect: () => setPassword(null) }
                  ]
                : [{ label: 'Add a password…', hint: 'Encrypt the data in the file: it opens only with the password', onSelect: () => setAsking(true) }]),
              '-',
              // from an encrypted report the JSON is readable: App warns first
              { label: 'Export as JSON', hint: 'The whole report, data included and readable: for agents and other tools', onSelect: () => (store.encrypted() ? props.onExportJSON() : store.exportJSON()) },
              { label: 'Replace with JSON…', hint: "Open a report's JSON in place of this one (Undo brings this one back)", onSelect: openJSON }
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
