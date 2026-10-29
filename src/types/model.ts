import type { DatePart, DateUnit } from '../runtime/dates';
import type { Sealed } from '../runtime/crypt';
export type FieldType = 'string' | 'float' | 'int' | 'uint' | 'datetime' | 'boolean';

export interface ColumnSchema {
  name: string;
  type: FieldType;
  nullable?: boolean;
  description?: string;
  /** Another column of the table whose values order this one's (month names by month number, statement lines by line order). */
  sortBy?: string;
}

/** A table's text: CSV with a header row or JSON rows (data being added), or CSV with a line per column (as stored). */
export type DataSourceFormat = 'csv' | 'csv-columns' | 'json';
export type DataSourceEncoding = 'gzip+base64';

export interface DashDataSource {
  format: 'csv-columns';
  encoding: DataSourceEncoding;
  /** LLM-facing manifest: describes the payload's columns so it needn't be decoded for simple visuals. */
  structure: ColumnSchema[];
  /** gzip+base64 of the table as CSV with a line per column: its name, then its values. */
  payload: string;
}

/** Report look. Applies to the report canvas only, never to the editor UI. Unset keys come from the `mode` base. */
export interface DashTheme {
  mode?: 'light' | 'dark' | 'auto'; // base palette; auto follows the viewer's OS setting
  background?: string; // page behind the visuals
  surface?: string; // visual tiles
  text?: string;
  muted?: string; // secondary text and axes
  border?: string; // gridlines and table rules (visuals have no outer border)
  accent?: string; // KPI values and gauges
  palette?: string[]; // series colors, up to 8
  font?: string; // CSS font-family
  radius?: number; // tile corner radius, px
}

export type ResolvedTheme = Required<DashTheme> & { dark: boolean };

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const BASE = {
  light: {
    background: '#F3F5F9', surface: '#FFFFFF', text: '#1E2A3A', muted: '#5B6472', border: '#E3E8EF', accent: '#3B6FD8',
    palette: ['#3B6FD8', '#10B981', '#F2B53A', '#E5605E', '#5AB4D6', '#8E62C9', '#F08A4B', '#2E9E83']
  },
  dark: {
    background: '#14181F', surface: '#1E242D', text: '#E7EAF0', muted: '#8B95A4', border: '#2E3540', accent: '#7AA5F5',
    palette: ['#5B8DEF', '#10B981', '#F2B53A', '#EE6666', '#73C0DE', '#B084DB', '#FC8452', '#3BA272']
  }
};

