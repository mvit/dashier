import { Component, Show } from 'solid-js';
import { store } from '../runtime/store';
import { view, MIN_ZOOM, MAX_ZOOM } from '../runtime/view';
import { openMenuBelow } from './ContextMenu';

/** Window-wide bar under everything: where you are, and the report view's zoom. */
export const StatusBar: Component = () => {
  const pageNumber = () => Math.max(1, store.doc.pages.findIndex(p => p.id === store.activePageId()) + 1);
  const pct = () => Math.round(view.zoom() * 100);
  // the fit modes and some sizes; what's in use is ticked, in the shortcut's place
  const zoomMenu = (e: MouseEvent) =>
    openMenuBelow(e, [
      ...(['width', 'page'] as const).map(mode => ({ label: `Fit ${mode}`, kbd: view.fit() === mode ? '✓' : undefined, onSelect: () => view.setFit(mode) })),
      '-',
      ...[50, 75, 100, 150, 200].map(p => ({ label: `${p}%`, kbd: !view.fit() && pct() === p ? '✓' : undefined, onSelect: () => view.zoomTo(p / 100) }))
    ]);

  return (
    <footer class="ed-statusbar">
      <span class={store.status() ? 'ed-status-busy' : ''}>{store.status() || `Page ${pageNumber()} of ${store.doc.pages.length}`}</span>

      <div class="ed-status-right">
        <Show when={store.editing()}>
          <button class="d-status-btn" title={`${store.isDark() ? 'Light' : 'Dark'} editor (the report keeps its own theme)`} onClick={() => store.toggleUi()}>
            {store.isDark() ? '☀' : '☾'}
          </button>
        </Show>
        <div class="d-zoom" title="Pinch or use the slider to zoom the report · drag the background or Space + drag to pan">
          {/* the slider is logarithmic, so 25%–100% gets as much travel as 100%–400% */}
          <input
            type="range"
            class="d-zoom-slider"
            min={Math.log2(MIN_ZOOM)}
            max={Math.log2(MAX_ZOOM)}
            step="0.01"
            value={Math.log2(view.zoom())}
            onInput={(e) => view.zoomTo(2 ** Number(e.currentTarget.value))}
          />
          <button class="d-status-btn d-zoom-pct" title="Zoom" onClick={zoomMenu}>
            {pct()}%
            <span class="d-pill-caret" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
};
