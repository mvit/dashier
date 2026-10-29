import { createSignal, createRoot, createMemo } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import {
  DashDocument,
  DashPage,
  DashElement,
  DashDataSource,
  DashFilter,
  DashRelationship,
  DashTheme,
  DashCanvas,
  DashMeasure,
  SlicerElement,
  TableColumn,
  ChartType,
  AggregationMethod,
  ShowAs,
  Compare,
  FieldType,
  WidgetType,
  isNumericType,
  resolveTheme,
  resolveCanvas
} from '../types/model';
import { renameInTemplate, templateVariables } from './template';
import { aggregate, aggregateValue, chartKind, comparison, formatValue, withUnits } from './charts';
import { columnsText, hydrateSource } from './hydrate';
import { blobOf, hold, holdBase64, holdText, isHeld, payloadText, release } from './payloads';
import { Lock, deriveLock, seal, unseal } from './crypt';
import { saveDocument, exportDocumentJSON, readEmbeddedDoc } from './save';
import { compareText, compareValues, keyText, replaceFilters, shiftFilters, sortText } from './data';
import { ColumnTable } from './columns';
import { Frame, distinctOf, filterFrame, frameRows, joinFrame, reader, tableFrame as makeTableFrame } from './frames';
import { DatePart, datePartKey, datePartLabel } from './dates';
import type { Order } from './charts';
import { MeasureCtx, MeasureEnv, wheres, compileMeasure, isMeasureRef, measureError, measureFormat, measureName, measureRef } from './measures';

export type FilterScope = 'doc' | 'page' | 'visual';

const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
/** Rows a text box template can list: enough for any readable text, far short of freezing the page on millions. */
const LIST_ROWS = 1000;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
/** The table columns, matrix rows and values of an element. */
/** Every filter list an element holds: its own, its card comparison's, its text bindings' comparisons'. */
const filterLists = (e: any): (DashFilter[] | undefined)[] => [e.filters, e.compare?.filters, ...Object.values(e.bindings || {}).map((b: any) => b.compare?.filters)];