/** Fills a theme's unset keys from the base palette for its mode. */
export function resolveTheme(theme?: DashTheme): ResolvedTheme {
  const t = theme || {};
  const dark = t.mode === 'dark' || (t.mode === 'auto' && !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const base = BASE[dark ? 'dark' : 'light'];
  const r: ResolvedTheme = { ...base, mode: t.mode || 'light', font: t.font || FONT, radius: t.radius ?? 0, dark };
  for (const k of ['background', 'surface', 'text', 'muted', 'border', 'accent'] as const) r[k] = t[k] || base[k];
  if (t.palette?.length) r.palette = t.palette;
  return r;
}

/**
 * The report page's fixed size in CSS px. Every viewer lays the report out at this size and zooms/pans
 * around it; it never reflows to the window. The page grows taller if visuals extend past `height`.
 */
export interface DashCanvas {
  width: number;
  height: number;
}

export function resolveCanvas(c?: Partial<DashCanvas>): DashCanvas {
  const px = (v: unknown, d: number) => (typeof v === 'number' && v >= 320 ? Math.min(Math.round(v), 7680) : d);
  return { width: px(c?.width, 1440), height: px(c?.height, 810) };
}

/** Categorical filter keeps rows whose `field` is in `values`; numeric filter keeps min <= field <= max. */
export interface DashFilter {
  field: string;
  /** The table `field` belongs to. It also filters the tables that look it up; without one, the first table with the field. */
  table?: string;
  values?: string[];
  min?: number;
  max?: number;
  /** Dates: ISO bounds, inclusive. */
  from?: string;
  to?: string;
  /** Dates: the last n days/weeks/months/years up to today. */
  last?: { n: number; unit: DateUnit };
  /** Dates: `values` are buckets of this kind ("2024", "2024 Q1", "2024-01"). */
  datePart?: DatePart;
  /** Compare `values` as relationship keys do (numbers by value, text ignoring case); set on filters a relationship carries. */
  match?: 'key';
}


/**
 * Links a field of one table (`from`, the many side: a fact) to a field of another (`to`, the one side: a dimension,
 * whose values should be unique; a repeated key matches its first row, so fact rows never repeat). The editor puts
 * the table with unique values on the `to` side. Filters flow from `to` to `from`, and on through further
 * relationships; with `crossFilter: "both"` also back. A filter on the linked field itself crosses either way. A visual
 * on one table can use the fields of any table connected to it, directly or through others ("table.field"): its rows
 * are all kept, a row with no match showing blanks there, as in Power BI.
 */
export interface DashRelationship {
  from: { table: string; field: string };
  to: { table: string; field: string };
  /**
   * many-to-one (default): `to` is the one side, a lookup. one-to-one: both are, and filters flow both ways.
   * many-to-many: neither is (a row joins every match); filters flow `to` → `from` unless crossFilter is "both".
   */
  cardinality?: 'many-to-one' | 'one-to-one' | 'many-to-many';
  crossFilter?: 'single' | 'both';
}

export type WidgetType = 'chart' | 'table' | 'matrix' | 'card' | 'markdown' | 'slicer';
/**
 * count = rows; distinct = distinct non-blank values; mode = the most common value; first/last = the first/last
 * non-blank value (latest: the same as last, from older files); stdev/var = sample standard deviation/variance.
 * min, max, mode, first and last also read text (alphabetically) and dates (earliest/latest) where a single value
 * is shown: cards, text box variables, table columns, matrix values.
 */
export type AggregationMethod = 'sum' | 'avg' | 'count' | 'distinct' | 'min' | 'max' | 'median' | 'mode' | 'first' | 'last' | 'latest' | 'stdev' | 'var';

/**
 * "Show value as": each value as a share of the visual's grand total, or added up along the way (a running total:
 * along a chart's axis, a matrix's columns, else its rows).
 */
export type ShowAs = 'percent-of-total' | 'running-total';

/** Display units: a value divided and suffixed ($416.16B); `auto` picks the largest unit the value reaches. */
export type Units = 'auto' | 'thousands' | 'millions' | 'billions';

/** How a value is worked out per category or cell: summarized, compared with another period, run up. */
export interface ValueSummary {
  aggregate?: AggregationMethod;
  showAs?: ShowAs;
  /** Each category's (cell's) value compared as a card's is: the same period last year, the previous period. */
  compare?: Compare;
}

export interface BaseElement {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  /** The table a visual is anchored to. Set from the first field placed in it; tables connected to it join in as "table.field". */
  sourceId?: string;
  filters?: DashFilter[];
}

/** A table's or matrix's grid: row height, banded rows, lines and text size. */
export interface GridStyle {
  density?: 'compact' | 'roomy';
  banded?: boolean;
  /** Lines between rows (default), also between columns, or none. */
  lines?: 'both' | 'none';
  /** Text size in px (default 12.5). */
  textSize?: number;
}

/** A reference line across a chart: a fixed value, or a statistic of its first series. */
export interface RefLine {
  value?: number;
  stat?: 'average' | 'median' | 'min' | 'max';
  label?: string;
  color?: string;
}

export interface CardElement extends BaseElement {
  type: 'card';
  aggregation?: {
    method: AggregationMethod;
    field?: string;
  };
  format?: ValueFormat;
  units?: Units;
  staticValue?: string | number;
  subtitle?: string;
  /** The big number: size in px (default fits the tile), color, alignment. */
  callout?: { size?: number; color?: string; align?: 'left' | 'center' };
  /**
   * A comparison under the value ("+6.4% vs FY2024"): the same number with `filters` in place of the card's own on
   * those fields (another period, say), or `field` (a field or "[measure]", a target say). Shown as the % change
   * (default), the difference or that value, then `label`; up is good unless `invert` (costs).
   */
  compare?: Compare;
}

export type ValueFormat = 'number' | 'integer' | 'currency' | 'percent';

/**
 * A template variable bound to data: a table's rows, or (with `field`) that column's values.
 * With `aggregate` the variable is that single number instead, shown in `format` when set.
 */
export interface DataBinding {
  table: string;
  field?: string;
  aggregate?: AggregationMethod;
  format?: ValueFormat;
  units?: Units;
  /** The value's comparison instead of the value: as a card's `compare` ("6.4%" for a % change; signed text). */
  compare?: Compare;
}

/**
 * A comparison with the same number for the previous period or a year back (`shift`: the visual's date filters
 * moved), under other `filters` (replacing those on the same fields), or with `field`.
 */
export interface Compare {
  field?: string;
  shift?: 'period' | 'year';
  filters?: DashFilter[];
  show?: 'change' | 'difference' | 'value';
  label?: string;
  invert?: boolean;
}

export interface MarkdownElement extends BaseElement {
  type: 'markdown';
  content: string;
  /** Text size in px (default 12.5) and alignment. */
  textSize?: number;
  align?: 'left' | 'center' | 'right';
  /** Template variable name -> the data it stands for. Unbound names fall back to rows / table names / title / page. */
  bindings?: Record<string, DataBinding>;
}

export type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'combo' | 'scatter' | 'pie' | 'donut' | 'radar' | 'treemap' | 'sankey' | 'gauge';

/**
 * x = category (sankey: source node), y = value, group = series (sankey: target node, treemap: parent).
 * combo: y = column values, line = line values (one shared axis).
 * scatter: x and y = numbers, group = legend; detail = one point per value (x and y summarized), else one per row.
 */
export interface ChartMapping {
  x?: string;
  y?: string;
  group?: string;
  line?: string;
  detail?: string;
}

export interface ChartOptions {
  title?: string;
  showLegend?: boolean;
  /** Where the legend sits; default bottom. */
  legendPosition?: 'bottom' | 'top' | 'right' | 'left';
  showValues?: boolean;
  yAxisLabel?: string;
  /** The category axis's title (none unless set). */
  xAxisLabel?: string;
  /** Axis labels are shown unless false (the value axis's title too). */
  valueAxis?: boolean;
  categoryAxis?: boolean;
  /** Gridlines are drawn unless false. */
  gridlines?: boolean;
  /** Display units on the axis and data labels (default: compact, as each value reads best). */
  units?: Units;
  /** A series', slice's or category's color, by its name. */
  colors?: Record<string, string>;
  /** One series of bars: each bar in its own color. */
  varyColors?: boolean;
  /** A bar's share of its category's room, 0.2 to 1 (default 0.7). */
  barWidth?: number;
  /** Rounded bar corners, px. */
  barRadius?: number;
  /** Line width, px (default 2). */
  lineWidth?: number;
  /** Points on lines: shown where they fit unless false; true always. */
  markers?: boolean;
  refLines?: RefLine[];
  /** A donut's hole, as a share of its radius (default 0.55). */
  donutHole?: number;
  min?: number;
  max?: number;
  /** Number format of the value axis and tooltips. */
  format?: ValueFormat;
  /** Category order: by total value or by name; default is the data's order (dates: oldest first). */
  sort?: 'value-desc' | 'value-asc' | 'label';
  /** Keep only the first n categories (after sorting; by value when no sort is set). */
  topN?: number;
  /** Column, bar and area series stack on each other, or fill each category to 100% (combo: stacked only). */
  stack?: 'stacked' | 'percent';
}

export interface ChartElement extends BaseElement {
  type: 'chart';
  chartType: ChartType;
  mapping: ChartMapping;
  /** How mapping.y is summarized per category/series (default sum), compared and shown. */
  summary?: ValueSummary;
  /** How mapping.line (combo) is summarized (default sum) and compared; it's shown as the bars are unless set. */
  lineSummary?: ValueSummary;
  /** How mapping.x (scatter with details) is summarized; default sum. */
  xSummary?: { aggregate?: AggregationMethod };
  /** Date fields in x/group/detail grouped by year, quarter, month or day. */
  dateParts?: { x?: DatePart; group?: DatePart; detail?: DatePart };
  options?: ChartOptions;
}

export interface TableColumn {
  field: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: 'currency' | 'number' | 'integer' | 'date' | 'percent' | 'string';
  units?: Units;
  /** Summarizes this column; the table then shows one row per combination of its unsummarized columns. */
  aggregate?: AggregationMethod;
  showAs?: ShowAs;
  /** Dates grouped by year, quarter, month or day. */
  datePart?: DatePart;
  /** Numbers: background color scale, or a data bar behind the value. */
  cond?: 'scale' | 'bars';
}

export interface TableElement extends BaseElement {
  type: 'table';
  columns?: TableColumn[];
  grid?: GridStyle;
  /** Totals row; shown unless false. */
  totals?: boolean;
}

/** A matrix's row or column field: its values become headers (dates grouped by `datePart`). */
export interface MatrixField {
  field: string;
  datePart?: DatePart;
}

/** A matrix value: a field summarized (default sum; count for text) or a measure, in every cell. */
export interface MatrixValue {
  field: string;
  label?: string;
  aggregate?: AggregationMethod;
  showAs?: ShowAs;
  /** Each cell compared with the same cell for another period (column and row dates move with it). */
  compare?: Compare;
  format?: ValueFormat;
  units?: Units;
  cond?: 'scale' | 'bars';
}

/**
 * A matrix (pivot table): row headers (a hierarchy, outer first, each level expanding into the next), column
 * headers, and the values summarized at every crossing, with subtotals and grand totals.
 */
export interface MatrixElement extends BaseElement {
  type: 'matrix';
  grid?: GridStyle;
  rows?: MatrixField[];
  columns?: MatrixField[];
  values?: MatrixValue[];
  /** Each row group's own totals, on its row (shown unless false). */
  subtotals?: boolean;
  /** The grand total row and column: both (unless false), or only the total `row` at the bottom or `column` at the right. */
  totals?: boolean | 'row' | 'column';
}


export type SlicerStyle = 'list' | 'dropdown' | 'tiles' | 'range';

/**
 * An on-canvas filter: the viewer picks values of `field` (a column of `sourceId`) and every other
 * visual on the page follows, like a page filter. `selection` is the current pick, saved with the file.
 */
export interface SlicerElement extends BaseElement {
  type: 'slicer';
  field?: string;
  /** list/tiles/dropdown pick values; range picks min–max of a numeric field. Default: range for numbers, else list. */
  style?: SlicerStyle;
  /** Pick one value at a time instead of several. */
  single?: boolean;
  /** Dates: pick years, quarters, months or days instead of exact dates. */
  datePart?: DatePart;
  selection?: { values?: string[]; min?: number; max?: number; from?: string; to?: string };
}

export type DashElement = CardElement | MarkdownElement | ChartElement | TableElement | MatrixElement | SlicerElement;

export interface DashPage {
  id: string;
  title: string;
  elements: DashElement[];
  filters?: DashFilter[];
}

/** A value a calculation combines: a measure (of this table, or of `table`), the sum of a field, or a number. */
export interface MeasureOperand {
  measure?: string;
  /** The measure's table, when it isn't the calculation's own. */
  table?: string;
  field?: string;
  value?: number;
}

export type MeasureOp = '+' | '-' | '*' | '/' | 'pct-diff';

/** A measure's condition: rows whose `field` (a column of the measure's table, or of `table` connected to it) is one of `values`. */
export interface MeasureWhere {
  field: string;
  values: string[];
  table?: string;
}

/**
 * A quick measure: a named number on a table, used in any visual as "[name]" (names are unique in the report) and
 * worked out for what each bar, cell, table row or card stands for. Either it summarizes a field of its table
 * (`aggregate` of `field`, optionally only the rows meeting `where`: one condition or a list, all of which must
 * hold), or it calculates `a op b`.
 */
export interface DashMeasure {
  name: string;
  table: string;
  format?: ValueFormat;
  /** Display units wherever it's shown (a visual's own `units` wins). */
  units?: Units;
  aggregate?: AggregationMethod;
  field?: string;
  where?: MeasureWhere | MeasureWhere[];
  op?: MeasureOp;
  a?: MeasureOperand;
  b?: MeasureOperand;
}

export interface DashDocument {
  format: 'dashier';
  version: number;
  title: string;
  theme?: DashTheme;
  /** Fixed report page size; default 1440×810. */
  canvas?: DashCanvas;
  sources: Record<string, DashDataSource>;
  pages: DashPage[];
  /** Filters applied on every page. */
  filters?: DashFilter[];
  /** Links between tables' fields. */
  relationships?: DashRelationship[];
  /** Quick measures. */
  measures?: DashMeasure[];
  /** Set when the data is encrypted with a password: then every source's payload is "" and its bytes are in here. */
  encryption?: Sealed;
}

export function createDefaultDocument(): DashDocument {
  return {
    format: 'dashier',
    version: 1,
    title: 'Untitled Dashboard',
    theme: {},
    sources: {},
    pages: [{ id: 'page_1', title: 'Page 1', elements: [] }]
  };
}

export const isNumericType = (t?: FieldType) => t === 'float' || t === 'int' || t === 'uint';
