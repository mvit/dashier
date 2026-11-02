/** Dragging a field (or a whole table) from the Data pane onto a slot. */
import type { AggregationMethod, ShowAs } from '../types/model';
const FIELD_MIME = 'application/x-dashier-field';
/** Also set on a whole table's drag: a slot that takes only fields refuses it while it's dragged over (what a drag
 * carries can't be read before the drop, only its types). */
const TABLE_MIME = 'application/x-dashier-table';

export interface DroppedField {
  table: string;
  /** Absent when a whole table was dragged. */
  field?: string;
  /** A value pill moved to another well brings its summary along. */
  aggregate?: AggregationMethod;
  showAs?: ShowAs;
}

export const dragField = (e: DragEvent, f: DroppedField) => {
  e.dataTransfer!.setData(FIELD_MIME, JSON.stringify(f));
  if (!f.field) e.dataTransfer!.setData(TABLE_MIME, f.table);
  e.dataTransfer!.effectAllowed = 'copy';
};

/**
 * Event handlers that make an element accept dragged fields (and, with `tables`, whole tables); `setOver` drives the
 * hover highlight. A drag it doesn't take shows no highlight and no drop cursor.
 */
export function dropProps(onDrop: (f: DroppedField) => void, setOver: (over: boolean) => void, tables = false) {
  // a drag carrying our field (or a table, where one is taken): claims it (no default handling)
  const take = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    return !!types?.includes(FIELD_MIME) && (tables || !types.includes(TABLE_MIME)) && (e.preventDefault(), true);
  };
  return {
    onDragOver: (e: DragEvent) => {
      if (!take(e)) return;
      e.dataTransfer!.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      if (!take(e)) return;
      e.stopPropagation(); // handled: a field pill dropped here isn't "dropped outside" (see FieldWell)
      setOver(false);
      let f: DroppedField | null = null;
      try {
        f = JSON.parse(e.dataTransfer!.getData(FIELD_MIME));
      } catch {}
      if (f) onDrop(f);
    }
  };
}

// Most touch browsers don't do HTML5 drag and drop, or not reliably, so a finger gets its own: hold a draggable a moment
// to pick it up, then carry it. The drag events are played to the same handlers a mouse's reach; a quick swipe still
// scrolls, and a second finger puts it down.
const HOLD = 300;
const SLOP = 10;
let drop: () => void = () => {};

addEventListener('touchstart', (start) => {
  drop();
  const source = (start.target as Element).closest?.('[draggable="true"]');
  if (!source || start.touches.length > 1) return;
  let at: Touch = start.touches[0];
  let over: Element | null = null;
  let ghost: HTMLElement | undefined;
  let moved = false;
  let taken = false;
  const data = new Map<string, string>();
  const dataTransfer = {
    get types() { return [...data.keys()]; },
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
    effectAllowed: '',
    dropEffect: ''
  };
  const fire = (type: string, el: Element) => {
    const r = el.getBoundingClientRect();
    const { clientX, clientY } = at;
    const e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX, clientY, offsetX: clientX - r.left, offsetY: clientY - r.top });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const place = () => ghost!.style.setProperty('translate', `${at.clientX}px ${at.clientY}px`);
  const lift = () => {
    fire('dragstart', source);
    ghost = document.createElement('div');
    ghost.className = 'd-pill d-drag-ghost';
    ghost.textContent = source.querySelector('.d-field-name, .d-card-title, .d-pill-label')?.textContent || source.textContent;
    place();
    source.closest('.ed-root')!.append(ghost);
  };
  const hold = setTimeout(lift, HOLD);
  const off = new AbortController();
  const end = (put: boolean) => {
    drop = () => {};
    clearTimeout(hold);
    off.abort();
    if (!ghost) return;
    if (over) fire(put && taken ? 'drop' : 'dragleave', over);
    fire('dragend', source);
    ghost.remove();
  };
  drop = () => end(false);
  const on = { signal: off.signal, capture: true, passive: false };
  addEventListener('touchmove', (e) => {
    at = e.touches[0];
    if (!ghost) {
      if (Math.hypot(at.clientX - start.touches[0].clientX, at.clientY - start.touches[0].clientY) > SLOP) end(false);
      return;
    }
    e.preventDefault();
    moved = true;
    place();
    const el = document.elementFromPoint(at.clientX, at.clientY);
    if (el !== over) {
      if (over) fire('dragleave', over);
      if (el) fire('dragenter', el);
      over = el;
    }
    taken = !!el && fire('dragover', el);
  }, on);
  addEventListener('touchend', () => end(true), on);
  addEventListener('touchcancel', () => end(false), on);
  // a browser's own drag would fight this one, and a long press that stays put is still a right-click
  addEventListener('dragstart', (e) => e.isTrusted && e.preventDefault(), on);
  addEventListener('contextmenu', (e) => (moved ? e.preventDefault() : end(false)), on);
}, { capture: true, passive: true });
