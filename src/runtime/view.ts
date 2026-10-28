import { createRoot, createSignal, onCleanup } from 'solid-js';

/** Zoom steps for the −/+ buttons and Ctrl +/−. */
const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const MIN_ZOOM = ZOOMS[0];
export const MAX_ZOOM = ZOOMS[ZOOMS.length - 1];
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Anchor = { x: number; y: number };

/**
 * The report view's zoom, shared by the canvas (which applies it) and the status bar (which controls it).
 * The canvas registers how to zoom around a point, so zooming keeps what's under the pointer in place.
 */
export const view = createRoot(() => {
  const [zoom, setZoom] = createSignal(1);
  // "#fit" in the URL opens the page fitted to the window: a report embedded in a smaller frame, say
  const [fit, setFit] = createSignal<'page' | 'width' | null>(location.hash.slice(1).split(',').includes('fit') ? 'page' : null);
  let apply: (z: number, at?: Anchor) => void = (z) => setZoom(clampZoom(z));

  /** Zooms to `z` (leaving any fit mode), around `at` in client coordinates or the view's center. */
  const zoomTo = (z: number, at?: Anchor) => {
    setFit(null);
    apply(z, at);
  };

  const zoomStep = (dir: 1 | -1) => {
    const z = zoom();
    zoomTo((dir > 0 ? ZOOMS.find(v => v > z + 1e-3) : ZOOMS.filter(v => v < z - 1e-3).pop()) ?? z);
  };

  return {
    zoom,
    setZoom,
    fit,
    setFit,
    zoomTo,
    zoomStep,
    /** Called by the canvas with its anchored zoom. */
    bind: (fn: (z: number, at?: Anchor) => void) => (apply = fn)
  };
});

/** Calls `f` whenever `el` changes size, until the owner is disposed. */
export function observeSize(el: Element, f: ResizeObserverCallback) {
  const o = new ResizeObserver(f);
  o.observe(el);
  onCleanup(() => o.disconnect());
}
