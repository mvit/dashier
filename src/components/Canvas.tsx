import { Component, For, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { DashPage, DashElement, SlicerElement } from '../types/model';
import { store } from '../runtime/store';
import { reportStyle } from '../runtime/theme';
import { view, clampZoom, observeSize } from '../runtime/view';
import { Widget, cell, sheetStyle } from './Widget';
import { MOD, MenuEntry, openMenu } from './ContextMenu';
import { Card } from './ui';
import { ClearFilterIcon } from './icons';
import { pickSummary } from '../runtime/data';
import { datePartLabel } from '../runtime/dates';

// Must match .d-visuals-grid in theme.css
const ROW_H = 85;
const GAP = 14;
const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
// Must match .d-canvas-scroll-container padding
const VIEW_PAD = 24;

/** Follows a pointer gesture on the window until the button is released. */
const track = (onMove: (e: PointerEvent) => void, onEnd: () => void) => {
  const onUp = () => {
    onEnd();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
};

export const Canvas: Component = () => {
  let gridRef: HTMLDivElement | undefined;
  const currentPage = () => store.getActivePage() || store.doc.pages[0];
  const [editingPageId, setEditingPageId] = createSignal<string | null>(null);
  const [pageTitleInput, setPageTitleInput] = createSignal('');
  const [dragging, setDragging] = createSignal(false);

  // --- Zoom & pan ---
  // The sheet is always laid out at the document's fixed size and scaled as a whole; it never reflows to the window.
  let scrollRef!: HTMLDivElement;
  let stageRef!: HTMLDivElement;
  let sheetRef!: HTMLDivElement;
  const size = () => store.canvasSize();
  const { zoom, fit, zoomTo } = view;
  const [sheetH, setSheetH] = createSignal(size().height);
  const [viewport, setViewport] = createSignal({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  // a pan ends in a click on the background, which mustn't deselect
  let panned = false;

  /** Sets the zoom, keeping the sheet point under `at` (client coords; default: view center) in place. */
  const applyZoom = (z: number, at?: { x: number; y: number }) => {
    const old = zoom();
    z = clampZoom(z);
    if (Math.abs(z - old) < 1e-4) return;
    const sr = scrollRef.getBoundingClientRect();
    const p = at ?? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    const r = stageRef.getBoundingClientRect();
    const cx = (p.x - r.left) / old;
    const cy = (p.y - r.top) / old;
    view.setZoom(z);
    const r2 = stageRef.getBoundingClientRect();
    scrollRef.scrollLeft += r2.left + cx * z - p.x;
    scrollRef.scrollTop += r2.top + cy * z - p.y;
  };
  view.bind(applyZoom);

  // Fit modes follow the view and the page as they change size.
  createEffect(() => {
    const mode = fit();
    const { w, h } = viewport();
    // not mid-drag: the page growing under the pointer would zoom away from it
    if (!mode || !w || dragging()) return;
    const zw = (w - 2 * VIEW_PAD) / size().width;
    const zh = (h - 2 * VIEW_PAD) / sheetH();
    applyZoom(mode === 'width' ? zw : Math.min(zw, zh));
  });

  /** Pans by dragging: middle button anywhere, Space + drag anywhere, or a plain drag on the background. */
  const startPan = (e: PointerEvent) => {
    const onBackground = !(e.target as HTMLElement).closest('.d-visual-container,input,select,textarea,button,a');
    if (!(e.button === 1 || (e.button === 0 && (spaceHeld() || onBackground)))) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, l: scrollRef.scrollLeft, t: scrollRef.scrollTop };
    panned = false;
    track((ev) => {
      setPanning((panned = true));
      scrollRef.scrollLeft = start.l - (ev.clientX - start.x);
      scrollRef.scrollTop = start.t - (ev.clientY - start.y);
    }, () => setPanning(false));
  };

  onMount(() => {
    observeSize(tabsRef, measureTabs);
    observeSize(scrollRef, () => setViewport({ w: scrollRef.clientWidth, h: scrollRef.clientHeight }));
    observeSize(sheetRef, () => setSheetH(sheetRef.offsetHeight));

    let ctrlDown = false;
    let gestureBase = 1;
    const listeners: [EventTarget, string, (e: any) => void][] = [
      // A trackpad pinch arrives as a wheel event flagged ctrlKey without Ctrl being down: it scales the sheet
      // around the pointer. A real Ctrl + wheel is left to the browser, whose page zoom resizes the whole UI.
      [scrollRef, 'wheel', (e: WheelEvent) => {
        if (!e.ctrlKey || ctrlDown) return;
        e.preventDefault();
        const d = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
        zoomTo(zoom() * Math.exp(-d * 0.01), { x: e.clientX, y: e.clientY });
      }],
      // Safari reports trackpad pinches as gesture events instead.
      [scrollRef, 'gesturestart', (e) => {
        e.preventDefault();
        gestureBase = zoom();
      }],
      [scrollRef, 'gesturechange', (e) => {
        e.preventDefault();
        zoomTo(gestureBase * e.scale, { x: e.clientX, y: e.clientY });
      }],
      [window, 'keydown', (e: KeyboardEvent) => {
        if (e.key === 'Control') ctrlDown = true;
        if (e.key === ' ' && !(e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable],button,a')) {
          e.preventDefault();
          setSpaceHeld(true);
        }
      }],
      [window, 'keyup', (e: KeyboardEvent) => {
        if (e.key === 'Control') ctrlDown = false;
        if (e.key === ' ') setSpaceHeld(false);
      }],
      [window, 'blur', () => ((ctrlDown = false), setSpaceHeld(false))]
    ];
    for (const [t, type, f] of listeners) t.addEventListener(type, f, { passive: false });
    onCleanup(() => {
      for (const [t, type, f] of listeners) t.removeEventListener(type, f);
    });
  });

  /**
   * Pointer drag on a visual (mode 'move') or one of its handles (n/s/e/w combos).
   * Movement snaps to grid cells; the whole gesture is a single undo step.
   */
  const startDrag = (e: PointerEvent, elem: DashElement, mode: string) => {
    if (!store.editing() || e.button !== 0 || spaceHeld() || !gridRef) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('input,select,textarea,button,a,th,label,.d-visual-toolbar')) return;
    e.preventDefault();
    e.stopPropagation();
    store.setSelectedElementId(elem.id);
    // pointer travel is measured on the sheet (unscaled px), so a zoom that changes mid-drag (Fit page) doesn't drift
    const colW = (gridRef.offsetWidth + GAP) / 12;
    const rowH = ROW_H + GAP;
    const at = (ev: PointerEvent) => {
      const r = gridRef!.getBoundingClientRect();
      return { px: (ev.clientX - r.left) / zoom(), py: (ev.clientY - r.top) / zoom() };
    };
    const start = { ...at(e), x: elem.x, y: elem.y, w: elem.w, h: elem.h };
    const pageId = currentPage().id;
    const key = `drag:${Date.now()}`;

    track((ev) => {
      const p = at(ev);
      let dx = Math.round((p.px - start.px) / colW);
      let dy = Math.round((p.py - start.py) / rowH);
      let { x, y, w, h } = start;
      if (mode === 'move') {
        x += dx;
        y += dy;
      } else {
        if (mode.includes('e')) w += dx;
        if (mode.includes('s')) h += dy;
        if (mode.includes('w')) {
          dx = Math.max(-x, Math.min(w - 1, dx));
          x += dx;
          w -= dx;
        }
        if (mode.includes('n')) {
          dy = Math.max(-y, Math.min(h - 1, dy));
          y += dy;
          h -= dy;
        }
      }
      setDragging(true);
      store.moveResizeElement(pageId, elem.id, x, y, w, h, key);
    }, () => setDragging(false));
  };

  const finishRenamePage = () => {
    const id = editingPageId();
    const title = pageTitleInput().trim();
    if (id && title) store.renamePage(id, title);
    setEditingPageId(null);
  };

  // Page tabs scroll sideways; the active tab (e.g. one just added) is scrolled into view.
  let tabsRef!: HTMLDivElement;
  const [tabsOverflow, setTabsOverflow] = createSignal(false);
  const measureTabs = () => setTabsOverflow(tabsRef.scrollWidth > tabsRef.clientWidth + 1);
  const scrollTabs = (left: number) => tabsRef.scrollBy({ left, behavior: 'smooth' });
  createEffect(() => {
    store.activePageId();
    store.doc.pages.length;
    queueMicrotask(() => {
      measureTabs();
      tabsRef.querySelector('.d-bottom-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });

  /** A page tab's right-click menu. */
  const pageMenu = (page: DashPage): MenuEntry[] => [
    { label: 'Rename', onSelect: () => startRenamePage(page) },
    { label: 'Duplicate', onSelect: () => store.duplicatePage(page.id) },
    { label: 'Delete', danger: true, disabled: store.doc.pages.length < 2, onSelect: () => confirm(`Delete page "${page.title}"?`) && store.deletePage(page.id) },
    '-',
    { label: 'New page', onSelect: () => store.addPage() }
  ];

  // On a phone the page's slicers live in a drawer, opened from a button at the top (theme.css shows the button, and
  // hides the slicers in the page, only there): a card each, as filters are, saying what's picked; a lone one is open.
  const slicers = () => (currentPage()?.elements.filter(e => e.type === 'slicer') ?? []) as SlicerElement[];
  const [drawer, setDrawer] = createSignal(false);
  const [opened, setOpened] = createSignal(new Set<string>());
  const flipSlicer = (id: string) => setOpened(o => (o.has(id) ? (o.delete(id), new Set(o)) : new Set(o.add(id))));

  const startRenamePage = (page: DashPage) => {
    if (!store.editing()) return;
    setEditingPageId(page.id);
    setPageTitleInput(page.title);
  };

  return (
    <div class="d-canvas-workspace" onClick={() => panned ? (panned = false) : store.setSelectedElementId(null)}>
      <div
        class={`d-canvas-scroll-container ${spaceHeld() ? 'pan-ready' : ''} ${panning() ? 'panning' : ''}`}
        ref={scrollRef}
        onPointerDown={startPan}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      >
        <div class="d-canvas-stage" ref={stageRef} style={{ width: `${size().width * zoom()}px`, height: `${sheetH() * zoom()}px` }}>
        <div
          class={`d-canvas-sheet ${store.editing() ? 'editing' : ''} ${dragging() ? 'dragging' : ''}`}
          ref={sheetRef}
          style={{ ...sheetStyle(), transform: `scale(${zoom()})` }}
        >
          <Show
            when={currentPage()?.elements.length}
            fallback={
              <div class="d-canvas-empty">{store.editing() ? 'Add a visual from the Visualizations pane' : ''}</div>
            }
          >
            <div class="d-visuals-grid" ref={gridRef}>
              <For each={currentPage().elements}>
                {(elem) => {
                  const isSelected = () => store.editing() && store.selectedElementId() === elem.id;
                  const duplicate = () => store.duplicateElement(currentPage().id, elem.id);
                  const remove = () => store.deleteElement(currentPage().id, elem.id);

                  return (
                    <div
                      class={`d-visual-container ${isSelected() ? 'd-selected' : ''}`}
                      data-id={elem.id}
                      data-type={elem.type}
                      style={{
                        ...cell(elem),
                        // reading order (top to bottom, left to right), for the phone layout
                        '--o': `${elem.y * 12 + elem.x}`
                      }}
                      onPointerDown={(e) => startDrag(e, elem, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (store.editing()) store.setSelectedElementId(elem.id);
                      }}
                      onContextMenu={(e) => {
                        if (!store.editing()) return;
                        store.setSelectedElementId(elem.id);
                        openMenu(e, [
                          { label: 'Duplicate', kbd: `${MOD}D`, onSelect: duplicate },
                          '-',
                          { label: 'Delete', kbd: 'Del', danger: true, onSelect: remove }
                        ]);
                      }}
                    >
                      <Show when={isSelected()}>
                        <div class="d-selection-frame">
                          <For each={HANDLES}>
                            {(h) => <div class={`handle h-${h}`} onPointerDown={(e) => startDrag(e, elem, h)} />}
                          </For>

                          <div class="d-visual-toolbar" onClick={(e) => e.stopPropagation()}>
                            <button class="d-tool-btn" title={`Duplicate (${MOD}D)`} onClick={duplicate}>
                              ⧉
                            </button>
                            <button class="d-tool-btn danger" title="Delete (Del)" onClick={remove}>
                              ✕
                            </button>
                          </div>
                        </div>
                      </Show>

                      <div class="d-visual-inner">
                        <Widget element={elem} />
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
        </div>
      </div>

      {/* always there on a phone; with no slicers on the page, there's nothing to open */}
      <button class={`ed-btn d-drawer-btn ${drawer() ? 'active' : ''}`} disabled={!slicers().length} onClick={(e) => (e.stopPropagation(), setDrawer(!drawer()))}>
        Filters
      </button>
      <Show when={slicers().length}>
        <Show when={drawer()}>
          <div class="d-drawer" style={reportStyle(store.reportTheme())} onClick={(e) => e.stopPropagation()}>
            <For each={slicers()}>
              {(elem) => (
                <Card
                  class={`d-filter-card ${elem.selection ? 'active' : ''}`}
                  open={opened().has(elem.id) || slicers().length === 1}
                  flip={() => flipSlicer(elem.id)}
                  title={
                    <>
                      <span class="filter-name">{elem.title || elem.field}</span>
                      <span class="filter-type">{pickSummary(elem.selection, (v) => datePartLabel(v, elem.datePart), () => store.slicerOptions(elem).values.length) || 'All'}</span>
                    </>
                  }
                  actions={
                    <Show when={elem.selection}>
                      <button class="d-filter-x" title="Clear the selection" onClick={() => store.setSlicerSelection(currentPage().id, elem.id, undefined)}>
                        <ClearFilterIcon />
                      </button>
                    </Show>
                  }
                >
                  <Widget element={elem} />
                </Card>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Bottom page tabs */}
      <footer class="d-bottom-pages-bar" onClick={(e) => e.stopPropagation()}>
        <Show when={tabsOverflow()}>
          <button class="d-tabs-arrow" title="Scroll pages left" onClick={() => scrollTabs(-200)}>‹</button>
          <button class="d-tabs-arrow" title="Scroll pages right" onClick={() => scrollTabs(200)}>›</button>
        </Show>
        <div
          class="d-page-tabs-list"
          ref={tabsRef}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) tabsRef.scrollLeft += e.deltaY;
          }}
        >
          <For each={store.doc.pages}>
            {(page) => (
              <div
                class={`d-bottom-tab ${store.activePageId() === page.id ? 'active' : ''}`}
                onClick={() => {
                  store.setActivePageId(page.id);
                  store.setSelectedElementId(null);
                }}
                onDblClick={() => editingPageId() !== page.id && startRenamePage(page)}
                onContextMenu={(e) => store.editing() && openMenu(e, pageMenu(page))}
              >
                <Show
                  when={editingPageId() === page.id}
                  fallback={<span class="tab-title">{page.title}</span>}
                >
                  <input
                    type="text"
                    class="d-tab-rename-input"
                    value={pageTitleInput()}
                    onInput={(e) => setPageTitleInput(e.currentTarget.value)}
                    onBlur={finishRenamePage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') finishRenamePage();
                      if (e.key === 'Escape') setEditingPageId(null);
                    }}
                    ref={(el) => setTimeout(() => el.select())}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>

        {/* outside the scrolling list, so it stays in reach however many pages there are */}
        <Show when={store.editing()}>
          <button class="d-add-page-btn" title="New page" onClick={() => store.addPage()}>
            +
          </button>
        </Show>
      </footer>
    </div>
  );
};
