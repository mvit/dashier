import { DashFilter, DashMeasure, MeasureOp, MeasureOperand, MeasureWhere, ValueFormat } from '../types/model';
import { aggregate } from './charts';
import { Frame, filterFrame, tableFrame } from './frames';

/**
 * What a cell stands for, for measures of other tables: its visual's filters reach `frameOf(table)`, and `filters`
 * are the cell's own (the bar's category, the matrix row and column), each on its table.
 */
export interface MeasureCtx {
  filters: () => DashFilter[];
  frameOf: (table: string) => Frame;
}

/** A measure worked out over a frame's rows (and its cell, for other tables' measures); null when there's nothing to show. */
export type MeasureFn = (frame: Frame, ctx?: MeasureCtx) => number | null;

/** How measures reach other tables: the store's relationships. Without one, a measure sees only its own table. */
export interface MeasureEnv {
  /** The rows of `frame` (on `table`) that pass `f`, a filter on `table` or on a table connected to it. */
  narrow: (frame: Frame, table: string, f: DashFilter) => Frame;
  /** The rows of `table` for a cell: its visual's filters and the cell's own. */
  across: (table: string, ctx?: MeasureCtx) => Frame;
}

const LOCAL: MeasureEnv = { narrow: (frame, table, f) => (f.table && f.table !== table ? frame : filterFrame(frame, [f])), across: () => tableFrame() };

/** A measure's conditions as a list (`where` is one or several; all must hold). */
export const wheres = (m?: DashMeasure): MeasureWhere[] => (!m?.where ? [] : Array.isArray(m.where) ? m.where : [m.where]);

/** In a visual, a measure is written "[name]"; plain names are fields. */
export const isMeasureRef = (ref?: string): ref is string => !!ref && /^\[.+\]$/s.test(ref);
export const measureRef = (name: string) => `[${name}]`;
export const measureName = (ref: string) => (isMeasureRef(ref) ? ref.slice(1, -1) : ref);

export const OPS: [MeasureOp, string, string][] = [
  ['+', '+', 'plus'],
  ['-', '−', 'minus'],
  ['*', '×', 'times'],
  ['/', '÷', 'divided by'],
  ['pct-diff', '% difference from', '% difference from']
];

/** The format a measure shows in: its own, else percent for a % difference. */
export const measureFormat = (m?: DashMeasure): ValueFormat | undefined => m?.format ?? (m?.op === 'pct-diff' ? 'percent' : undefined);

/** Compiles a table's measure into a function of rows; null when it's missing, refers to something missing, or loops. */
export function compileMeasure(all: DashMeasure[], table: string, name: string, env: MeasureEnv = LOCAL, seen: string[] = []): MeasureFn | null {
  const m = all.find(x => x.table === table && x.name === name);
  const key = `${table}\u0000${name}`;
  if (!m || seen.includes(key)) return null;
  if (m.op) {
    const a = operand(all, table, m.a, env, [...seen, key]);
    const b = operand(all, table, m.b, env, [...seen, key]);
    if (!a || !b) return null;
    const calc = CALC[m.op];
    return (rows, ctx) => {
      const x = a(rows, ctx);
      const y = b(rows, ctx);
      return x == null || y == null ? null : calc(x, y);
    };
  }
  const only: DashFilter[] = wheres(m).filter(w => w.values?.length).map(w => ({ field: w.field, table: w.table, values: w.values }));
  return frame => aggregate(only.reduce((f, w) => env.narrow(f, table, w), frame), m.aggregate || 'sum', m.field);
}
const CALC: Record<MeasureOp, (x: number, y: number) => number | null> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => (y === 0 ? null : x / y),
  'pct-diff': (x, y) => (y === 0 ? null : (x - y) / Math.abs(y))
};

function operand(all: DashMeasure[], table: string, o: MeasureOperand | undefined, env: MeasureEnv, seen: string[]): MeasureFn | null {
  if (!o) return null;
  if (o.measure != null) {
    // another table's measure is worked out over that table's rows for the same cell
    const other = o.table && o.table !== table ? o.table : null;
    const fn = compileMeasure(all, other ?? table, o.measure, env, seen);
    return fn && other ? (_, ctx) => fn(env.across(other, ctx), ctx) : fn;
  }
  if (o.field != null) return frame => aggregate(frame, 'sum', o.field);
  return Number.isFinite(o.value) ? () => o.value! : null;
}

/** Why a measure can't be saved, or null. `fieldsOf` lists a table's column names. */
export function measureError(all: DashMeasure[], m: DashMeasure, fieldsOf: (table: string) => string[], replacing?: string): string | null {
  const name = m.name.trim();
  const fields = fieldsOf(m.table);
  if (!name) return 'Give the measure a name.';
  if (/[[\]]/.test(name)) return 'A measure name cannot contain [ or ].';
  if (fields.includes(name)) return `"${name}" is already a column of ${m.table}.`;
  // "[name]" works in any visual, so a name means one measure in the whole report
  const taken = all.find(x => x.name === name && !(x.table === m.table && x.name === replacing));
  if (taken) return `There is already a measure named "${name}"${taken.table === m.table ? '' : ` (on ${taken.table})`}.`;
  if (m.op) {
    for (const o of [m.a, m.b]) {
      if (!o || (o.measure == null && o.field == null && !Number.isFinite(o.value))) return 'Choose both values to calculate with.';
      if (o.field != null && !fields.includes(o.field)) return `${m.table} has no column "${o.field}".`;
    }
  } else {
    if (m.aggregate !== 'count' && !m.field) return 'Choose the field to summarize.';
    if (m.field && !fields.includes(m.field)) return `${m.table} has no column "${m.field}".`;
    for (const w of wheres(m)) if (!fieldsOf(w.table ?? m.table).includes(w.field)) return `${w.table ?? m.table} has no column "${w.field}".`;
  }
  // a measure that (through others) uses itself can't be worked out
  const others = all.filter(x => !(x.table === m.table && x.name === (replacing ?? name)));
  if (!compileMeasure([...others, { ...m, name }], m.table, name)) return 'This measure uses itself, or a measure that no longer exists.';
  return null;
}
