# Pages and visuals

## Laying out a page

Default canvas 1440×810 (16:9) holds **8 rows** of the 12-column grid (row ≈ 85 px plus a 14 px gap; portrait
`1080×1440` holds about 14). Read order is top-left to bottom-right. Give the answer the most space and the
top-left. Shapes a page can take (illustrations, not templates):

```
Overview (where do we stand?)            Trend (how is it changing?)
y0 ┌card┐┌card┐┌card┐┌card┐ h2            y0 ┌─ headline sentence (bound) ──┐┌slicer┐ h1
y2 ┌──── main chart, w8 ───┐┌ w4 ┐ h4      y1 ┌──── one large line/area chart, w12 ────┐ h5
y6 ┌──── detail or bound note ──┐ h2       y6 ┌ small multiple ┐┌ small ┐┌ small ┐  h2

Ranking (who leads, who lags?)           Detail (look things up)
y0 ┌slicer┐┌slicer┐ h1                    y0 ┌slicer┐┌slicer┐┌slicer┐┌slicer┐ h1
y1 ┌ hbar sorted, topN, w6 ┐┌ table w6 ┐ h7 y1 ┌──── table or matrix, w12, sorted ────┐ h7
```

- Work in bands: rows of 2 or 3 equal visuals (w 6 or w 4, same h), or a hero visual (w 7 to 8) with a note beside
  it. Raise `canvas.height` (to 1000, say) rather than shrink visuals.
- Size lists to their content: a list slicer about one row per 4 members; table and matrix rows 28 px (22
  `compact`, 36 `roomy`) plus title, headers and total. A visual that overflows scrolls.
- Slicers apply to every visual on their page: a visual that must ignore one belongs on another page. At most 3 per
  page, for what that page's question turns on; a fixed scope for every page is a document `filters` entry (one
  for a page, the page's `filters`), not the same slicers copied onto each page.
- Reference tables (full lists, as-reported statements) go on a last page.

## Choosing the visual

| Question | Visual | Notes |
|---|---|---|
| How much in total? | `card` | a measure; its `format` and `units` carry the unit, so the title is just its name |
| How does it change over time? | `line` (few series) or `bar` | x = a period or a date with `dateParts.x`; time left to right, unsorted |
| Which is biggest? | `hbar` | `sort: "value-desc"`, `topN` for long lists |
| What is it made of? | stacked `bar`/`area` (`stack: "stacked"`), `treemap`; `donut` for 2 to 6 parts | `stack: "percent"` for mix over time |
| Two measures, same unit | `combo` (columns + line) | different units: two charts |
| Relationship between two numbers | `scatter` (`detail` = one point per member) | |
| Flow between categories | `sankey` | flows can't be negative: a gain and a loss as their own nodes |
| A profile across scores on one scale | `radar` (2 to 4 members) | `min`/`max` at the scale's useful range |
| Progress to a goal | `gauge` with `options.min`/`max` | |
| Detail by two dimensions | `matrix` (rows outer first, columns a period, values measures) | |
| Look-up rows | `table` | aggregate columns to group; `cond: "bars"` or `"scale"` |
| Let the reader filter | `slicer` on a dimension attribute | `dropdown` many members, `tiles` few, `range` numbers; dates with `datePart` (years, quarters, months) or without (from–to) |
| Context, caveats | `markdown` with bindings | [text.md](text.md) |

## Craft

- Anchor charts, cards, tables and matrices on the **fact** and use dimension attributes as `"dim_store.region"`:
  that is what makes slicers on dimensions filter them.
- Money measures write their currency on axes and labels; name other units in the title or `yAxisLabel`.
- Same members in the same (`sortBy`) order get the same color in every chart. More than 6 series: `topN`, a right
  legend, or small multiples (several charts with visual filters).
- Data labels (`showValues`) only for few points. Bars start at zero; zoom a line (`min`, `max`) only when the
  change is the point.
