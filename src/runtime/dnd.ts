/** Dragging a field (or a whole table) from the Data pane onto a slot. */
import type { AggregationMethod, ShowAs } from '../types/model';
const FIELD_MIME = 'application/x-dashier-field';

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
  e.dataTransfer!.effectAllowed = 'copy';
};

/** Event handlers that make an element accept dragged fields; `setOver` drives the hover highlight. */
export function dropProps(onDrop: (f: DroppedField) => void, setOver: (over: boolean) => void) {
  // a drag carrying our field: claims it (no default handling)
  const take = (e: DragEvent) => !!e.dataTransfer?.types.includes(FIELD_MIME) && (e.preventDefault(), true);
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
