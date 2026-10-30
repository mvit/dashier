import { Component, For, Index, JSX, Show, createSignal, onMount } from 'solid-js';
import { DroppedField, dragField, dropProps } from '../runtime/dnd';
import { AggregationMethod, Compare, ShowAs, Units, ValueFormat } from '../types/model';
import { dismiss } from './ContextMenu';
import { SUMMARY_NAMES } from '../runtime/charts';
import type { DatePart } from '../runtime/dates';

export interface MenuOption {
  label: string;
  checked?: boolean;
  onSelect: () => void;
}

/** A group of choices in a field's menu, e.g. "Summarize" or "Show value as". */
export interface MenuSection {
  title?: string;
  options: MenuOption[];
}

/** A field placed in a well: a pill whose ▾ menu removes, renames, summarizes and formats it. */
export interface WellItem {
  key: string;
  label: string;
  /** Tooltip: where the field comes from. */
  title?: string;
  sections?: MenuSection[];
  onRemove: () => void;
  /** Set to offer "Rename for this visual"; `renameValue` is the current name. */
  onRename?: (name: string) => void;
  renameValue?: string;
  /** The field (or table) the pill stands for: dragging the pill carries it like a Data pane field. */
  drag: DroppedField;
}

/** A menu section of `[value, label]` choices, the current one checked. */
const choices = <T,>(title: string, current: T | undefined, list: [T | undefined, string][], onPick: (v: T | undefined) => void): MenuSection => ({
  title,
  options: list.map(([v, label]) => ({ label, checked: v ? current === v : !current, onSelect: () => onPick(v) }))
});

/** The Summarize choices for a field: numeric summaries for numbers, counts otherwise, plus "Don't summarize" where allowed. */
/**
 * The Summarize choices for a field. Numbers get the numeric summaries; text and dates are counted. Where a
 * single value is shown (`values`: a card, a text box variable, a table column, a matrix value), every field also
 * gets its most common, first and last value, and text and dates their minimum and maximum (alphabetical,
 * earliest/latest).
 */
export const summarizeSection = (
  current: AggregationMethod | undefined,
  numeric: boolean,
  onPick: (m: AggregationMethod | undefined) => void,
  opts: { allowNone?: boolean; values?: boolean } = {}
): MenuSection => {
  const any: AggregationMethod[] = opts.values ? ['mode', 'first', 'last'] : [];
  const methods: AggregationMethod[] = numeric
    ? ['sum', 'avg', 'min', 'max', 'median', 'stdev', 'var', 'count', 'distinct', ...any]
    : ['count', 'distinct', ...(opts.values ? (['min', 'max'] as const) : []), ...any];
  // "latest", from older files, is "last"
  return choices('Summarize', current === 'latest' ? 'last' : current, [...(opts.allowNone ? [undefined] : []), ...methods].map((m): [AggregationMethod | undefined, string] => [m, m ? SUMMARY_NAMES[m] : "Don't summarize"]), onPick);
};

/** Show value as: a share of the grand total, or (along an axis: charts, matrices) a running total. */
export const showAsSection = (current: ShowAs | undefined, onPick: (s: ShowAs | undefined) => void, running = false) =>
  choices('Show value as', current, [[undefined, 'No calculation'], ['percent-of-total', 'Percent of grand total'], ...(running ? [['running-total', 'Running total'] as [ShowAs, string]] : [])], onPick);

/** Number formats and display units, as every menu, dialog and pane offers them (unset first). */
export const FORMAT_CHOICES: [ValueFormat | undefined, string][] = [[undefined, 'Automatic'], ['number', 'Number (1.2K)'], ['integer', 'Whole number (1,234)'], ['currency', 'Currency ($)'], ['percent', 'Percent (%)']];
export const UNIT_CHOICES: [Units | undefined, string][] = [[undefined, 'None'], ['auto', 'Auto (K, M, B)'], ['thousands', 'Thousands (K)'], ['millions', 'Millions (M)'], ['billions', 'Billions (B)']];

/** Display units: amounts in thousands, millions or billions ($416.16B). */
export const unitsSection = (current: Units | undefined, onPick: (u: Units | undefined) => void) => choices('Display units', current, UNIT_CHOICES, onPick);

