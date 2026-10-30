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