- Titles say what a chart shows or the finding it proves, as long as it holds under any filter; numbers never go
  in a title (it can't update): they go in bound text.
- **Theme on purpose:** a quiet `background` slightly darker than the tile `surface` (`#f9f9f7` / `#fcfcfb`, or a
  dark pair), near-black `text`, soft `border`, `radius` 6 to 8, a `palette` of distinct hues.
- **KPIs with context:** a card's `compare` (`{"shift": "period"}` or `"year"`, `show`: change for amounts,
  difference for rates, `invert: true` for costs). The card's date filter (`{"table": "dim_date", "field": "date",
  "datePart": "quarter", "values": ["2025 Q4"]}`) or a date slicer with `datePart` on the page is what moves; a text
  period label compares with `"filters": [{... "values": ["2024"]}]` instead.
- **Look options carry meaning:** `refLines` for a target or average, `colors` to pin a member's color, `varyColors`
  only when each bar is its own thing.

## Element reference

All elements: `id` (unique), `type`, `x` 0..11, `y`, `w` 1..12 (x + w ≤ 12), `h`, `title`, `sourceId`, `filters`.

```json
{"id": "k_rev", "type": "card", "x": 0, "y": 0, "w": 3, "h": 2, "title": "Revenue", "sourceId": "fact_sales",
 "aggregation": {"method": "sum", "field": "[Revenue]"}, "compare": {"shift": "year"}}
{"id": "c_trend", "type": "chart", "chartType": "bar", "x": 0, "y": 2, "w": 8, "h": 4, "title": "Revenue by quarter and category",
 "sourceId": "fact_sales", "mapping": {"x": "dim_month.quarter", "y": "[Revenue]", "group": "dim_product.category"}, "options": {"stack": "stacked"}}
{"id": "m_detail", "type": "matrix", "x": 0, "y": 1, "w": 12, "h": 7, "sourceId": "fact_sales",
 "rows": [{"field": "dim_store.region"}, {"field": "dim_store.store"}], "columns": [{"field": "dim_month.year"}],
 "values": [{"field": "[Revenue]"}, {"field": "[Gross margin]", "label": "Margin", "cond": "scale"}]}
{"id": "t_stores", "type": "table", "x": 0, "y": 0, "w": 6, "h": 3, "sourceId": "dim_store", "totals": false,
 "columns": [{"field": "store", "label": "Store"}, {"field": "region", "label": "Region"}]}
{"id": "s_region", "type": "slicer", "x": 9, "y": 0, "w": 3, "h": 2, "title": "Region", "sourceId": "dim_store", "field": "region", "style": "tiles"}
```

- **chart:** `chartType` bar | hbar | line | area | combo | scatter | pie | donut | radar | treemap | sankey | gauge.
  `mapping`: x (category; sankey source; treemap leaf), y (value), group (series; sankey target; treemap parent),
  line (combo), detail (scatter points). `summary: {aggregate, showAs (percent-of-total | running-total | ytd |
  moving-average), compare}` for y, `lineSummary` (the same for a combo's line), `xSummary`, `dateParts: {x, group,
  detail}`. `options`: showLegend, legendPosition (bottom | top | right | left), showValues, xAxisLabel, yAxisLabel,
  min, max, format, units, sort (value-desc | value-asc | label), topN, stack (stacked | percent); valueAxis,
  categoryAxis, gridlines (false hides), colors (`{"Services": "#ef4444"}`), varyColors, barWidth (0.2 to 1),
  barRadius, lineWidth, markers, donutHole, refLines (`[{"stat": "average"}]`, `[{"value": 4e11, "label": "Target"}]`).
- **card:** `aggregation: {method, field}`, `format`, `units`, `callout: {size, color, align}`, `subtitle` (static),
  `compare: {shift | filters | field, show, label, invert}`. min/max/first/last/mode also read text and dates.
- **table:** `columns: [{field, label, format (number | integer | currency | percent | date | string), units,
  aggregate, showAs, datePart, cond}]` (required), `totals`, `grid: {density (compact | roomy), banded, lines (both |
  none), textSize}`. Any aggregated column groups the table by the others.
- **matrix:** `rows`, `columns` (`{field, datePart}`), `values` (`{field, label, aggregate, showAs, compare, format,
  units, cond}`), `subtotals`, `totals` (false, `"row"` or `"column"`), `grid`. Values in different units: turn
  `totals` off or split the matrix.
- **slicer:** `field` of `sourceId`, `style` list | dropdown | tiles | range, `single`, `datePart`, `selection`.
- **markdown:** `content`, `bindings`, `textSize`, `align` ([text.md](text.md)).

Document: `title`, `theme` (`mode` light | dark | auto, `background`, `surface`, `text`, `muted`, `border`,
`accent`, `positive`, `negative`, `palette` [8 colors], `font`, `radius`), `canvas` (`{"width": 1440, "height":
810}`; portrait `1080×1440`, A4 `1123×794`), `currency`, `filters` (every page), `relationships`, `measures`,
`pages` (`id`, `title`, `elements`, `filters`). `report.html#<page id>` opens a page; `#preview` hides the editor;
`#fit` fits the page to the window.
