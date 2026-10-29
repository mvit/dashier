import { Component, createSignal, onCleanup, Show, JSX } from 'solid-js';
import { store } from './runtime/store';
import { TopBar } from './components/TopBar';
import { Canvas } from './components/Canvas';
import { VisualsPane } from './components/VisualsPane';
import { DataPane } from './components/DataPane';
import { FiltersPane } from './components/FiltersPane';
import { StatusBar } from './components/StatusBar';
import { PrintView } from './components/PrintView';
import { MeasureDialog } from './components/MeasureDialog';
import { Logo } from './components/icons';
import { ContextMenuHost } from './components/ContextMenu';
import { AddDataDialog } from './components/AddDataDialog';
import { EditDataDialog } from './components/EditDataDialog';
import { Modal } from './components/Modal';

/** The project's home, shown in About. */
const GITHUB = 'https://github.com/mvit/dashier';

/** A side pane with its title, that collapses to a vertical tab. `setOpen` expands (true) and collapses it. */
const Pane: Component<{ open: boolean; label: string; class: string; setOpen: (open: boolean) => void; children: JSX.Element }> = (props) => (
  <Show
    when={props.open}
    fallback={
      <button class="d-collapsed-pane-tab" onClick={() => props.setOpen(true)} title={`Expand ${props.label} pane`}>
        <span class="vertical-text">{props.label}</span>
        <span class="expand-icon">«</span>
      </button>
    }
  >
    <div class={`d-pane ${props.class}`}>
      <div class="d-pane-header">
        <span class="d-pane-title">{props.label}</span>
        <button class="d-pane-collapse-btn" title={`Collapse ${props.label} pane`} onClick={() => props.setOpen(false)}>»</button>
      </div>
      <div class="d-pane-body">{props.children}</div>
    </div>
  </Show>
);

export const App: Component = () => {
  // At most one dialog at a time: adding a table, editing the named one, replacing its data, a measure, or About.
  const [dialog, setDialog] = createSignal<{ add?: true; edit?: string; replace?: string; measure?: { table: string; name?: string; field?: string }; about?: true; exportJSON?: true } | null>(null);
  const close = () => setDialog(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const esc = key === 'escape';

    // Ctrl/⌘+P prints every page, not just the one on screen
    if (mod && key === 'p') {
      e.preventDefault();
      return store.print();
    }
    if (esc && store.printing()) return store.setPrinting(false);
    if (mod && key === 's') {
      e.preventDefault();
      return store.save(false);
    }
    if (esc && dialog()) return close();
    if (esc && store.preview()) return store.setPreview(false);
    // an open dialog or menu has the keyboard: nothing behind it moves, deletes or undoes
    if (dialog() || document.querySelector('.d-context-menu,.d-field-menu')) return;
    if (!store.editing() || (e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable]')) return;
    if (esc) return store.setSelectedElementId(null);

    const sel = store.getSelectedElement();
    const pageId = store.activePageId();
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) store.redo();
    else if (mod && key === 'z') store.undo();
    else if (sel && (key === 'delete' || key === 'backspace')) store.deleteElement(pageId, sel.id);
    else if (sel && mod && key === 'd') store.duplicateElement(pageId, sel.id);
    else if (sel && key.startsWith('arrow')) {
      // arrows move; shift+arrows resize
      const dx = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
      const dy = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
      if (e.shiftKey) store.moveResizeElement(pageId, sel.id, sel.x, sel.y, sel.w + dx, sel.h + dy);
      else store.moveResizeElement(pageId, sel.id, sel.x + dx, sel.y + dy, sel.w, sel.h);
    } else return;
    e.preventDefault();
  };

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (store.isDirty()) e.preventDefault();
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('beforeunload', handleBeforeUnload);
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  });

  return (
    <div
      class={`ed-root ${store.isDark() ? 'theme-dark' : 'theme-light'} ${store.preview() ? 'mode-preview' : 'mode-edit'} ${store.printing() ? 'mode-printing' : ''}`}
      data-theme={store.isDark() ? 'dark' : 'light'}
    >
      <Show when={!store.preview()}>
        <TopBar onAbout={() => setDialog({ about: true })} onExportJSON={() => setDialog({ exportJSON: true })} />
      </Show>

      <div class="ed-main">
        <div class="ed-canvas-area">
          <Canvas />
        </div>

        <Show when={!store.preview()}>
          <div class="d-right-panes-strip">
            <Pane open={store.filtersPaneOpen()} label="Filters" class="d-filters-pane" setOpen={store.setFiltersPaneOpen}>
              <FiltersPane />
            </Pane>
            <Pane open={store.visualsPaneOpen()} label="Visualizations" class="d-visualizations-pane" setOpen={store.setVisualsPaneOpen}>
              <VisualsPane />
            </Pane>
            <Pane open={store.dataPaneOpen()} label="Data" class="d-data-pane" setOpen={store.setDataPaneOpen}>
              <DataPane onGetData={() => setDialog({ add: true })} onEditData={(id) => setDialog({ edit: id })} onReplaceData={(id) => setDialog({ replace: id })} onMeasure={(table, name, field) => setDialog({ measure: { table, name, field } })} />
            </Pane>
          </div>
        </Show>
      </div>

      <StatusBar />
      <ContextMenuHost />

      <Show when={store.printing()}>
        <PrintView />
      </Show>

      <Show when={store.preview()}>
        <button class="ed-btn d-exit-preview" title="Back to the editor (Esc)" onClick={() => store.setPreview(false)}>
          ✎ Edit
        </button>
      </Show>

      <Show when={dialog()?.add}>
        <AddDataDialog onClose={close} />
      </Show>
      <Show when={dialog()?.edit}>
        {(id) => <EditDataDialog id={id()} onClose={close} onReplace={() => setDialog({ replace: id() })} />}
      </Show>
      {/* About, and the same dialog warning that Export JSON from an encrypted report writes its data readable */}
      <Show when={dialog()?.about || dialog()?.exportJSON}>
        <Modal class="d-about" onClose={close}>
          <Logo size={48} />
          <Show
            when={dialog()?.about}
            fallback={
              <>
                <h3>Export readable data?</h3>
                <p>This report is encrypted, but Export JSON writes every table readable, without the password: anyone with the JSON can read the data.</p>
                <div class="d-row">
                  <button class="btn-secondary" onClick={close}>Cancel</button>
                  <button class="btn-primary" onClick={() => (close(), store.exportJSON())}>Export JSON</button>
                </div>
              </>
            }
          >
            <h3>Dashier</h3>
            <p>A dashboard in one HTML file: the report and its data, for people and LLMs to edit.</p>
            <p>Made by mvit and Opus 5.5</p>
            <p>{GITHUB ? <a href={GITHUB} target="_blank" rel="noopener">GitHub</a> : 'GitHub: coming soon'}</p>
            <button class="btn-primary" onClick={close}>Close</button>
          </Show>
        </Modal>
      </Show>
      <Show when={dialog()?.measure}>{(m) => <MeasureDialog table={m().table} name={m().name} field={m().field} onClose={close} />}</Show>
      <Show when={dialog()?.replace}>
        {(id) => <AddDataDialog replaceId={id()} onClose={close} />}
      </Show>
    </div>
  );
};
