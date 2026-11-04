import { createRoot, createSignal, onCleanup } from 'solid-js';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Anchor = { x: number; y: number };

/**
 * The report view's zoom, shared by the canvas (which applies it) and the status bar (which controls it).
 * The canvas registers how to zoom around a point, so zooming keeps what's under the pointer in place.
 */
export const view = createRoot(() => {
  const [zoom, setZoom] = createSignal(1);
  // the page opens as wide as the window allows, up to its own size ('auto'), centered; "#fit" in the URL fits the
  // whole page instead (a report embedded in a smaller frame, say). Any zoom picked by hand leaves either.
  const [fit, setFit] = createSignal<'page' | 'width' | 'auto' | null>(location.hash.slice(1).split(',').includes('fit') ? 'page' : 'auto');
  let apply: (z: number, at?: Anchor) => void = (z) => setZoom(clampZoom(z));

  /** Zooms to `z` (leaving any fit mode), around `at` in client coordinates or the view's center. */
  const zoomTo = (z: number, at?: Anchor) => {
    setFit(null);
    apply(z, at);
  };


  return {
    zoom,
    setZoom,
    fit,
    setFit,
    zoomTo,
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