/** Dates: shown as they are, or grouped into months, quarters or years. */
export const dateSection = (current: DatePart | undefined, onPick: (p: DatePart | undefined) => void) =>
  choices('Group dates by', current, [[undefined, 'Date'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']], onPick);

/** Numbers in a table: a background color scale or data bars. */
export const condSection = (current: 'scale' | 'bars' | undefined, onPick: (c: 'scale' | 'bars' | undefined) => void) =>
  choices('Conditional formatting', current, [[undefined, 'None'], ['scale', 'Color scale'], ['bars', 'Data bars']], onPick);

export const formatSection = (current: string | undefined, onPick: (f: ValueFormat | undefined) => void) => choices('Format', current as ValueFormat | undefined, FORMAT_CHOICES, onPick);

/**
 * A value's comparison, in its menu: the same number for the previous period or the same period a year back (the
 * date filters reaching the visual, from slicers, the page or its own, moved), as the % change, the difference or that
 * number; for costs, lower is better.
 */
export function compareSections(c: Compare | undefined, onChange: (c?: Compare) => void, colored = true): MenuSection[] {
  return [
    choices<Compare['shift'] | ''>('Compare with', c ? c.shift ?? '' : undefined, [[undefined, 'Nothing'], ['period', 'Previous period'], ['year', 'Same period last year']], (shift) =>
      onChange(shift ? { ...c, shift, filters: undefined, label: undefined } : undefined)
    ),
    ...(c
      ? [
          choices<Compare['show']>('Show comparison as', c.show, [[undefined, '% change'], ['difference', 'Difference'], ['value', 'Its value']], (show) => onChange({ ...c, show })),
          // a card's or text's comparison is colored by direction; a chart's or matrix's isn't
          ...(colored ? [{ options: [{ label: 'Lower is better', checked: !!c.invert, onSelect: () => onChange({ ...c, invert: !c.invert || undefined }) }] }] : [])
        ]
      : [])
  ];
}

/** A drag event handled here: no default action, and no handler further up. */
const halt = (e: Event) => (e.preventDefault(), e.stopPropagation());

/** The dropdown under a pill. Fixed-positioned so the pane's scrolling and clipping don't cut it off. */
const FieldMenu: Component<{ item: WellItem; anchor: HTMLElement; onClose: () => void; onRename: () => void }> = (props) => {
  let menu!: HTMLDivElement;
  const r = props.anchor.getBoundingClientRect();
  const [pos, setPos] = createSignal({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 210) });

  onMount(() => {
    // flip above the pill / pull left when it would run off the window
    const m = menu.getBoundingClientRect();
    const top = m.bottom > innerHeight - 8 ? Math.max(8, r.top - m.height - 2) : r.bottom + 2;
    const left = Math.min(r.left, innerWidth - m.width - 8);
    setPos(p => ({ ...p, top, left }));

    // a click on the pill itself toggles the menu
    dismiss([menu, props.anchor], () => props.onClose());
  });

  const pick = (fn: () => void) => () => (fn(), props.onClose());

  return (
    <div class="d-field-menu" ref={menu} style={{ left: `${pos().left}px`, top: `${pos().top}px`, 'min-width': `${pos().width}px` }}>
      <button class="d-menu-item" onClick={pick(props.item.onRemove)}>Remove field</button>
      <Show when={props.item.onRename}>
        <button class="d-menu-item" onClick={pick(props.onRename)}>Rename for this visual</button>
      </Show>
      <For each={props.item.sections || []}>
        {(section) => (
          <>
            <div class="d-menu-sep" />
            <Show when={section.title}>
              <div class="d-menu-title">{section.title}</div>
            </Show>
            <For each={section.options}>
              {(o) => (
                <button class={`d-menu-item ${o.checked ? 'checked' : ''}`} onClick={pick(o.onSelect)}>
                  <span class="d-menu-check">{o.checked ? '✓' : ''}</span>
                  {o.label}
                </button>
              )}
            </For>
          </>
        )}
      </For>
    </div>
  );
};

/**
 * The pill being dragged. A pill drag carries its field like a Data pane drag, so every drop target accepts
 * it; dropped on another well it moves there, within a multi-field well it changes the order.
 */
let moving: { well: symbol; from: number; item: WellItem } | null = null;

// Dropped anywhere that isn't a field target, a pill is removed. While a pill is dragged the
// whole page accepts the drop, so a real drop fires `drop` here (targets stop theirs from reaching the
// document) while Esc fires none: cancelling leaves the field where it was.
const acceptOutside = (e: DragEvent) => {
  if (!moving || e.defaultPrevented) return; // over a real target: it decides
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'move';
};
const dropOutside = (e: DragEvent) => {
  if (!moving) return;
  e.preventDefault();
  const { item } = moving;
  moving = null;
  item.onRemove();
};
const endDrag = () => {
  moving = null;
  document.removeEventListener('dragover', acceptOutside);
  document.removeEventListener('drop', dropOutside);
};

const Pill: Component<{ item: WellItem; well: symbol; index: number; onMove?: (from: number, to: number) => void }> = (props) => {
  const [mark, setMark] = createSignal<'before' | 'after' | null>(null);
  // reordering: only pills of a multi-field well, only within that well
  const reordering = () => !!props.onMove && moving?.well === props.well;
  const half = (e: DragEvent) => (e.offsetY > (e.currentTarget as HTMLElement).offsetHeight / 2 ? 'after' : 'before');
  const drag = {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      moving = { well: props.well, from: props.index, item: props.item };
      dragField(e, props.item.drag);
      e.dataTransfer!.effectAllowed = 'copyMove';
      document.addEventListener('dragover', acceptOutside);
      document.addEventListener('drop', dropOutside);
      setOpen(false);
    },
    onDragEnd: endDrag,
    onDragOver: (e: DragEvent) => reordering() && (halt(e), setMark(half(e))), // other drags fall through to the well
    onDragLeave: () => setMark(null),
    onDrop: (e: DragEvent) => {
      if (!reordering()) return;
      halt(e);
      const { from } = moving!;
      const at = props.index + (half(e) === 'after' ? 1 : 0);
      moving = null;
      setMark(null);
      const to = at > from ? at - 1 : at;
      if (to !== from) props.onMove!(from, to);
    }
  };

  let pill!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);

  const commit = (value: string) => {
    setRenaming(false);
    if (value.trim() && value !== props.item.renameValue) props.item.onRename?.(value.trim());
  };

  return (
    <Show
      when={!renaming()}
      fallback={
        <input
          class="d-pill-rename"
          value={props.item.renameValue ?? props.item.label}
          ref={(el) => setTimeout(() => el.select())}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value);
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      }
    >
      <div
        class={`d-pill ${open() ? 'open' : ''} movable ${mark() ? `drop-${mark()}` : ''}`}
        ref={pill}
        title={props.item.title}
        onClick={() => setOpen(!open())}
        onContextMenu={(e) => (e.preventDefault(), setOpen(true))}
        {...drag}
      >
        <span class="d-pill-label">{props.item.label}</span>
        <span class="d-pill-caret">▾</span>
        <button class="d-pill-x" title="Remove field" onClick={(e) => (e.stopPropagation(), props.item.onRemove())}>×</button>
      </div>
      <Show when={open()}>
        <FieldMenu item={props.item} anchor={pill} onClose={() => setOpen(false)} onRename={() => setRenaming(true)} />
      </Show>
    </Show>
  );
};

