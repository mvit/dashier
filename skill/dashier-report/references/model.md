# The model: how Dashier reads it, measure patterns, modeling patterns

## How Dashier reads the model

Relationships are filter paths, as in Power BI:

- **A visual is anchored to one table** (`sourceId`, usually the fact). Its own columns are plain names; any
  connected table's columns are `"table.field"`, however many relationships away (merged in along the nearest
  path, each table once).
- **Filters** (slicers, element, page and report `filters`, a measure's `where`) travel from the one side (`to`) to
  the many side (`from`), across any number of relationships: a slicer on `dim_region.region` filters `dim_store`
  and through it `fact_sales`. `crossFilter: "both"` also passes filters back from the many side. A filter on a
  relationship's key crosses either way. A filter that can't reach a table leaves it unfiltered.
- **A slicer** lists its own table's column (`sourceId` + `field`): put it on the dimension. A preset pick is its
  `selection`: `{"values": [...]}` (a date's buckets with `datePart`: `"2025"`, `"2025 Q1"`, `"2025-01"`),
  `{"min", "max"}` for a numeric `range`, `{"from", "to"}` for dates without `datePart`.
- **Measures** are worked out in each cell's context (its grouping values and all filters, carried to the
  measure's table). A grouping field that can't reach the measure's table doesn't split it (every bar shows the
  same value), exactly like Power BI: group by shared dimensions.
- **Keys** match by value (`2024` = `2024.0`), text trimmed and ignoring case, a leading-zero code stays text. A
  `to` table is a lookup (its first row per key), so a fact row is never repeated by a dimension.
- **Totals and subtotals** recompute measures over the total's rows (a margin's total is the margin of the total)
  and sum plain fields.
- **Date grouping** is built in: `dateParts` on chart axes, `datePart` on table and matrix fields and slicers;
  dates sort oldest first. A date dimension is still worth it for fiscal periods, labels and shared slicers.

## Measure patterns

| Need | Measures |
|---|---|
| Margin, rate, per unit, average price | `/` of two measures or fields (never `avg` of a stored ratio) |
| Share of total | a chart or matrix value with `showAs: "percent-of-total"`; or `/` against a `where`-free total |
| Year over year, vs previous period | `compare` (`{"shift": "year"}` or `"period"`; `show`: change, difference or value) on a card, text binding, chart `summary` or matrix value. No extra measures |
| Cumulative, year to date, moving average | `showAs`: `running-total`, `ytd` (resets each year), `moving-average` (3 periods), on a chart's `summary` or a matrix value |
| Actual vs target, attainment | `Target` on `fact_targets` (its own grain, sharing dimensions); `Attainment` = `Revenue` / `{"measure": "Target", "table": "fact_targets"}`. Group by the shared dimensions only |
| Variance | `-` of actual and target; `pct-diff` for the percent |
| Share of a segment | `where` on the dimension attribute ÷ the total; two attributes list both conditions |
| Count of members | `distinct` of the key on the fact |

**Time intelligence.** A comparison moves the visual's date filters (slicers' too) to the other period, and a date
axis or matrix header with them: a monthly line's "same period last year" reads each month a year back. Over a span
of dates, the other period is those dates moved back where they overlap. Put the period on the axis as a date with
`dateParts` (or a date-typed period column); a text label such as "FY2025" can't be moved. Revenue to date against
last year's to date:

```json
{"type": "chart", "chartType": "combo", "sourceId": "fact_sales",
 "mapping": {"x": "dim_date.date", "y": "[Revenue]", "line": "[Revenue]"}, "dateParts": {"x": "month"},
 "summary": {"showAs": "ytd"}, "lineSummary": {"showAs": "ytd", "compare": {"shift": "year", "show": "value"}}}
```

A measure's `where` narrows the filters (it never replaces them): a year-specific measure inside a block filtered
to another year finds no rows. Use `compare` instead.

## Modeling patterns