function createDashboardStore() {
  const initialDoc = readEmbeddedDoc();

  const [doc, setDoc] = createStore<DashDocument>(initialDoc);
  // URL hash: "#preview" opens in preview, "#<page id>" opens that page, "#fit" fits the page to the window
  // ("#preview,fit,<page id>" for all three).
  const hash = location.hash.slice(1).split(',');
  const [activePageId, setActivePageId] = createSignal<string>((initialDoc.pages.find(p => hash.includes(p.id)) || initialDoc.pages[0])?.id || '');
  const [selectedElementId, setSelectedElementId] = createSignal<string | null>(null);

  // The editor is always on; preview hides the chrome and shows the sheet as a recipient would see it. A phone (under
  // 640px wide) is always in preview, with the page reflowed into one column (theme.css): it views and filters.
  // or a touch screen under 500px tall: a phone on its side
  const phone = matchMedia('(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)');
  const [preview, setPreviewSignal] = createSignal(hash.includes('preview') || phone.matches);
  // print mode shows every page as it will print; nothing is editable there
  const [printing, setPrintingSignal] = createSignal(false);
  const editing = () => !preview() && !printing();

  const [filtersPaneOpen, setFiltersPaneOpen] = createSignal(true);
  const [visualsPaneOpen, setVisualsPaneOpen] = createSignal(true);
  const [dataPaneOpen, setDataPaneOpen] = createSignal(true);
  const [visualTab, setVisualTab] = createSignal<'build' | 'format'>('build');

  // Editor chrome follows the user's own preference; the report has its own theme (doc.theme).
  const readUi = () => {
    try {
      const saved = localStorage.getItem('dashier-ui');
      if (saved) return saved === 'dark';
    } catch {}
    return matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [isDark, setIsDark] = createSignal(readUi());
  const reportTheme = createMemo(() => resolveTheme(doc.theme));
  const canvasSize = createMemo(() => resolveCanvas(doc.canvas));

  const [isDirty, setIsDirty] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [dataStore, setDataStore] = createSignal<Record<string, ColumnTable>>({});

  // --- Undo / Redo ---
  // Snapshots hold the doc minus sources as JSON, and the sources as plain objects, cached per version and
  // shared between snapshots. Payloads (possibly hundreds of MB) are strings, which can't change, so every
  // snapshot shares them instead of copying.
  type Src = Record<string, DashDataSource>;
  type Snap = { rest: string; src: Src };
  const undoStack: Snap[] = [];
  const redoStack: Snap[] = [];
  const [historyLen, setHistoryLen] = createSignal(0);
  const MAX_HISTORY = 50;
  let srcVer = 0;
  let srcCache: { v: number; s: Src } = { v: -1, s: {} };
  let lastKey = '';
  let lastTime = 0;

  const copySources = (src: Src): Src =>
    Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { ...v, structure: v.structure.map(c => ({ ...c })) }]));
  const srcSnap = () => (srcCache.v === srcVer ? srcCache.s : (srcCache = { v: srcVer, s: copySources(unwrap(doc.sources)) }).s);
  const snapshot = (): Snap => ({ rest: JSON.stringify({ ...doc, sources: undefined }), src: srcSnap() });
  const syncHistory = () => setHistoryLen(undoStack.length * 1000 + redoStack.length);

  /** Records an undo point. Calls sharing `key` within 1s coalesce (typing, dragging). */
  function pushHistory(key = '') {
    const now = Date.now();
    // a drag's key is its own: the whole gesture is one step however long it pauses
    if (!key || key !== lastKey || (now - lastTime > 1000 && !key.startsWith('drag:'))) {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
      syncHistory();
    }
    lastKey = key;
    lastTime = now;
    setIsDirty(true);
  }

  function restore(from: Snap[], to: Snap[]) {
    const snap = from.pop();
    if (!snap) return;
    to.push(snapshot());
    const next = JSON.parse(snap.rest);
    const sourcesChanged = snap.src !== srcSnap();
    next.sources = copySources(snap.src);
    setDoc(reconcile(next));
    srcVer++;
    lastKey = '';
    if (!doc.pages.some(p => p.id === activePageId())) setActivePageId(doc.pages[0]?.id || '');
    if (sourcesChanged) hydrate();
    setIsDirty(true);
    syncHistory();
  }

  const undo = () => restore(undoStack, redoStack);
  const redo = () => restore(redoStack, undoStack);

  // --- Data ---
  /** What a long load is doing ("Reading customers: 1,234,000 rows (62%)"), shown in the status bar and splash. */
  const [status, setStatus] = createSignal('');

  /** Reads one table's stored data into columns, keeping `status` up to date. */
  async function load(id: string) {
    try {
      const table = await hydrateSource(doc.sources[id], (s) =>
        setStatus(s.step === 'unpack' ? `Opening ${id}…` : `Reading ${id}: ${s.rows.toLocaleString()} rows (${Math.round(s.share * 100)}%)`)
      );
      setDataStore(prev => ({ ...prev, [id]: table }));
      columnize(id);
    } catch (err) {
      console.error(`[dashier] Couldn't read table "${id}":`, err);
    } finally {
      setStatus('');
    }
  }

  /**
   * Older files store a table as rows (CSV or JSON): it's rewritten as columns in the background after loading, and
   * saving and exporting wait for it (`columnar`), so only columns are ever written. A table changed meanwhile is
   * rewritten as it is then.
   */
  async function columnize(id: string) {
    try {
      for (let s; (s = doc.sources[id]) && s.format !== 'csv-columns'; ) {
        const { format, payload } = s;
        const columns = await holdText(await columnsText(await payloadText(payload), format));
        if (doc.sources[id]?.payload === payload) setDoc('sources', id, { payload: columns, format: 'csv-columns' });
      }
    } catch (err) {
      // data that can't be read is saved as it came: one bad table never blocks a save
      console.warn(`[dashier] Kept table "${id}" as it was stored:`, err);
    }
  }
  const columnar = () => Promise.all(Object.keys(doc.sources).map(columnize));

  async function hydrate() {
    // tables an undo took away (or renamed) leave no data behind
    setDataStore(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => isTable(k))));
    // filters from older files name only a field: they get the table it is in (a visual's own, else one it looks up),
    // when that's clear. A page or report filter on a name several tables share keeps applying to each.
    const owner = (field: string, from?: string) =>
      from && hasField(from, field) ? from : (from ? relationshipsOf(from).map(r => r.other.table) : Object.keys(doc.sources)).filter(t => hasField(t, field)).find((t, _, all) => all.length === 1);
    const own = (fs: DashFilter[] | undefined, from?: string) => fs?.forEach(f => f.table || !(f.table = owner(f.field, from)) && delete f.table);
    if ([doc.filters, ...doc.pages.flatMap(p => [p.filters, ...p.elements.map(e => e.filters)])].some(fs => fs?.some(f => !f.table))) {
      edit('filters', fs => own(fs));
      edit('pages', pages => pages.forEach(p => (own(p.filters), p.elements.forEach(e => own(e.filters, e.sourceId)))));
    }
    for (const id of Object.keys(doc.sources)) {
      // payloads straight from a file (or Open JSON) are base64 text: keep them as bytes outside the JS heap
      if (!isHeld(doc.sources[id].payload)) setDoc('sources', id, 'payload', await holdBase64(doc.sources[id].payload));
      await load(id);
    }
  }

  /** All rows of a table, as a frame over its columns (an empty frame for an unknown table). */
  function tableFrame(id?: string): Frame {
    return makeTableFrame(id ? dataStore()[id] : undefined);
  }

  /** A filter (or a slicer's selection) that picks something: values, bounds, dates or the last n. */
  const active = (f: Partial<DashFilter>) => !!(f.values?.length || f.min != null || f.max != null || f.from || f.to || f.last);

  type Hop = ReturnType<typeof relationshipsOf>[number];

  /** How many non-blank keys of a table's column repeat (compared as relationship keys are). */
  function repeats(table: string, field: string): number {
    // every non-blank value is keyed once: those beyond the distinct ones are repeats
    let n = 0;
    const d = distinctOf(tableFrame(table), field, v => (n++, keyText(v))).length;
    return n - d;
  }


  /** True when `table` is a lookup (one) side of relationship `index` (see DashRelationship's cardinality). */
  const isOneSide = (index: number, table: string) => {
    const r = doc.relationships?.[index];
    return !!r && r.cardinality !== 'many-to-many' && (r.cardinality === 'one-to-one' || r.to.table === table);
  };
  /** True when filters flow from `table` across relationship `index`: from `to`, both ways for "both" and 1:1. */
  const flowsFrom = (index: number, table: string) => {
    const r = doc.relationships![index];
    return r.to.table === table || r.crossFilter === 'both' || r.cardinality === 'one-to-one';
  };

  /**
   * Breadth first from `from` (a filter on its `field`) over the relationships `ok` lets through, leaving out
   * relationship `skip`: each table reached, with the hops on the nearest way there and the field it arrives on.
   */
  function walk(from: string, ok: (hop: Hop, field: string) => boolean, field = '', skip = -1) {
    const ways = new Map([[from, { field, path: [] as Hop[] }]]);
    // a Map visits entries added while it is iterated: breadth first
    for (const [table, { field, path }] of ways)
      for (const hop of relationshipsOf(table))
        if (hop.index !== skip && !ways.has(hop.other.table) && ok(hop, field)) ways.set(hop.other.table, { field: hop.other.field, path: [...path, hop] });
    return ways;
  }

  /**
   * The relationships a filter on `field` of `from` crosses to reach `to`, or undefined when it can't. Filters flow
   * from a relationship's one side (`to`) to its many side, and back too with crossFilter "both"; a filter on the
   * linked field itself crosses either way, as the same values.
   */
  const filterPath = (from: string, field: string, to: string) =>
    walk(from, (hop, f) => hop.mine.field === f || flowsFrom(hop.index, hop.mine.table), field).get(to)?.path;

  /** The relationships from `from` to `to`, in either direction (for reading another table's fields), nearest first. */
  const joinPath = (from: string, to: string) => walk(from, () => true).get(to)?.path;

  /** Tables connected to `from` (itself included), directly or through others, leaving out relationship `skip`. */
  const reachable = (from: string, skip = -1) => new Set(walk(from, () => true, '', skip).keys());

  /** The keys (in `field`) of `table`'s rows that pass `f`; kept until the data changes. */
  const keyCache = createMemo(() => (dataStore(), new Map<string, string[]>()));
  function keysOf(table: string, f: DashFilter, field: string): string[] {
    const id = `${table}\u0000${field}\u0000${JSON.stringify(f)}`;
    let keys = keyCache().get(id);
    if (!keys) keyCache().set(id, (keys = distinctOf(filterFrame(tableFrame(table), [f]), field, keyText)));
    return keys;
  }

  /**
   * A filter as it applies to a frame on `sourceId`: on its own column, or carried there through relationships
   * (see filterPath) as the keys of the rows that pass it. Undefined when it doesn't reach the table.
   */
  function filterOn(sourceId: string | undefined, f: DashFilter): DashFilter | undefined {
    if (!sourceId || !active(f)) return undefined;
    // without a table (older files): this table if it has the field, else one that has it and reaches this one
    const from = f.table ?? (hasField(sourceId, f.field) ? sourceId : Object.keys(doc.sources).find(t => hasField(t, f.field) && filterPath(t, f.field, sourceId)));
    if (!from || !hasField(from, f.field)) return undefined;
    if (from === sourceId) return f;
    const path = filterPath(from, f.field, sourceId);
    let g: DashFilter = f;
    let at = from;
    for (const hop of path ?? []) {
      // a filter on the linked field crosses as itself; any other as its rows' keys (none passing: no key matches)
      const keys = hop.mine.field === g.field ? null : keysOf(at, g, hop.mine.field);
      g = keys ? { table: hop.other.table, field: hop.other.field, values: keys.length ? keys : ['\u0000'], match: 'key' } : { ...g, table: hop.other.table, field: hop.other.field, match: 'key' };
      at = hop.other.table;
    }
    return path ? g : undefined;
  }

  /**
   * Visits each field an element reads (mapping, aggregation, comparison, slicer field, table and matrix fields)
   * with a setter: a new name (a column header that showed the old name follows), or none to remove it.
   */
  const eachRef = (e: any, fn: (field: string, set: (to?: string) => void) => void) => {
    for (const k of Object.keys(e.mapping || {})) if (e.mapping[k]) fn(e.mapping[k], t => (t ? (e.mapping[k] = t) : delete e.mapping[k]));
    for (const o of [e.aggregation, e.compare]) if (o?.field) fn(o.field, t => (o.field = t));
    // a slicer loses its pick with its field
    if (e.type === 'slicer' && e.field) fn(e.field, t => (e.field = t) || (e.selection = undefined));
    for (const key of ['columns', 'rows', 'values'])
      for (const c of e[key] || []) fn(c.field, t => (t ? ((c.label === c.field && (c.label = t)), (c.field = t)) : (e[key] = e[key].filter((x: any) => x !== c))));
  };
  /** Rewrites every field name an element reads. */
  const mapRefs = (e: any, fn: (field: string) => string) => eachRef(e, (f, set) => set(fn(f)));
  /** Removes the field references `gone` picks from an element. */
  const dropRefs = (e: any, gone: (field: string) => boolean) => eachRef(e, (f, set) => gone(f) && set());
  /** Field names an element reads. */
  const fieldRefs = (e: any) => {
    const out: string[] = [];
    eachRef(e, f => out.push(f));
    return out;
  };

  /**
   * The base table's rows, merged with each table whose "table.field" columns the element uses, and the tables on
   * the way to it. A relationship's one side (`to`) is a lookup: a repeated key matches its first row, never two.
   */
  function joinedFrame(elem: DashElement): Frame {
    let frame = tableFrame(elem.sourceId);
    const home = elem.sourceId;
    if (!home) return frame;
    const refs = fieldRefs(elem);
    const joined = new Set([home]); // one join per table
    for (const t of Object.keys(doc.sources))
      if (t !== home && refs.some(f => f.startsWith(t + '.')))
        for (const hop of joinPath(home, t) ?? []) {
          const other = dataStore()[hop.other.table];
          if (!other || joined.has(hop.other.table)) continue;
          joined.add(hop.other.table);
          const left = hop.mine.table === home ? hop.mine.field : `${hop.mine.table}.${hop.mine.field}`;
          frame = joinFrame(frame, left, other, hop.other.field, hop.other.table, isOneSide(hop.index, hop.other.table));
        }
    return frame;
  }

  /** The picks of the active page's slicers, as filters (`skip`: a slicer that shouldn't filter itself). */
  function slicerFilters(page: DashPage | undefined, skip?: string): DashFilter[] {
    return (page?.elements || []).flatMap(e => {
      const { field, datePart, selection: sel } = e as SlicerElement;
      return e.type === 'slicer' && field && e.id !== skip && sel && active(sel)
        ? [{ field, table: e.sourceId, datePart, ...sel }]
        : [];
    });
  }

  /** The page each visual sits on: a visual's filters and slicers are those of its own page (print shows them all). */
  const pageByElement = createMemo(() => new Map(doc.pages.flatMap(p => p.elements.map(e => [e.id, p] as const))));
  const pageFor = (elem: DashElement) => pageByElement().get(elem.id) || getActivePage();

  /** Applies report-, page-, slicer- and visual-level filters (which follow relationships) to a frame on `sourceId`. */
  const filterRows = (sourceId: string | undefined, frame: Frame, filters: DashFilter[]) => filterFrame(frame, filters.flatMap(f => filterOn(sourceId, f) ?? []));

  /**
   * Every filter on a visual: the report's, its page's and its page's slicers' (but `skip`), then its own. A
   * comparison's stand-in for the visual carries its whole list instead (`whole`).
   */
  function filtersOf(elem: DashElement, skip?: string): DashFilter[] {
    const page = pageFor(elem);
    return (elem as any).whole ? elem.filters || [] : [...(doc.filters || []), ...(page?.filters || []), ...slicerFilters(page, skip), ...(elem.filters || [])];
  }

  /** What an element reads: its table's rows after joins and filters, as a frame (positions, not row copies). */
  function getFrame(elem: DashElement): Frame {
    return filterRows(elem.sourceId, joinedFrame(elem), filtersOf(elem));
  }

  /**
   * What a slicer offers: its field's distinct values after every other filter (its own pick excluded),
   * and the field's full numeric range for range slicers.
   */
  function slicerOptions(elem: SlicerElement): { values: string[]; min?: number; max?: number } {
    if (!elem.field) return { values: [] };
    const all = tableFrame(elem.sourceId);
    const frame = filterRows(elem.sourceId, all, filtersOf(elem, elem.id));
    const { field, datePart } = elem;
    const values = sortText(distinctOf(frame, field, datePart ? (v) => datePartKey(String(v), datePart) : String));
    const cmp = !datePart && sortOrder(elem.sourceId, field);
    if (cmp) values.sort(cmp);
    const bound = (m: 'min' | 'max') => (refType(elem.sourceId, field) === 'datetime' ? undefined : aggregate(all, m, field) ?? undefined);
    return { values, min: bound('min'), max: bound('max') };
  }

  /** Sets what a slicer's viewer picked. It's view state: no undo step, and the file isn't marked unsaved. */
  function setSlicerSelection(pageId: string, elementId: string, selection: SlicerElement['selection']) {
    const [pi, ei] = locate(pageId, elementId);
    if (ei === -1) return;
    // nothing picked (no values, bounds or dates) is no filter
    setDoc('pages', pi, 'elements', ei, 'selection' as any, selection && active(selection) ? clone(selection) : undefined);
  }

  /**
   * Where a template variable gets its value from, for the slot list: a binding the user made, else
   * `rows` (the Source table), a table of that name, `title` or `page`; otherwise it is unbound.
   */
  function variableSource(elem: DashElement, name: string): { kind: 'bound' | 'auto' | 'unbound'; label: string } {
    const b = (elem as any).bindings?.[name];
    const auto = (label: string) => ({ kind: 'auto' as const, label });
    if (b) return { kind: 'bound', label: b.field ? `${b.table}.${b.field}` : `${b.table} (all rows)` };
    if (name === 'rows') return elem.sourceId ? auto(`Source table: ${elem.sourceId}`) : { kind: 'unbound', label: 'no Source table set' };
    if (isTable(name)) return auto(`table ${name}`);
    if (name === 'title') return auto('the dashboard title');
    if (name === 'page') return auto('the page title');
    return { kind: 'unbound', label: 'drop a field here' };
  }

  /**
   * One value for `e` (a card, or a text box for its binding on `table`): `field`, a measure or summarized by
   * `method`, over the rows `e`'s filters leave. No rows: nothing to sum, but a count of none is 0.
   */
  function valueOf(e: DashElement, table: string | undefined, field?: string, method: AggregationMethod = 'sum') {
    const frame = getFrame({ ...e, sourceId: table } as DashElement);
    const m = measureInfo(table, field, e);
    return m ? m.fn(frame) : frame.length ? aggregateValue(frame, method, field) : method === 'count' || method === 'distinct' ? 0 : null;
  }

  /** The stand-in for `e` that comparison `c` reads: its filters with the date ones moved and `c.filters` in place. */
  const standIn = (e: DashElement, c: Compare) => ({ ...e, filters: replaceFilters(filtersOf(e), compareChanges(e, c)), whole: true }) as unknown as DashElement;

  /** That value compared as `c` says (other filters, or `c.field`): "+6.4%"; null with nothing to compare with. */
  function comparedOf(e: DashElement, table: string | undefined, field: string | undefined, method: AggregationMethod | undefined, c: Compare, format?: string) {
    if (!compareChanges(e, c).length && !c.field) return null;
    return comparison(valueOf(e, table, field, method), valueOf(standIn(e, c), table, c.field || field, method), c.show, format);
  }

  /**
   * What a chart or matrix compares each category or cell with: the stand-in's rows, measures over them, and whether
   * any filter moved (if not, only a date axis or header moving makes it another period).
   */
  function comparedView(e: DashElement, c: Compare) {
    const o = standIn(e, c);
    return { frame: getFrame(o), measure: (ref: string) => measureInfo(o.sourceId, ref, o), moved: !!(compareChanges(e, c).length || c.field) };
  }

  /**
   * Variables for a text box's template, after the same filters the charts use: the user's bindings
   * (a field gives that column's values, a table its rows), else `rows`, tables by name, `title`, `page`.
   */
  function templateVars(elem: DashElement): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    const page = pageFor(elem);
    const rowsOf = (table: string) => filterRows(table, tableFrame(table), filtersOf(elem));
    // a field's values as an array, a whole table as row objects (only when a template uses it), first LIST_ROWS only:
    // a text box listing millions of rows would freeze the page
    const values = (frame: Frame, field: string) => {
      const read = reader(frame, field);
      return read ? Array.from({ length: Math.min(frame.length, LIST_ROWS) }, (_, k) => read(k)) : [];
    };
    const rows = (frame: Frame) => frameRows(frame, 0, LIST_ROWS);
    for (const name of templateVariables((elem as any).content || '').all) {
      const b = (elem as any).bindings?.[name];
      if (b && isTable(b.table)) {
        const mi = measureInfo(b.table, b.field, elem);
        const format = withUnits(b.format || mi?.format, b.units);
        if (b.compare) vars[name] = comparedOf(elem, b.table, b.field, b.aggregate, b.compare, format)?.text ?? '—';
        else if (mi || b.aggregate) {
          const v = valueOf(elem, b.table, b.field, b.aggregate);
          vars[name] = v === null ? '—' : format ? formatValue(v, format) : v;
        } else vars[name] = b.field ? values(rowsOf(b.table), b.field) : rows(rowsOf(b.table));
      }
      else if (name === 'rows' && elem.sourceId) vars[name] = rows(rowsOf(elem.sourceId));
      else if (isTable(name)) vars[name] = rows(rowsOf(name));
      else if (name === 'title') vars[name] = doc.title;
      else if (name === 'page') vars[name] = page?.title;
    }
    return vars;
  }

  /**
   * How a visual on `sourceId` refers to a field of `table`: the plain name for its own table,
   * "table.field" for a connected table, or null when the tables aren't connected.
   */
  function fieldRef(sourceId: string | undefined, f: { table: string; field: string }): string | null {
    if (!sourceId || f.table === sourceId) return f.field;
    return joinPath(sourceId, f.table) ? `${f.table}.${f.field}` : null;
  }

  /** True for a table's name (and never for a name every object has, like "constructor"). */
  const isTable = (name: string) => Object.hasOwn(doc.sources, name);
  const fieldsOf = (sourceId?: string) => (sourceId && isTable(sourceId) && doc.sources[sourceId].structure) || [];
  const hasField = (table: string, name: string) => fieldsOf(table).some(c => c.name === name);

  // --- Document ---
  // entering preview or print mode drops the selection
  const deselecting = (set: (on: boolean) => void) => (on: boolean) => {
    set(on);
    if (on) setSelectedElementId(null);
  };
  const setPrinting = deselecting(setPrintingSignal);
  const setPreview = deselecting(setPreviewSignal);
  phone.onchange = (e) => setPreview(e.matches);

  /**
   * Prints every page, one per sheet: lays them all out (off screen), lets the charts draw at their size, then
   * opens the browser's print dialog. Printing ends when the browser says so (Esc ends it too).
   */
  async function print() {
    if (printing()) return;
    setPrinting(true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    addEventListener('afterprint', () => setPrinting(false), { once: true });
    window.print();
  }

  function setTitle(newTitle: string) {
    pushHistory('title');
    setDoc('title', newTitle);
  }

  /** Editor light/dark — a personal preference, not part of the document. */
  function toggleUi() {
    setIsDark(d => !d);
    try {
      localStorage.setItem('dashier-ui', isDark() ? 'dark' : 'light');
    } catch {}
  }

  /** Patches the report theme; `undefined` values reset a key to its default. `replace` swaps the whole theme (presets). */
  function setTheme(patch: DashTheme, replace = false) {
    pushHistory(replace ? '' : `theme:${Object.keys(patch).join()}`);
    setDoc('theme', reconcile(clone(replace ? patch : { ...doc.theme, ...patch })));
  }

  /** Sets the report page's fixed size (px). */
  function setCanvas(size: DashCanvas) {
    const next = resolveCanvas(size);
    if (next.width === canvasSize().width && next.height === canvasSize().height) return;
    pushHistory('canvas');
    setDoc('canvas', next);
  }

  // --- Pages ---
  const pageIndex = (pageId: string) => doc.pages.findIndex(p => p.id === pageId);

  function getActivePage(): DashPage | undefined {
    return doc.pages.find(p => p.id === activePageId()) || doc.pages[0];
  }

  function addPage() {
    pushHistory();
    const id = uid('page');
    let n = doc.pages.length + 1;
    while (doc.pages.some(p => p.title === `Page ${n}`)) n++;
    setDoc('pages', pages => [...pages, { id, title: `Page ${n}`, elements: [] }]);
    setActivePageId(id);
    setSelectedElementId(null);
  }

  function renamePage(pageId: string, title: string) {
    const idx = pageIndex(pageId);
    if (idx === -1 || doc.pages[idx].title === title) return;
    pushHistory();
    setDoc('pages', idx, 'title', title);
  }

  function duplicatePage(pageId: string) {
    const page = doc.pages[pageIndex(pageId)];
    if (!page) return;
    pushHistory();
    const copy: DashPage = { ...clone(page), id: uid('page'), title: `${page.title} (Copy)` };
    copy.elements.forEach(e => (e.id = uid('elem')));
    setDoc('pages', pages => [...pages, copy]);
    setActivePageId(copy.id);
  }

  function deletePage(pageId: string) {
    if (doc.pages.length <= 1) return;
    pushHistory();
    setDoc('pages', pages => pages.filter(p => p.id !== pageId));
    if (activePageId() === pageId) setActivePageId(doc.pages[0].id);
  }

  // --- Elements ---
  function locate(pageId: string, elementId: string): [number, number] {
    const pi = pageIndex(pageId);
    return [pi, pi === -1 ? -1 : doc.pages[pi].elements.findIndex(e => e.id === elementId)];
  }

  function getSelectedElement(): DashElement | null {
    const id = selectedElementId();
    return (id && getActivePage()?.elements.find(e => e.id === id)) || null;
  }

  /** First free row below every element on the page. */
  function nextRow(pageId: string) {
    return Math.max(0, ...(doc.pages[pageIndex(pageId)]?.elements || []).map(e => e.y + e.h));
  }

  function addElement(pageId: string, element: DashElement) {
    const pi = pageIndex(pageId);
    if (pi === -1) return;
    pushHistory();
    setDoc('pages', pi, 'elements', elems => [...elems, element]);
    setSelectedElementId(element.id);
    // a new visual can land below the view: bring it in
    requestAnimationFrame(() => document.querySelector(`[data-id="${element.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  /** Adds an empty visual of `type`; its fields come from what the user drags into it. */
  function createElement(type: WidgetType, chartType?: ChartType): DashElement {
    const pageId = activePageId();
    const base = { id: uid('elem'), x: 0, y: nextRow(pageId) };
    const el: DashElement =
      type === 'card'
        ? { ...base, type, w: 3, h: 2, aggregation: { method: 'sum' }, compare: { shift: 'period' } }
        : type === 'table' || type === 'matrix'
          ? { ...base, type, w: 8, h: 5 }
          : type === 'markdown'
            ? { ...base, type, w: 4, h: 3, content: '' }
            : type === 'slicer'
              ? { ...base, type, w: 3, h: 3 }
              : { ...base, type: 'chart', chartType: chartType || 'bar', w: 6, h: 4, mapping: {} };
    addElement(pageId, el);
    return el;
  }


  function updateElement(pageId: string, elementId: string, updates: Partial<DashElement>, historyKey?: string) {
    const [pi, ei] = locate(pageId, elementId);
    if (ei === -1) return;
    pushHistory(historyKey ?? `el:${elementId}:${Object.keys(updates).join()}`);
    setDoc('pages', pi, 'elements', ei, updates as any);
  }

  /**
   * Visualizations-pane gallery: switches the selected visual's type, carrying over its title, position,
   * table and the fields that still make sense (nothing is filled in that the user didn't choose).
   */
  function transformSelectedVisual(targetType: WidgetType, targetChartType?: ChartType) {
    const elem = getSelectedElement() as any;
    if (!elem) return;
    const m = elem.type === 'matrix' ? elem : undefined;
    const row = m?.rows?.[0];
    const col = m?.columns?.[0];
    // What carries over: a value, a category (a chart's axis, a scatter's details, a matrix's first row field) and
    // a legend (a matrix's first column field). A scatter's x is a number, so a category becomes its details.
    const fromScatter = elem.type === 'chart' && chartKind(elem.chartType) === 'scatter';
    const field = elem.mapping?.y || elem.aggregation?.field || m?.values?.[0]?.field || (elem.type === 'slicer' ? elem.field : undefined);
    const cat = fromScatter ? elem.mapping?.detail : elem.mapping?.x ?? row?.field;
    const catPart = fromScatter ? elem.dateParts?.detail : elem.dateParts?.x ?? row?.datePart;
    const group = elem.mapping?.group ?? col?.field;
    const groupPart = elem.dateParts?.group ?? col?.datePart;
    const keep = { id: elem.id, x: elem.x, y: elem.y, w: elem.w, h: elem.h, title: elem.title, filters: elem.filters, sourceId: field || cat || elem.mapping?.x ? elem.sourceId : undefined };
    // the value's summary: a chart's, a card's, a matrix's first value's (fitted to the field where it moves)
    const agg: AggregationMethod | undefined = elem.summary?.aggregate ?? elem.aggregation?.method ?? m?.values?.[0]?.aggregate;
    let next: DashElement;
    if (targetType === 'chart') {
      const toScatter = targetChartType === 'scatter';
      const x = !toScatter ? cat : fromScatter ? elem.mapping?.x : cat && isNumericRef(elem.sourceId, cat) ? cat : undefined;
      const detail = toScatter && x !== cat ? cat : undefined;
      const combo = targetChartType === 'combo' && elem.chartType === 'combo';
      next = {
        ...keep, type: 'chart', chartType: targetChartType || 'bar', mapping: { x, y: field, group, detail, line: combo ? elem.mapping.line : undefined },
        dateParts: { x: toScatter ? undefined : catPart, group: groupPart, detail: detail && catPart }, options: elem.options,
        summary: agg || elem.summary?.showAs ? { aggregate: agg, showAs: elem.summary?.showAs } : undefined,
        lineSummary: combo ? elem.lineSummary : undefined, xSummary: toScatter && fromScatter ? elem.xSummary : undefined
      };
    } else if (targetType === 'matrix') {
      // a table's plain columns become rows and its summarized ones values; a chart's axis rows, its legend columns
      const cols: TableColumn[] = elem.type === 'table' ? elem.columns ?? [] : [];
      const summed = (c: TableColumn) => !!c.aggregate || isMeasureRef(c.field);
      next =
        elem.type === 'table'
          ? {
              ...keep, sourceId: cols.length ? elem.sourceId : undefined, type: 'matrix',
              rows: cols.filter(c => !summed(c)).map(c => ({ field: c.field, datePart: c.datePart })),
              values: cols.filter(summed).map(c => ({ field: c.field, aggregate: c.aggregate, showAs: c.showAs, format: c.format === 'date' || c.format === 'string' ? undefined : c.format, cond: c.cond }))
            }
          : {
              ...keep, type: 'matrix',
              rows: cat ? [{ field: cat, datePart: catPart }] : [],
              columns: group ? [{ field: group, datePart: groupPart }] : [],
              values: field ? [{ field, aggregate: agg, showAs: elem.summary?.showAs }] : []
            };
    } else if (targetType === 'card') {
      const method = field ? fitMethod(agg ?? 'sum', describeRef(elem.sourceId, field), true) : agg ?? 'sum';
      next = { ...keep, type: 'card', aggregation: { method, field }, format: elem.format ?? elem.options?.format ?? m?.values?.[0]?.format };
    } else if (targetType === 'table' && m) {
      // a matrix's row and column fields become plain columns, its values summarized ones
      const plain = [...(m.rows ?? []), ...(m.columns ?? [])].map(f => ({ field: f.field, label: f.field, datePart: f.datePart }));
      const values = (m.values ?? []).map((v: any) => ({ field: v.field, label: v.field, align: 'right' as const, aggregate: isMeasureRef(v.field) ? undefined : v.aggregate ?? 'sum', showAs: v.showAs, format: v.format, cond: v.cond }));
      next = { ...keep, type: 'table', columns: [...plain, ...values] };
    } else if (targetType === 'table') {
      // a chart's category and legend become plain columns, its value a summarized one
      const col = (f: string, datePart?: DatePart) => ({ field: f, label: f, datePart, align: alignOf(refType(elem.sourceId, f)) });
      const columns = [cat && col(cat, catPart), group && col(group, groupPart), field && { ...col(field), align: 'right' as const, aggregate: isMeasureRef(field) ? undefined : agg ?? 'sum', showAs: elem.summary?.showAs }].filter(Boolean);
      next = { ...keep, type: 'table', columns: columns.length ? columns : undefined, sourceId: columns.length ? keep.sourceId : undefined };
    } else if (targetType === 'slicer') {
      const sf = cat || elem.mapping?.x || field;
      const own = sf && !sf.includes('.') ? sf : undefined; // a slicer reads its own table only
      next = { ...keep, sourceId: own && elem.sourceId, type: 'slicer', field: own };
    } else {
      next = { ...keep, sourceId: undefined, type: 'markdown', content: elem.content || '' };
    }
    const [pi, ei] = locate(activePageId(), elem.id);
    pushHistory();
    setDoc('pages', pi, 'elements', ei, reconcile(clone(next)));
  }

  type Slot = 'x' | 'y' | 'group' | 'line' | 'detail' | 'field' | 'column' | 'row' | 'col' | 'value';
  const matrixList = (slot: Slot) => (slot === 'row' ? 'rows' : slot === 'col' ? 'columns' : 'values');

  const alignOf = (type?: FieldType) => (isNumericType(type) ? 'right' : 'left') as 'right' | 'left';
  const defaultColumns = (sourceId: string) => fieldsOf(sourceId).map(f => ({ field: f.name, label: f.name, align: alignOf(f.type) }));

  /** A note about the last drop (shown in the Visualizations pane): why a field was refused. */
  const [dropNote, setDropNote] = createSignal('');

  /**
   * Puts a dragged field into one of a visual's slots. The first field decides which table the visual reads
   * from; later fields must come from that table or one connected to it (they arrive as "table.field").
   * A refused field leaves a note and changes nothing.
   */
  function assignField(elem: DashElement, slot: Slot, f: { table: string; field: string; aggregate?: AggregationMethod; showAs?: ShowAs }): boolean {
    const e = elem as any;
    const scatter = e.type === 'chart' && chartKind(e.chartType) === 'scatter';
    if (isMeasureRef(f.field)) {
      // a measure is a number of its own table: it goes in value wells only (both of a scatter's axes are values)
      if (e.type === 'slicer' || !['y', 'line', 'field', 'column', 'value', ...(scatter ? ['x'] : [])].includes(slot)) {
        setDropNote('A measure is a number: drop it on values, columns or a card.');
        return false;
      }
      if (e.sourceId && fieldRefs(e).length && f.table !== e.sourceId && !joinPath(e.sourceId, f.table)) {
        setDropNote(`"${f.table}" isn't connected to "${e.sourceId}", so its measures can't be worked out here. Connect them under Edit Data… → Connections.`);
        return false;
      }
    }
    if (e.type === 'slicer') {
      // a slicer has a single field: a new one replaces it, from any table
      setDropNote('');
      updateElement(activePageId(), e.id, { sourceId: f.table, field: f.field, selection: undefined, datePart: isDateField(f) ? 'month' : undefined } as any, `field:${e.id}:slicer`);
      return true;
    }
    if (scatter && (slot === 'x' || slot === 'y') && !isMeasureRef(f.field) && !isNumericType(typeOf(f))) {
      setDropNote('A scatter chart\'s axes are numbers. Drop text or dates on Legend or Details.');
      return false;
    }
    const empty = fieldRefs(e).length === 0; // nothing placed yet: any table may start the visual
    // a measure is "[name]" wherever it's used
    const ref = empty || !e.sourceId || isMeasureRef(f.field) ? f.field : fieldRef(e.sourceId, f);
    if (ref === null) {
      setDropNote(`"${f.table}" isn't connected to "${e.sourceId}". Connect them under Edit Data… → Connections, or clear this visual's fields to start from "${f.table}".`);
      return false;
    }
    setDropNote('');
    const updates: any = { sourceId: empty || !e.sourceId ? f.table : e.sourceId };
    if (e.type === 'matrix') {
      // rows and columns are headers (dates by month to start), values are summarized (text counted)
      const key = matrixList(slot);
      const list = (empty ? [] : e[key] || []).filter((x: any) => x.field !== ref);
      const method = fitMethod('sum', f);
      updates[key] = [...list, slot === 'value' ? { field: ref, aggregate: method === 'sum' ? undefined : method } : { field: ref, datePart: isDateField(f) ? 'month' : undefined }];
    } else if (slot === 'column') {
      const cols = empty ? [] : e.columns?.length ? e.columns : defaultColumns(e.sourceId);
      updates.columns = [...cols.filter((c: any) => c.field !== ref), { field: ref, label: ref, align: alignOf(typeOf(f)) }];
    } else if (slot === 'field') {
      updates.aggregation = { method: fitMethod(f.aggregate || e.aggregation?.method || 'sum', f, true), field: ref };
      if (isMeasureRef(ref)) updates.format = undefined; // a measure shows in its own format
    } else {
      updates.mapping = { ...(empty ? {} : e.mapping), [slot]: ref };
      if (slot === 'y') {
        // a pill moved here keeps its own summary; a new field takes the slot's
        const m = fitMethod(f.aggregate || e.summary?.aggregate || 'sum', f);
        const showAs = f.aggregate ? f.showAs : e.summary?.showAs;
        updates.summary = m === 'sum' && !showAs ? undefined : { aggregate: m === 'sum' ? undefined : m, showAs };
      } else if (slot === 'line' || (slot === 'x' && scatter)) {
        const key = slot === 'x' ? 'xSummary' : 'lineSummary';
        const m = fitMethod(f.aggregate || e[key]?.aggregate || 'sum', f);
        updates[key] = m === 'sum' ? undefined : { aggregate: m };
      }
      // dates on an axis, legend or details start grouped by month
      else if (slot === 'x' || slot === 'group' || slot === 'detail') updates.dateParts = { ...(empty ? {} : e.dateParts), [slot]: isDateField(f) ? 'month' : undefined };
    }
    updateElement(activePageId(), e.id, updates, `field:${e.id}:${slot}`);
    return true;
  }

  const typeOf = (f: { table: string; field: string }) => fieldsOf(f.table).find(c => c.name === f.field)?.type;
  const isDateField = (f: { table: string; field: string }) => typeOf(f) === 'datetime';

  /**
   * A summary that suits the field: text fields are counted, except that a single value on show (`value`: a card,
   * a matrix value) keeps a summary that reads text too (min, max, most common, first, last).
   */
  const fitMethod = (m: AggregationMethod, f: { table: string; field: string }, value = false): AggregationMethod =>
    m === 'count' || m === 'distinct' || isMeasureRef(f.field) || isNumericType(typeOf(f)) || (value && ['min', 'max', 'mode', 'first', 'last'].includes(m)) ? m : 'count';

  /** Empties a slot (or removes a table column). A visual with no fields left forgets its table. */
  function clearField(elem: DashElement, slot: Slot, ref?: string) {
    const e = elem as any;
    const updates: any = {};
    const key = matrixList(slot);
    if (e.type === 'matrix') updates[key] = (e[key] || []).filter((c: any) => c.field !== ref);
    else if (slot === 'column') updates.columns = (e.columns?.length ? e.columns : e.sourceId ? defaultColumns(e.sourceId) : []).filter((c: any) => c.field !== ref);
    else if (slot === 'field' && e.type === 'slicer') updates.field = updates.selection = undefined;
    else if (slot === 'field') updates.aggregation = undefined;
    else {
      // the slot's summary and date grouping go with its field, so the next field starts fresh
      updates.mapping = { ...e.mapping, [slot]: undefined };
      const sum = ({ y: 'summary', line: 'lineSummary', x: 'xSummary' } as any)[slot];
      if (sum) updates[sum] = undefined;
      if (e.dateParts?.[slot]) updates.dateParts = { ...e.dateParts, [slot]: undefined };
    }
    if (fieldRefs({ ...e, ...updates }).length === 0) {
      updates.sourceId = undefined;
      if (slot === 'column') updates.columns = undefined;
    }
    setDropNote('');
    updateElement(activePageId(), e.id, updates);
  }

  /** The table and field a stored field name refers to (plain names belong to the visual's own table). */
  function describeRef(sourceId: string | undefined, name: string): { table: string; field: string } {
    if (sourceId && hasField(sourceId, name)) return { table: sourceId, field: name };
    const table = Object.keys(doc.sources).filter(t => name.startsWith(t + '.')).sort((a, b) => b.length - a.length)[0];
    return table ? { table, field: name.slice(table.length + 1) } : { table: sourceId || '', field: name };
  }

  /** The type of a stored field name (plain or "table.field"). */
  function refType(sourceId: string | undefined, ref?: string): FieldType | undefined {
    if (!ref) return undefined;
    if (isMeasureRef(ref)) return 'float';
    return typeOf(describeRef(sourceId, ref));
  }

  /** True when a stored field name (plain or "table.field") is a numeric column. */
  const isNumericRef = (sourceId: string | undefined, ref: string) => isNumericType(refType(sourceId, ref));

  function deleteElement(pageId: string, elementId: string) {
    const pi = pageIndex(pageId);
    if (pi === -1) return;
    pushHistory();
    setDoc('pages', pi, 'elements', elems => elems.filter(e => e.id !== elementId));
    if (selectedElementId() === elementId) setSelectedElementId(null);
  }

  function duplicateElement(pageId: string, elementId: string) {
    const [pi, ei] = locate(pageId, elementId);
    if (ei === -1) return;
    addElement(pageId, { ...clone(doc.pages[pi].elements[ei]), id: uid('elem'), y: nextRow(pageId) });
  }

  /** Clamped grid move/resize. Repeated calls with the same `historyKey` form one undo step. */
  function moveResizeElement(pageId: string, elementId: string, x: number, y: number, w: number, h: number, historyKey?: string) {
    const [pi, ei] = locate(pageId, elementId);
    if (ei === -1) return;
    w = Math.max(1, Math.min(12, w));
    h = Math.max(1, Math.min(24, h));
    const cur: any = doc.pages[pi].elements[ei];
    // a move keeps the width and stops at the edge; a resize keeps the left side and stops growing there
    x = Math.max(0, Math.min(11, x));
    if (w === cur.w) x = Math.min(x, 12 - w);
    else w = Math.min(w, 12 - x);
    const next = { x, y: Math.max(0, y), w, h };
    if (Object.entries(next).every(([k, v]) => cur[k] === v)) return;
    pushHistory(historyKey ?? `geom:${elementId}`);
    setDoc('pages', pi, 'elements', ei, next);
  }

  // --- Filters ---
  const filtersAt = (scope: FilterScope): DashFilter[] =>
    (scope === 'doc' ? doc.filters : scope === 'page' ? getActivePage()?.filters : getSelectedElement()?.filters) || [];

  function setFilters(scope: FilterScope, filters: DashFilter[], historyKey?: string) {
    pushHistory(historyKey);
    const clean = clone(filters);
    const el = getSelectedElement();
    if (scope === 'doc') setDoc('filters', clean);
    else if (scope === 'page') setDoc('pages', pageIndex(activePageId()), 'filters', clean);
    else if (el) {
      const [pi, ei] = locate(activePageId(), el.id);
      setDoc('pages', pi, 'elements', ei, 'filters', clean);
    }
  }

  /** Distinct values of a filter's field: of its table, or (older filters) across every loaded table. */
  function distinctValues(f: DashFilter): string[] {
    const set = new Set<string>();
    for (const [id, table] of Object.entries(dataStore())) if ((!f.table || f.table === id) && f.field in table.columns) for (const v of distinctOf(makeTableFrame(table), f.field)) set.add(v);
    const cmp = f.table && sortOrder(f.table, f.field);
    return cmp ? [...set].sort(cmp) : sortText([...set]);
  }

  /** A filter's field type: from its table, or the first table with the field. */
  const filterType = (f: DashFilter) => (f.table ? typeOf({ table: f.table, field: f.field }) : (allFields().find(x => x.name === f.field)?.type as FieldType));
  const isDateFilter = (f: DashFilter) => filterType(f) === 'datetime';

  /**
   * What a comparison changes for visual `e`: every date filter reaching it (report, page, slicers, its own) moved
   * to the previous period or a year back (`shift`), and `filters`; none when there's nothing to compare with.
   */
  const compareChanges = (e: DashElement, c: Compare) => [...(c.shift ? shiftFilters(filtersOf(e), c.shift, isDateFilter) : []), ...(c.filters || [])];

  /** A comparison's label: its own, else the other period or value ("vs 2025 Q3", "vs last year"). */
  function compareLabel(e: DashElement, c: Compare) {
    if (c.label != null) return c.label;
    const f = compareChanges(e, c)[0];
    return f?.values?.length ? `vs ${datePartLabel(f.values[0], f.datePart)}` : c.shift ? `vs ${c.shift === 'year' ? 'last year' : 'previous period'}` : '';
  }

  const distinct = (table: string, field: string) => distinctValues({ table, field });

  /** Every field name across sources, with the type from its first schema. */
  const allFields = createMemo(() => {
    const map = new Map<string, string>();
    for (const src of Object.values(doc.sources)) for (const f of src.structure) if (!map.has(f.name)) map.set(f.name, f.type);
    return [...map].map(([name, type]) => ({ name, type }));
  });

  // --- Measures ---
  const measuresOf = (table: string) => (doc.measures || []).filter(m => m.table === table);

  /** How measures reach other tables: a `where` on another table's column, and other tables' measures, for a cell. */
  const measureEnv: MeasureEnv = {
    narrow: (frame, table, f) => {
      const g = filterOn(table, f);
      return g ? filterFrame(frame, [g]) : frame;
    },
    across: (table, ctx) => filterFrame(ctx ? ctx.frameOf(table) : tableFrame(table), ctx?.filters().flatMap(f => filterOn(table, f) ?? []) ?? [])
  };

  /** Compiled measures, rebuilt when any measure changes. */
  const compiled = createMemo(() => {
    const all: DashMeasure[] = clone(doc.measures || []);
    const cache = new Map<string, ReturnType<typeof compileMeasure>>();
    return (table: string, name: string) => {
      const key = `${table}\u0000${name}`;
      if (!cache.has(key)) cache.set(key, compileMeasure(all, table, name, measureEnv));
      return cache.get(key)!;
    };
  });

  /** The measure "[name]" means to a visual on `home`: its table's own, else the nearest one of that name. */
  function findMeasure(home: string | undefined, name: string): DashMeasure | undefined {
    const named = (doc.measures || []).filter(m => m.name === name);
    const dist = (m: DashMeasure) => (m.table === home ? -1 : home ? joinPath(home, m.table)?.length ?? Infinity : 0);
    return named.sort((a, b) => dist(a) - dist(b))[0];
  }

  /**
   * What each cell of `elem` stands for, for measures of other tables: for each field it groups by (axis, legend,
   * details, matrix rows and columns, a table's plain columns) the values in the cell's rows, unless they are all of
   * the visual's (a total), as filters on that field's table; and each table's rows after the visual's filters.
   */
  function cellContext(elem: DashElement): (frame: Frame) => MeasureCtx {
    const e = elem as any;
    const scatter = e.type === 'chart' && chartKind(e.chartType) === 'scatter';
    const groups: { ref: string; part?: DatePart }[] =
      e.type === 'chart' ? (['x', 'group', 'detail'] as const).filter(k => e.mapping?.[k] && !(scatter && k === 'x')).map(k => ({ ref: e.mapping[k], part: e.dateParts?.[k] }))
      : e.type === 'matrix' ? [...(e.rows || []), ...(e.columns || [])].map((f: any) => ({ ref: f.field, part: f.datePart }))
      : e.type === 'table' ? (e.columns || []).filter((c: any) => !c.aggregate && !isMeasureRef(c.field)).map((c: any) => ({ ref: c.field, part: c.datePart }))
      : [];
    const frames = new Map<string, Frame>();
    const frameOf = (t: string) => frames.get(t) ?? frames.set(t, filterRows(t, tableFrame(t), filtersOf(elem))).get(t)!;
    const keyOf = (part?: DatePart) => (part ? (v: unknown) => datePartKey(String(v), part) : String);
    const totals = new Map<string, number>();
    let full: Frame | undefined;
    return (frame) => {
      let filters: DashFilter[] | undefined;
      return {
        frameOf,
        filters: () =>
          (filters ??= groups.flatMap(({ ref, part }) => {
            const values = distinctOf(frame, ref, keyOf(part));
            const id = `${ref}\u0000${part ?? ''}`;
            if (!totals.has(id)) totals.set(id, distinctOf((full ??= getFrame(elem)), ref, keyOf(part)).length);
            if (values.length >= totals.get(id)!) return [];
            const { table, field } = describeRef(elem.sourceId, ref);
            return [{ table, field, datePart: part, values: values.length ? values : ['\u0000'] }];
          }))
      };
    };
  }

  /**
   * A "[name]" reference in a visual on `home` (with `elem`, the visual, for measures of other tables): its function
   * of a cell's rows, name and format; null for fields and unknown measures.
   */
  function measureInfo(home: string | undefined, ref?: string, elem?: DashElement) {
    if (!isMeasureRef(ref)) return null;
    const m = findMeasure(home, measureName(ref));
    const fn = m && compiled()(m.table, m.name);
    if (!m || !fn) return null;
    const ctx = elem && cellContext(elem);
    // on its own table a cell's rows are the measure's rows; another table's are found from what the cell stands for
    const run = m.table === home ? (frame: Frame) => fn(frame, ctx?.(frame)) : (frame: Frame) => {
      const c = ctx?.(frame);
      return fn(measureEnv.across(m.table, c), c);
    };
    return { fn: run, name: m.name, format: withUnits(measureFormat(m), m.units), measure: m };
  }

  /** Adds a measure, or replaces the one named `replacing` (renames follow everywhere). Returns an error, or null. */
  function saveMeasure(m: DashMeasure, replacing?: string): string | null {
    const next = clone(doc.measures || []);
    const err = measureError(next, m, t => fieldsOf(t).map(c => c.name), replacing);
    if (err) return err;
    pushHistory();
    const clean = clone({ ...m, name: m.name.trim() });
    const i = replacing == null ? -1 : next.findIndex(x => x.table === m.table && x.name === replacing);
    i >= 0 ? (next[i] = clean) : next.push(clean);
    if (replacing != null && replacing !== clean.name) {
      for (const x of next) for (const o of [x.a, x.b]) if ((o?.table ?? x.table) === m.table && o?.measure === replacing) o!.measure = clean.name;
      editMeasureRefs(m.table, replacing, clean.name);
    }
    setDoc('measures', reconcile(next));
    return null;
  }

  /** Deletes a measure; visuals that used it lose that field. Refused while another measure uses it. */
  function deleteMeasure(table: string, name: string): string | null {
    const user = (doc.measures || []).find(x => [x.a, x.b].some(o => o?.measure === name && (o.table ?? x.table) === table));
    if (user) return `"${user.name}" uses this measure.`;
    pushHistory();
    editMeasureRefs(table, name, null);
    setDoc('measures', ms => (ms || []).filter(x => !(x.table === table && x.name === name)));
    return null;
  }

  /** Edits a copy of one of the document's lists (if it has it) and stores the result; only what changed updates. */
  function edit<K extends 'pages' | 'filters' | 'relationships' | 'measures'>(key: K, fn: (list: NonNullable<DashDocument[K]>) => void) {
    const list = doc[key] && clone(doc[key]!);
    if (!list) return;
    fn(list);
    (setDoc as any)(key, reconcile(list));
  }

  /**
   * Renames (or with `to` null, removes) the reference `from` in every visual and text binding on a table `owns`
   * (where `from` means the field or measure being changed); `via`: how visuals on other tables reach it, removed too.
   */
  function editRefs(owns: (table?: string) => boolean, from: string, to: string | null, via?: string) {
    edit('pages', pages => {
      for (const e of pages.flatMap(p => p.elements) as any[]) {
        for (const [k, b] of Object.entries(e.bindings || {}) as [string, any][]) if (b.field === from && owns(b.table)) to ? (b.field = to) : delete e.bindings[k];
        if (owns(e.sourceId)) to ? mapRefs(e, f => (f === from ? to : f)) : dropRefs(e, f => f === from);
        else if (via && !to) dropRefs(e, f => f === via);
      }
    });
  }
  /** A measure's "[name]" wherever it means that measure. */
  const editMeasureRefs = (table: string, name: string, to: string | null) => editRefs(home => findMeasure(home, name)?.table === table, measureRef(name), to && measureRef(to));

  // --- Data sources ---
  async function addDataSource(id: string, source: DashDataSource, table?: ColumnTable) {
    pushHistory();
    // replacing: what used a column the new data doesn't have lets go of it
    const gone = fieldsOf(id).filter(c => !source.structure.some(n => n.name === c.name));
    setDoc('sources', id, reconcile(source));
    gone.forEach(c => editRefs(t => t === id, c.name, null, `${id}.${c.name}`));
    srcVer++;
    table ? setDataStore(prev => ({ ...prev, [id]: table })) : await load(id);
  }

  /**
   * The order a column's values take from its sort-by column (for a visual on `home`, `ref` plain or "table.field"):
   * each value ranked by the sort-by value of its first row, numbers by value; values without one go last.
   */
  const orders = createMemo(() => (dataStore(), Object.values(doc.sources).map(s => s.structure.map(c => c.sortBy ?? '').join()).join(), new Map<string, Order | undefined>()));
  function sortOrder(home: string | undefined, ref: string): Order | undefined {
    const { table, field } = describeRef(home, ref);
    const id = `${table}\u0000${field}`;
    if (orders().has(id)) return orders().get(id);
    const by = fieldsOf(table).find(c => c.name === field)?.sortBy;
    const frame = tableFrame(table);
    const read = reader(frame, field);
    const key = by ? reader(frame, by) : null;
    let cmp: Order | undefined;
    if (read && key) {
      const rank = new Map<string, unknown>();
      for (let k = 0; k < frame.length; k++) {
        const v = String(read(k) ?? '');
        if (!rank.has(v)) rank.set(v, key(k));
      }
      cmp = (a, b) => compareValues(rank.get(a), rank.get(b)) || compareText(a, b);
    }
    orders().set(id, cmp);
    return cmp;
  }

  /** Orders a column by another of its table (none: its own values). */
  function setSortBy(sourceId: string, column: string, by?: string) {
    const i = fieldsOf(sourceId).findIndex(c => c.name === column);
    if (i < 0 || doc.sources[sourceId].structure[i].sortBy === (by || undefined)) return;
    pushHistory();
    setDoc('sources', sourceId, 'structure', i, 'sortBy', by || undefined);
    srcVer++;
  }

  /** Changes a column's declared type; the payload is untouched, rows are re-typed from it. */
  async function setColumnType(sourceId: string, column: string, type: FieldType) {
    const i = doc.sources[sourceId]?.structure.findIndex(c => c.name === column);
    if (i == null || i < 0) return;
    pushHistory();
    setDoc('sources', sourceId, 'structure', i, 'type', type);
    srcVer++;
    await load(sourceId);
  }

  /**
   * Every visual that uses a source, with the page it sits on and the fields of it that it uses: visuals built on
   * it, ones reaching it through a connection ("table.field"), text boxes bound to it or naming it in their text.
   */
  function usagesOf(sourceId: string) {
    const pre = sourceId + '.';
    return doc.pages.flatMap(page =>
      page.elements.flatMap(element => {
        const e = element as any;
        const own = e.sourceId === sourceId;
        const fields = [
          ...fieldRefs(e).flatMap(f => (f.startsWith(pre) ? [f.slice(pre.length)] : own ? [f] : [])),
          ...Object.values(e.bindings || {}).flatMap((b: any) => (b.table === sourceId ? [b.field] : []))
        ];
        const named = !e.bindings?.[sourceId] && templateVariables(e.content || '').all.includes(sourceId);
        return own || fields.length || named || Object.values(e.bindings || {}).some((b: any) => b.table === sourceId)
          ? [{ page, element, fields: [...new Set(fields.filter(Boolean))] as string[] }]
          : [];
      })
    );
  }

  /** Jumps to a visual on any page. */
  function selectElement(pageId: string, elementId: string) {
    setActivePageId(pageId);
    setSelectedElementId(elementId);
  }

  // --- Relationships ---
  type End = DashRelationship['from'];
  const sameEnd = (a: End, b: End) => a.table === b.table && a.field === b.field;


  /**
   * Relationships touching `table`, seen from that table: `mine` is its end, `other` the far end, and
   */
  function relationshipsOf(table: string) {
    return (doc.relationships || []).flatMap((r, index) => {
      return r.from.table === table && r.to.table !== table ? [{ index, mine: r.from, other: r.to }]
        : r.to.table === table && r.from.table !== table ? [{ index, mine: r.to, other: r.from }]
          : [];
    });
  }

  function checkRelationship(r: { from: End; to: End }, ignoreIndex: number): string | null {
    if (!hasField(r.from.table, r.from.field) || !hasField(r.to.table, r.to.field)) return 'Pick a field on both sides.';
    if (r.from.table === r.to.table) return 'Connect fields of two different tables.';
    if ((doc.relationships || []).some((o, i) => i !== ignoreIndex && ((sameEnd(o.from, r.from) && sameEnd(o.to, r.to)) || (sameEnd(o.from, r.to) && sameEnd(o.to, r.from))))) {
      return 'Those fields are already connected.';
    }
    return null;
  }

  /** Adds relationship `r`, or puts it in place of relationship `index`. Returns an error message, or null. */
  function saveRelationship(r: DashRelationship, index = -1): string | null {
    const err = checkRelationship(r, index);
    if (err) return err;
    pushHistory();
    const next = clone(r);
    index < 0 ? setDoc('relationships', rels => [...(rels || []), next]) : setDoc('relationships', index, reconcile(next));
    return null;
  }

  /** The fields (and other tables' measures) an element reads that relationship `index` is the only way to. */
  function lostWith(e: DashElement, index: number): string[] {
    if (!e.sourceId) return [];
    const keep = reachable(e.sourceId, index);
    const tableOf = (f: string) => (f.startsWith('[') ? findMeasure(e.sourceId, measureName(f))?.table : Object.keys(doc.sources).find(t => f.startsWith(t + '.')));
    return fieldRefs(e).filter(f => {
      const t = tableOf(f);
      return t && !keep.has(t);
    });
  }

  /** Visuals that read another table only through a relationship: they lose those fields with it. */
  const linkedUsages = (index: number) => doc.pages.flatMap(p => p.elements).filter(e => lostWith(e, index).length);

  function removeRelationship(index: number) {
    if (!doc.relationships?.[index]) return;
    pushHistory();
    const lost = new Map(doc.pages.flatMap(p => p.elements).map(e => [e.id, new Set(lostWith(e, index))]));
    setDoc('relationships', rels => (rels || []).filter((_, i) => i !== index));
    edit('pages', pages => pages.flatMap(p => p.elements).forEach(e => lost.get(e.id)?.size && dropRefs(e, f => lost.get(e.id)!.has(f))));
  }

  // --- Renaming ---
  // rebuilt entry by entry so the table keeps its position in the list
  const renameKey = <T,>(o: Record<string, T>, from: string, to: string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));

  /** Renames a table everywhere it is referenced. Returns an error message, or null. */
  function renameSource(from: string, to: string): string | null {
    to = to.trim();
    if (!isTable(from)) return 'Unknown table.';
    if (!to) return 'A table name cannot be empty.';
    if (to === from) return null;
    if (isTable(to)) return `A table named "${to}" already exists.`;
    pushHistory();
    setDoc('sources', reconcile(renameKey(clone(doc.sources), from, to)));
    const moveFilters = (fs?: DashFilter[]) => fs?.forEach(f => f.table === from && (f.table = to));
    edit('filters', moveFilters);
    edit('pages', pages => {
      pages.forEach(p => moveFilters(p.filters));
      for (const e of pages.flatMap(p => p.elements)) {
        filterLists(e).forEach(moveFilters);
        // a text box naming the table (and not a variable of its own of that name) follows
        const el = e as any;
        if (el.content && !el.bindings?.[from]) el.content = renameInTemplate(el.content, n => (n === from ? to : n));
        if (e.sourceId === from) e.sourceId = to;
        mapRefs(e, f => (f.startsWith(from + '.') ? `${to}.${f.slice(from.length + 1)}` : f)); // "table.field" references
        for (const b of Object.values((e as any).bindings || {}) as { table: string }[]) if (b.table === from) b.table = to;
      }
    });
    edit('relationships', rels => rels.flatMap(r => [r.from, r.to]).forEach(end => end.table === from && (end.table = to)));
    edit('measures', ms =>
      ms.forEach(m => {
        if (m.table === from) m.table = to;
        for (const w of wheres(m)) if (w.table === from) w.table = to;
        for (const o of [m.a, m.b]) if (o?.table === from) o.table = to;
      })
    );
    setDataStore(prev => renameKey(prev, from, to));
    srcVer++;
    return null;
  }

  /**
   * Renames a column: the stored name is rewritten, and every visual, filter and
   * relationship that used the old name follows. Returns an error message, or null.
   */
  async function renameColumn(sourceId: string, from: string, to: string): Promise<string | null> {
    to = to.trim();
    const src = doc.sources[sourceId];
    const i = src?.structure.findIndex(c => c.name === from) ?? -1;
    if (i < 0) return 'Unknown column.';
    if (!to) return 'A column name cannot be empty.';
    if (to === from) return null;
    if (src.structure.some(c => c.name === to)) return `"${to}" already exists in ${sourceId}.`;

    // stored as columns from then on (any format reads)
    const payload = await holdText(await columnsText(await payloadText(src.payload), src.format, (n) => (n === from ? to : n)));
    pushHistory();
    setDoc('sources', sourceId, { payload, format: 'csv-columns' });
    setDoc('sources', sourceId, 'structure', i, 'name', to);
    // a column ordered by the renamed one follows it
    src.structure.forEach((c, j) => c.sortBy === from && setDoc('sources', sourceId, 'structure', j, 'sortBy', to));
    srcVer++;

    const swap = (name: string) => (name === from ? to : name);
    // a filter on this table's column follows; one without a table (older files) does when the visual is on this table
    // or, for page and report filters, when no other table has the name. Otherwise this table gets a copy of it.
    const swapFilters = (fs: DashFilter[] | undefined, mine: boolean) =>
      fs?.slice().forEach(f => {
        if (f.field !== from || (f.table ? f.table !== sourceId : !mine && !sharedElsewhere)) return;
        if (f.table || mine) f.field = to;
        else fs.push({ ...f, field: to, table: sourceId });
      });
    const sharedElsewhere = Object.entries(doc.sources).some(([id, s]) => id !== sourceId && s.structure.some(c => c.name === from));
    edit('pages', pages => {
      for (const p of pages) {
        swapFilters(p.filters, !sharedElsewhere);
        for (const el of p.elements) {
          const binds = (el as any).bindings || {};
          const bound = Object.values(binds) as { table: string; field?: string }[];
          for (const b of bound) if (b.table === sourceId && b.field === from) b.field = to;
          // in a text box, the name inside a section that lists this table's rows
          const rowsOfThis = (s?: string) => !!s && (binds[s] ? binds[s].table === sourceId && !binds[s].field : s === sourceId || (s === 'rows' && el.sourceId === sourceId));
          if ((el as any).content) (el as any).content = renameInTemplate((el as any).content, (n, within) => (n === from && rowsOfThis(within.at(-1)) ? to : n));
          const mine = el.sourceId === sourceId || (!el.sourceId && bound.some(b => b.table === sourceId));
          for (const fs of filterLists(el)) swapFilters(fs, mine);
          if (el.sourceId === sourceId) mapRefs(el, swap);
          else mapRefs(el, f => (f === `${sourceId}.${from}` ? `${sourceId}.${to}` : f)); // reached through a connection
        }
      }
    });
    edit('filters', fs => swapFilters(fs, !sharedElsewhere));
    edit('relationships', rels => rels.flatMap(r => [r.from, r.to]).forEach(end => end.table === sourceId && (end.field = swap(end.field))));
    edit('measures', ms => {
      for (const m of ms) {
        // a where on this table's column, from a measure of this table or of another one
        for (const w of wheres(m)) if ((w.table ?? m.table) === sourceId) w.field = swap(w.field);
        if (m.table !== sourceId) continue;
        if (m.field) m.field = swap(m.field);
        for (const o of [m.a, m.b]) if (o?.field) o.field = swap(o.field);
      }
    });
    await load(sourceId);
    return null;
  }

  function removeDataSource(id: string) {
    pushHistory();
    setDoc('sources', id, undefined!);
    const touches = (r: DashRelationship) => r.from.table === id || r.to.table === id;
    if (doc.relationships?.some(touches)) setDoc('relationships', rels => rels!.filter(r => !touches(r)));
    if (doc.measures?.some(m => m.table === id)) setDoc('measures', ms => ms!.filter(m => m.table !== id));
    // visuals on it are left empty; others lose what they read of it (fields, bindings, filters)
    // (a filter without a table goes when no table left has its field)
    const keep = (fs?: DashFilter[]) => fs?.splice(0, fs.length, ...fs.filter(f => (f.table ? f.table !== id : Object.keys(doc.sources).some(t => hasField(t, f.field)))));
    edit('filters', keep);
    edit('pages', pages => {
      for (const p of pages) {
        keep(p.filters);
        for (const e of p.elements as any[]) {
          filterLists(e).forEach(keep);
          for (const [k, b] of Object.entries(e.bindings || {}) as [string, any][]) if (b.table === id) delete e.bindings[k];
          if (e.sourceId !== id) dropRefs(e, f => f.startsWith(id + '.'));
          else {
            dropRefs(e, () => true);
            e.sourceId = e.summary = e.lineSummary = e.xSummary = e.dateParts = undefined;
          }
        }
      }
    });
    srcVer++;
    setDataStore(({ [id]: _, ...rest }) => rest);
  }

  // --- Encryption (crypt.ts) ---
  /** The file's key, once its password is set or entered: from then on every save encrypts the data with it. */
  let lock: Lock | null = null;
  const [encrypted, setEncrypted] = createSignal(false);

  /** Opens an encrypted file's data with its password, all or nothing: false for a wrong password or a changed file. */
  async function unlock(password: string) {
    const e = doc.encryption!;
    try {
      const next = await deriveLock(password, e);
      const tables = await unseal(next, e, await blobOf(e.ciphertext));
      for (const [id, blob] of tables) if (isTable(id)) setDoc('sources', id, 'payload', hold(blob));
      setDoc('encryption', undefined);
      lock = next;
      setEncrypted(true);
      return true;
    } catch {
      return false;
    }
  }

  /** Sets the file's password (saves encrypt the data from then on), or removes it (null). */
  async function setPassword(password: string | null) {
    lock = password == null ? null : await deriveLock(password);
    setEncrypted(!!lock);
    setIsDirty(true);
  }

  /** Runs `use` on the document as it is written out (every table as columns): with a password, every payload sealed into `encryption`. */
  async function sealed<T>(use: (d: DashDocument) => Promise<T>): Promise<T> {
    await columnar();
    if (!lock) return use(doc);
    const ids = Object.keys(doc.sources);
    const [meta, cipher] = await seal(lock, await Promise.all(ids.map(async id => [id, await blobOf(doc.sources[id].payload)] as [string, Blob])));
    const ciphertext = hold(cipher);
    try {
      return await use({ ...doc, sources: Object.fromEntries(ids.map(id => [id, { ...doc.sources[id], payload: '' }])), encryption: { ...meta, ciphertext } });
    } finally {
      release(ciphertext);
    }
  }

  // --- Save / import ---
  async function save(forceSaveAs = false) {
    setIsSaving(true);
    try {
      const result = await sealed(d => saveDocument(d, { forceSaveAs }));
      if (result.success) setIsDirty(false);
      return result;
    } finally {
      setIsSaving(false);
    }
  }

  function importDoc(newDoc: DashDocument) {
    pushHistory();
    setDoc(reconcile(newDoc));
    srcVer++;
    setActivePageId(newDoc.pages[0]?.id || '');
    setSelectedElementId(null);
    // an encrypted document (an older JSON export) waits for its password (TopBar)
    newDoc.encryption || hydrate();
  }

  return {
    doc,
    editing,
    preview,
    setPreview,
    printing,
    setPrinting,
    print,
    activePageId,
    setActivePageId,
    getActivePage,
    selectedElementId,
    setSelectedElementId,
    getSelectedElement,
    filtersPaneOpen,
    setFiltersPaneOpen,
    visualsPaneOpen,
    setVisualsPaneOpen,
    dataPaneOpen,
    setDataPaneOpen,
    visualTab,
    setVisualTab,
    isDark,
    toggleUi,
    reportTheme,
    setTheme,
    canvasSize,
    setCanvas,
    isDirty,
    isSaving,
    hydrate,
    status,
    tableFrame,
    getFrame,
    distinct,
    templateVars,
    variableSource,
    slicerOptions,
    isNumericRef,
    refType,
    measuresOf,
    measureInfo,
    saveMeasure,
    deleteMeasure,
    setSlicerSelection,
    fieldsOf,
    allFields,
    distinctValues,
    filterType,
    compareLabel,
    valueOf,
    comparedOf,
    comparedView,
    setTitle,
    addPage,
    renamePage,
    duplicatePage,
    deletePage,
    createElement,
    updateElement,
    deleteElement,
    duplicateElement,
    moveResizeElement,
    transformSelectedVisual,
    filtersAt,
    setFilters,
    addDataSource,
    removeDataSource,
    setColumnType,
    sortOrder,
    setSortBy,
    renameSource,
    renameColumn,
    relationshipsOf,
    describeRef,
    assignField,
    clearField,
    defaultColumns,
    dropNote,
    setDropNote,
    saveRelationship,
    removeRelationship,
    usagesOf,
    linkedUsages,
    measureEnv,
    repeats,
    connectedTables: (table: string) => [...reachable(table)].filter(t => t !== table),
    selectElement,
    undo,
    redo,
    canUndo: () => historyLen() >= 1000,
    canRedo: () => historyLen() % 1000 > 0,
    save,
    locked: () => !!doc.encryption,
    unlock,
    encrypted,
    setPassword,
    // JSON is the hand-over format (to people and LLMs): always the readable data, never sealed
    exportJSON: async () => (await columnar(), exportDocumentJSON(doc)),
    importDoc
  };
}

export const store = createRoot(createDashboardStore);