/**
 * A field well: a label over a drop box that reads "Add data fields here" until a field
 * is dragged in from the Data pane. `children` replaces the empty text (e.g. for automatic values).
 */
export const FieldWell: Component<{
  label: JSX.Element;
  items: WellItem[];
  /** Takes a dropped field; returning false refuses it (a pill dragged from another well then stays put). */
  onDropField: (f: DroppedField) => boolean | void;
  /** Keeps the drop box visible below the pills (wells that hold several fields). */
  multiple?: boolean;
  /** Lets the user drag pills into a new order. */
  onReorder?: (from: number, to: number) => void;
  warn?: boolean;
  /** Takes whole tables too (a text box's variables); other wells don't offer to. */
  tables?: boolean;
  children?: JSX.Element;
}> = (props) => {
  const [over, setOver] = createSignal(false);
  const well = Symbol();
  let taken: boolean | void;
  const drop = dropProps((f) => (taken = props.onDropField(f)), setOver, props.tables);
  const onDrop = (e: DragEvent) => {
    const from = moving;
    moving = null;
    if (from?.well === well) {
      // dropped back on its own well: a multi-field well moves it to the end, others leave it
      halt(e);
      setOver(false);
      const last = props.items.length - 1;
      if (props.onReorder && from.from !== last) props.onReorder(from.from, last);
      return;
    }
    taken = false;
    drop.onDrop(e);
    if (from && taken !== false) from.item.onRemove(); // moved from another well of this visual
  };
  return (
    <div class="d-field-well">
      <div class="d-well-header"><label>{props.label}</label></div>
      <div
        class={`d-well-box d-droppable ${over() ? 'over' : ''} ${props.items.length ? 'filled' : ''} ${props.warn ? 'warn' : ''}`}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={onDrop}
      >
        <Index each={props.items}>{(item, i) => <Pill item={item()} well={well} index={i} onMove={props.onReorder} />}</Index>
        <Show when={!props.items.length || props.multiple}>
          <div class="d-well-empty">{props.children ?? 'Add data fields here'}</div>
        </Show>
      </div>
    </div>
  );
};
