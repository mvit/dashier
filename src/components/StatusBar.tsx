import { Component, For, Show } from 'solid-js';
import { store } from '../runtime/store';
import { view, MIN_ZOOM, MAX_ZOOM } from '../runtime/view';

/** Window-wide bar under everything: where you are, and the report view's zoom. */
export const StatusBar: Component = () => {
  const pageNumber = () => Math.max(1, store.doc.pages.findIndex(p => p.id === store.activePageId()) + 1);

  return (
    <footer class="ed-statusbar">
      <span class={store.status() ? 'ed-status-busy' : ''}>{store.status() || `Page ${pageNumber()} of ${store.doc.pages.length}`}</span>

      <div class="ed-status-right">
        <Show when={store.editing()}>
          <button class="d-status-btn" title={`${store.isDark() ? 'Light' : 'Dark'} editor (the report keeps its own theme)`} onClick={() => store.toggleUi()}>
            {store.isDark() ? '☀' : '☾'}
          </button>
          <span class="d-status-sep">|</span>
        </Show>
        <div class="d-zoom" title="Pinch or use the slider to zoom the report · drag the background or Space + drag to pan">
          <button class="d-status-btn" title="Zoom out" onClick={() => view.zoomStep(-1)}>−</button>
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
          <button class="d-status-btn" title="Zoom in" onClick={() => view.zoomStep(1)}>+</button>
          <button class="d-status-btn d-zoom-pct" title="Actual size" onClick={() => view.zoomTo(1)}>
            {Math.round(view.zoom() * 100)}%
          </button>
          <For each={[['width', 'the page width to'], ['page', 'the whole page in']] as const}>
            {([mode, what]) => (
              <button class={`d-status-btn ${view.fit() === mode ? 'active' : ''}`} title={`Fit ${what} the window`} onClick={() => view.setFit(mode)}>
                Fit {mode}
              </button>
            )}
          </For>
        </div>
      </div>
    </footer>
  );
};
