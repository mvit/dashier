import { Component, For, createSignal } from 'solid-js';
import { observeSize } from '../runtime/view';
import { store } from '../runtime/store';
import { reportStyle } from '../runtime/theme';
import { Widget } from './Widget';

/**
 * What prints: every page of the report, laid out off screen at its full size while the browser's print dialog
 * is open. Each page prints on a sheet of its own size (named @page rules); where it goes (paper, PDF) is up to
 * the dialog.
 */
export const PrintView: Component = () => {
  const size = () => store.canvasSize();
  const pages = () => store.doc.pages;
  // a page grows taller than the canvas when visuals run past its bottom, and so does its sheet
  const [heights, setHeights] = createSignal<Record<string, number>>({});
  const height = (id: string) => Math.max(heights()[id] ?? 0, size().height);
  const pageRules = () =>
    pages().map((p, i) => `@page p${i} { size: ${size().width}px ${height(p.id)}px; margin: 0; } .d-print-slot[data-i="${i}"] { page: p${i}; }`).join('\n');

  return (
    <div class="d-print-view">
      <style>{pageRules()}</style>
      <For each={pages()}>
        {(page, i) => (
          <div class="d-print-slot" data-i={i()}>
            <div
              class="d-canvas-sheet d-print-page"
              style={{ ...reportStyle(store.reportTheme()), width: `${size().width}px`, 'min-height': `${size().height}px` }}
              ref={(el) => observeSize(el, () => setHeights(h => (h[page.id] === el.offsetHeight ? h : { ...h, [page.id]: el.offsetHeight })))}
            >
              <div class="d-visuals-grid">
                <For each={page.elements}>
                  {(elem) => (
                    <div class="d-visual-container" style={{ 'grid-column': `${elem.x + 1} / span ${elem.w}`, 'grid-row': `${elem.y + 1} / span ${elem.h}` }}>
                      <div class="d-visual-inner">
                        <Widget element={elem} />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