- **Date dimension.** `dim_month` (or `dim_date`): one row per period in the fact's range, contiguous, key in the
  fact's format (`2025-03-01`), plus `year` (string), `quarter` ("2025 Q1"), `month` ("2025-03"), fiscal columns if
  used. **Fiscal periods** get a date whose year and quarter are the fiscal ones (FY2025 → `2025-01-01`) next to
  the real `period_end`, so buckets, slicers and `compare` read in fiscal terms.
- **Snowflakes** work (filters and fields cross any number of relationships), but one flattened `dim_product` with
  `subcategory` and `category` is simpler. The exception is a fact at a coarser grain: cost reported for Products
  and Services only while sales are by category: `fact_cost` links to `dim_kind`, and `dim_category → dim_kind`.
- **Role-playing dates.** One table per role (`dim_order_date`, `dim_ship_date`): a visual joins a table once.
- **Different grains** (daily sales, monthly targets by region): two facts sharing conformed dimensions. A slicer
  on a shared dimension filters both; group their visuals only by the shared dimensions, at the coarser grain.
  Any shared dimension works: `[Operating expenses]` ÷ `{"measure": "Employees", "table": "fact_headcount"}` by
  function.
- **Many metrics with the same shape** (statements, KPI scorecards): a long `fact_kpi (period, metric_id, value)`
  and `dim_metric (metric_id, metric, group, unit, sort_order)`. Chart one metric with an element filter on
  `dim_metric.metric`. Never keep a wide and a long copy. Reconciliations fit the same shape
  (`fact_reconciliation (period, line, amount)`, `dim_line (line, reconciliation, line_order)`).
- **Snapshot facts** (balances, inventory, headcount) add across members, not across time: show them by period, or
  filter to the latest (`last`); never sum across periods.
- **Events and notes** that would otherwise be typed: a small `fact_events (period, metric_id, value, note)`, bound
  in text (`{{ note | first }}`).
- **Degenerate dimension:** an order number stays on the fact. **Junk dimension:** small flags can share one
  `dim_order_profile`. **Slowly changing (type 2):** rows per version with a surrogate key, `valid_from`,
  `valid_to`, `is_current`; the fact carries the version's key.
- **Many-to-many** (a rep in several regions): `bridge_rep_region (rep_id, region_id)` with `bridge → dim_region`
  and `bridge → dim_rep` (bridge as `from`), the latter `crossFilter: "both"`, and `fact_sales → dim_rep`. Turn
  table and matrix `totals` off where shared rows would count twice.

## Power BI concepts in Dashier

| Power BI | Dashier |
|---|---|
| One-to-many, single direction | relationship: fact `from`, dimension `to` (unmatched fact rows show under (Blank)) |
| Cross filter "Both" | `"crossFilter": "both"` |
| Explicit DAX measure | a summary with `where` conditions, or a two-operand calculation; chain for more |
| Sort by column | `"sortBy"` in `structure` |
| Calculated column | precompute in the CSV, row-level only; never a ratio of sums |
| Time intelligence | `dateParts`, `compare`, `showAs` (`running-total`, `ytd`, `moving-average`), `last` filters (`{"last": {"n": 12, "unit": "month"}}`); else pandas |
| Display units | `units` (`thousands`, `millions`, `billions`, `auto`) |
| Analytics lines | `options.refLines` |
| Inactive relationship | one dimension per role |
| Hierarchy, drill down | matrix `rows`, outer first |
| Top N | `options.topN` |
| Conditional formatting | `cond: "scale"` or `"bars"` on table columns and matrix values |
| Visual, page, report filters | `filters` on the element, page or document, each with `table` |
| Bookmarks, drill-through, RLS, tooltip pages | not available |

## References

- Microsoft Learn, *Understand star schema and the importance for Power BI*: https://learn.microsoft.com/power-bi/guidance/star-schema
- Microsoft Learn, *Model relationships in Power BI Desktop*: https://learn.microsoft.com/power-bi/transform-model/desktop-relationships-understand
- Kimball Group, *Dimensional modeling techniques*: https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/
