---
name: "dashier-reports"
description: "Build and edit expert Dashier dashboards: single-file .html reports whose document is a dashier+json block. Use for any Dashier request (a new report from data, adding pages or visuals, fixing or reviewing one). It models the data as a star schema (fact and dimension tables, relationships, measures), presents it the way the data and the reader's questions call for, binds every number that comes from the data, and validates the result before handing it over."
---

# Expert Dashier reports

A Dashier report is one HTML file: the app (packed, never edited) plus the document, plain JSON in one block:

```html
<script type="application/dashier+json" id="dashier-doc"> { "format":"dashier", "version":1, ... } </script>
```

You build the document. A good one is a small **star schema** (dimension tables to filter and group by, fact tables
to summarize, relationships between them, measures for every derived number) and **pages** of visuals bound to it,
where every number that comes from the data is computed, never typed. The method is the one Power BI modelers use (Microsoft's star schema guidance,
Kimball's dimensional modeling). This file adds what is specific to Dashier, which is smaller than Power BI and
behaves differently in places that matter.

Scripts in `scripts/` (run them, don't retype them):

| Script | Does |
|---|---|
| `get_dashier.py [OUT.html]` | downloads the current Dashier editor (default `dashier.html`), the template a new report is built from |
| `build_report.py [TEMPLATE.html] DOC.json OUT.html` | writes DOC.json into a copy of the template (the current editor, downloaded, when none is given; a path or URL otherwise); a source written as `{"file": "data/x.csv"}` is packed as columns (gzip+base64) and its `structure` inferred, typed as the app types columns (it flags dates that aren't ISO) |
| `validate_dashier.py OUT.html` | checks the model against its data, every field reference, filter and slicer values (a value that matches nothing empties a visual), text box templates and the grid; exit 0 = no FAIL. `--render` (opt-in, needs Playwright for Python) also opens every page headless and fails visuals that render empty |
| `dashier_data.py` | not run: the two above read, type, compare and pack values with it, as the app does (keep it next to them) |

## Rules that are never skipped

1. **Star schema.** Facts (`fact_*`) hold events or observations at one grain with keys and numbers. Dimensions
   (`dim_*`) hold one row per member with a unique key and descriptive attributes. Every fact links to its
   dimensions. With more than one table, `relationships` is never empty.
2. **Derived numbers are measures, never columns.** Margins, ratios, shares, per-unit values, growth, differences
   and averages of ratios are measures, recomputed for each bar, row and total. A stored ratio is wrong at every
   total.
3. **Numbers from the data are bound, not typed.** A figure in text that comes from the report's data, or that
   should change when the reader filters, is a bound `{{ variable }}`; typed, it goes stale or contradicts the
   visuals. Numbers that aren't in the data (a policy threshold, a founding year, a count of steps) are plain text.
   Titles and card subtitles are static, so they carry only such fixed numbers.
4. **Filters name their table:** `{"field": "region", "table": "dim_store", "values": ["North"]}`.
5. **Presentation is your call; the template's document is not a model for it.** How many pages, which visuals
   and how they are laid out follow from the data and the reader's questions. Nothing is copied from the template's
   document (the tutorial teaches the editor; its layout is not a report's).
6. **Validate.** Run the validator until it reports no FAIL before delivering.

Work in one pass: don't ask the user to approve the model or the layout. Ask only about a choice that is hard to
undo and could reasonably go either way (which of two definitions of "revenue" to use, say).

## Workflow

Build each report in its own folder, as two scripts that take the source to the document. When the data changes,
you rerun them; when a number looks wrong, you trace it back to the source row it came from:

```
apple-10k/
  extract.py              source files → data/*.csv: the star schema, amounts in full, checked against the source's totals
  data/                   dim_*.csv and fact_*.csv (the update templates the user keeps)
  build_doc.py            data/ → doc.json: sources, relationships, measures, pages
  doc.json
  apple-10k.dashier.html  build_report.py's output
```

```bash
cd apple-10k
python3 extract.py sheets/     # writes data/
python3 build_doc.py           # writes doc.json
python3 <skill>/scripts/build_report.py doc.json apple-10k.dashier.html
python3 <skill>/scripts/validate_dashier.py apple-10k.dashier.html
```

For sample or generated data, `make_data.py` (seeded, so it reproduces) takes the place of `extract.py`. Sources in
`doc.json` point at the CSVs (`{"file": "data/fact_sales.csv"}`, relative to `doc.json`); `build_report.py`
packs them.

### 1. Start from a template

A new report needs no Dashier file from the user. `python3 <skill>/scripts/get_dashier.py` downloads the current
editor to `dashier.html` (from https://mvit.github.io/dashier/, or the copy in github.com/mvit/dashier), and
`build_report.py` downloads it itself when it is given no template. Use a Dashier file the user provides instead
when there is one: a report to change, or a build they want kept (any Dashier report or the tutorial is a template:
the app is the same, only the document differs). Never edit the user's original: build into a new file. Don't
invent or rebuild the app. If the download fails (no network), ask the user for a Dashier file. Read the EDITING
GUIDE comment in the template's head (the downloaded `dashier.html` has it); where it and this file differ, this
file is newer. **Never decode or read the packed app code** (the `dashier-js` block, ~250K
characters): number formats, chart behavior, filters and templates are all described in the guide and here.

**Take the app from the template, never its document.** `build_report.py` replaces the whole document, so don't
read the template's pages for ideas. The tutorial in particular is a lesson about the editor, not a report: a tall
text column on the left of every page, one editor feature per page, numbered page titles, demo tables (`sales`,
`regions`). Copying any of it (its tables, ids, titles, page structure or that text column) makes a worse report.
An existing report the user wants changed is different: keep its structure unless asked, and change what was asked.

### 2. Understand the questions, then design the model (Kimball's four steps)

Write down the 3 to 6 questions the report must answer (who reads it, what decision it supports). Then:

1. **Business process.** Each process that produces numbers (sales, budget, inventory, support tickets) is a fact
   table.
2. **Grain.** Say in one sentence what one fact row is ("one row per month, store and product"). Every row of a
   fact table has the same grain. Different grains are different fact tables (daily sales and monthly targets),
   linked to the same dimensions so one slicer narrows them all and a measure of one works in the other's visuals.
3. **Dimensions.** The nouns the questions group and filter by: date or period, product, customer, region, metric,
   scenario. One table per dimension, one row per member.
4. **Facts.** The additive numbers at that grain (revenue, cost, units, count of tickets). Store raw amounts at
   full precision, not rates.

Source data usually arrives flat (one wide sheet). Split it: repeated descriptive columns move to a dimension,
the fact keeps the key. Read [Dashier's model semantics](#how-dashier-reads-the-model) before deciding anything,
because they differ from Power BI's.

### 3. Write the tables as CSV

- **Keys.** A dimension's key is unique and never blank. Keys match as Power BI matches them: numbers by value
  (`2024` = `2024.0`), text trimmed and ignoring case (`s1` = `S1`), but a code with a leading zero stays text
  (`00501` ≠ `501`). A repeated dimension key matches its first row (no double counting, but the other rows are
  never used): fix duplicates in the data. Use readable business keys (`S1`, `2024-01-01`, `FY2025`); a surrogate
  key only when the business key isn't unique (a slowly changing dimension).
- **Every fact key exists in its dimension.** A missing member shows as "(Blank)". Add an "Unknown" member if the
  source has gaps.
- **Attributes are the labels readers see.** Axis titles, matrix headers and slicer lists show column names and
  values as written, so name columns `region`, `store`, `category`, not `rgn_cd` (a matrix's row header reads
  underscores as spaces: `cost_type` shows as "Cost type").
- **Give every label with a natural order a sort-by column.** In `structure`, `{"name": "month", "type":
  "string", "sortBy": "month_number"}` orders that column's values by another column of the same table wherever
  they appear: axes, legends, matrix headers, slicers (like Power BI's "Sort by column"). Use it for month and
  quarter names, periods (`period` by `period_end`), statement lines (`line` by `line_order`), size bands, stages.
  Without one, labels sort as text (put the year first: `2025 Q1`, not `Q1 2025`).
- **Numbers are plain:** `1234.5`, never `$1,234.50`, `12%` or `1.2K` (those load blank). Percentages as fractions
  (`0.125`). Dates ISO (`2025-03-31`): other forms load, but `03/04/2024` is March or April only by the column's
  other dates. Booleans `true`/`false` (`1`/`0` and `yes`/`no` load too; any other text loads as false).
- **Years, ids, codes and zip codes** that are labels are typed `string` (in `structure`), so they never get summed
  or turned into range slicers.
- **Sort fact rows oldest first** (by period, then by the dimensions), and dimension rows in their natural order.
  A field without a sort-by column shows its categories and legend series in the order the rows first mention
  them, so a statement-style file with the latest year first puts FY2025 before FY2024 in every chart and
  before/after reads backwards. A chart's `sort` reorders categories only, never legend series (real date fields
  are always oldest first). `first`/`last` also read rows in this order.
- **No dots or brackets in table or column names** (`table.field` and `[measure]` are reference syntax).
- Keep a `source` or `basis` column in a dimension when figures are estimates or derived (a quarter computed as
  year minus the other quarters), so the label travels with the data.
- **`extract.py` writes the CSVs; you never type data into them.** Each table is a few lines of the script, so a
  rerun on next year's source rebuilds them all:
  - **Spreadsheets:** export every sheet to CSV first, then read them with the standard `csv` module. A filing's
    workbook has one sheet per statement or note. The last option (`-1`) exports all sheets, not only the first,
    as `<file>-<SHEET>.csv`:

    ```bash
    soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,UTF8,1,,0,false,true,false,false,false,-1' 10k.xls --outdir sheets
    ```
  - **Find rows by their label, not their position.** A helper such as `row(rows, "Total net sales")` returns the
    numbers on the first row whose label starts with that text; give it `after="Cost of sales"` when a label
    repeats under several headings ("Products" under net sales and under cost of sales). Skip the change columns
    (`%`) between years, and read `(1,234)` as negative and `—` as zero.
  - **Check every total the source prints.** Assert that categories add up to total net sales, that segments add
    up to it too, and that gross margin minus operating expenses is operating income. A misread row then stops
    the script, and no wrong number reaches the report.
  - **Convert units once:** one `usd = lambda millions: round(millions * 1_000_000)` for a filing in millions
    (thousands for most 20-Fs), applied to every amount as it is written.
  - **Write dimensions from lists in the script,** each with its order column (`segment_order`,
    `category_order`), and fact rows oldest first.
- Keep the CSVs in `data/` next to the report: they are the update templates.

### 4. Relationships

One per fact-to-dimension link: the fact (many side) is `from`, the dimension (one side) is `to` (cardinality
`many-to-one`, the default; `one-to-one` when both columns are unique; `many-to-many` only when neither is, e.g. a
bridge, where a row joins every match):

```json
{"from": {"table": "fact_sales", "field": "store_id"}, "to": {"table": "dim_store", "field": "store_id"}}
```

The direction is the model: filters flow from `to` to `from` (dimension to fact, as Power BI's one-to-many,
single-direction default), and a `to` table is a lookup. Never point a dimension at a fact. Add
`"crossFilter": "both"` only where a fact must filter a dimension (a bridge table, see patterns); it makes slicers
on one dimension narrow the others' lists through the fact. A snowflake (`dim_product` → `dim_category`) works: filters and fields travel any number of relationships.

### 5. Measures

A measure lives on one table (usually a fact) and works in **any visual connected to that table** as `"[Name]"`,
like a DAX measure. It is worked out for what each bar, cell, row, card or total stands for: its category, row and
column values and every filter, carried through the relationships to the measure's table. Measure names are unique
in the report. Two kinds:

```json
{"name": "Revenue", "table": "fact_sales", "aggregate": "sum", "field": "revenue", "format": "currency", "units": "millions"}
{"name": "Software revenue", "table": "fact_sales", "aggregate": "sum", "field": "revenue", "where": {"table": "dim_product", "field": "category", "values": ["Software"]}, "format": "currency", "units": "millions"}
{"name": "Gross profit", "table": "fact_sales", "op": "-", "a": {"field": "revenue"}, "b": {"field": "cost"}, "format": "currency", "units": "millions"}
{"name": "Gross margin", "table": "fact_sales", "op": "/", "a": {"measure": "Gross profit"}, "b": {"measure": "Revenue"}, "format": "percent"}
{"name": "Target", "table": "fact_targets", "aggregate": "sum", "field": "target", "format": "currency", "units": "millions"}
{"name": "Attainment", "table": "fact_sales", "op": "/", "a": {"measure": "Revenue"}, "b": {"measure": "Target", "table": "fact_targets"}, "format": "percent"}
```

- Summary: `aggregate` (sum, avg, min, max, median, count, distinct, mode, first, last, stdev, var) of a `field`
  of its table (`count` needs none), optionally `where`: a `{field, values, table}` condition or a list of them,
  all of which must hold, each on a column of the measure's table or (with `table`) of a table connected to it,
  like `CALCULATE([x], dim_metric[metric] = "Revenue", dim_period[year] = "2025")`. Values are matched as text
  (`"2025"`, ISO dates). Never concatenate keys (`revenue|FY2025`) to squeeze two conditions into one: list them.
- Calculation: `op` is `+ - * / pct-diff` with operands `{"measure": "..."}` (add `"table"` for another table's
  measure: it is worked out for the same cell), `{"field": "..."}` (its sum) or `{"value": 100}`. Chain measures for
  longer formulas. Division by zero shows "—". `pct-diff` is (a − b) / |b| and shows as a percent.
- `format` (`number`, `integer`, `currency`, `percent`) and `units` (`thousands`, `millions`, `billions`, `auto`)
  decide how a measure reads in every card, text, table and matrix that shows it; a visual's own wins. Give every
  measure both deliberately: money as `currency` with units, rates as `percent`, counts as `integer`. The exact
  rules, per surface, are in [How numbers are shown](#how-numbers-are-shown).
- Name measures as readers say them ("Gross margin", "Revenue per unit"). A name is unique in the report and can't
  repeat a column name of its table.

Patterns:

| Need | Measures |
|---|---|
| Margin, rate, per unit, average price | `/` of two measures or fields (never `avg` of a stored ratio) |
| Share of total | a chart or matrix value with `showAs: "percent-of-total"`; or `/` against a `where`-free total measure |
| Year over year, vs previous period | `compare` (`{"shift": "year"}` or `"period"`, `show`: change, difference or value): on a card or text binding for one number, on a chart's `summary` (each category) or a matrix value (each cell). No extra measures, nothing to roll forward |
| Cumulative, year to date | `showAs: "running-total"` on a chart's `summary` or a matrix value: adds up along the axis (the matrix's columns, else its rows). Under a year filter or slicer it is year to date; with `compare` too, last year's year to date |
| Actual vs target, attainment | `Target` on `fact_targets` (its own grain, sharing dimensions); `Attainment` = `Revenue` / `{"measure": "Target", "table": "fact_targets"}`. Group visuals by the shared dimensions only |
| Variance | `-` of actual and target; `pct-diff` for the percent. A signed variance by member is a diverging `hbar` sorted by value: ahead to the right, behind to the left |
| Share of a segment | `where` on the dimension attribute (`{"table": "dim_product", "field": "category", ...}`) ÷ the total; a segment of two attributes (premium coffee) lists both conditions |
| Count of members | `distinct` of the key on the fact |
| Respondents in a long survey (one row per question, everyone answers each) | sum of `responses` with `where` on one `question`; the average score divides totals over all questions |

**Time intelligence without formulas.** A comparison moves the visual's date filters (slicers' too) to the other
period, and a date axis or matrix header with them: a monthly line's "same period last year" reads each month a
year back, and a chart filtered to 2025 compares every bar with 2024. Over a span of dates, the other period is
those dates moved back where they overlap (all of 2024 and 2025 a year back counts 2024 only), as Power BI's same period
last year does. Put the period on the axis as a date with `dateParts` (or a date-typed period column); a text label
such as "FY2025" can't be moved.

```json
{"type": "chart", "chartType": "combo", "sourceId": "fact_sales",
 "mapping": {"x": "dim_date.date", "y": "[Revenue]", "line": "[Revenue]"}, "dateParts": {"x": "month"},
 "summary": {"showAs": "running-total"},
 "lineSummary": {"showAs": "running-total", "compare": {"shift": "year", "show": "value"}}}
```

That is revenue to date as columns against last year's to date as a line, for the year a slicer picks.

**Beyond the built-ins, prepare the data.** Dashier has no formula language (no DAX: no rolling windows, no ranks,
no ALL/REMOVEFILTERS, no OR between conditions; a condition's `values` list is the OR). The document is JSON so
that you can do the heavy lifting in pandas before writing the CSVs, at the fact's grain, as plain columns:

```python
df = df.sort_values(["store_id", "month"])
g = df.groupby("store_id")["revenue"]
df["revenue_rolling_3m"] = g.transform(lambda s: s.rolling(3, min_periods=1).sum())       # trailing 3 months
df["revenue_fytd"] = df.groupby(["store_id", "fiscal_year"])["revenue"].cumsum()           # a custom year-to-date reset
df["first_month"] = df.groupby("customer_id")["month"].transform("min")                    # cohort of each customer
```

Name such a column for what it is (`revenue_rolling_3m`), say so in titles, and remember which add up: a value
per row of the fact's grain (a cohort, a prior-period value for the same members) sums like any fact; a rolling or
to-date value adds up across members but never across periods, so show it with the period on the axis or a card
filtered to one period.

### 6. Pages and visuals

The pages are yours to design: decide what the reader needs to see, how many pages that takes and how each is laid
out. It helps to write a one-line brief per page first (the question, the visual that answers it, what supports
it, what the reader can filter) and to give the answer the most space and the top-left position.

Default canvas 1440×810 (16:9) holds **8 rows** of the 12-column grid (row ≈ 85 px plus a 14 px gap; a portrait
canvas `1080×1440` holds about 14). Read order is top-left to bottom-right. Some shapes a page can take, as
illustrations of the grid, not templates:

```
Overview (where do we stand?)            Trend (how is it changing?)
y0 ┌card┐┌card┐┌card┐┌card┐ h2            y0 ┌─ headline sentence (bound) ──┐┌slicer┐ h1
y2 ┌──── main chart, w8 ───┐┌ w4 ┐ h4      y1 ┌──── one large line/area chart, w12 ────┐ h5
y6 ┌──── detail or bound note ──┐ h2       y6 ┌ small multiple ┐┌ small ┐┌ small ┐  h2

Ranking (who leads, who lags?)           Breakdown (what is it made of?)
y0 ┌slicer┐┌slicer┐ h1                    y0 ┌──── stacked bar / 100% over time, w8 ┐┌ donut ┐ h4
y1 ┌ hbar sorted, topN, w6 ┐┌ hbar or     y4 ┌ treemap, w6 ───────┐┌ matrix, w6 ───────┐ h4
   │ h7                    ││ table w6 h7
                                          Detail (look things up)
Scorecard (many KPIs vs target)          y0 ┌slicer┐┌slicer┐┌slicer┐┌slicer┐ h1
y0 ┌ matrix: metric × period, cond ┐ h5    y1 ┌──── table or matrix, w12, sorted ────┐ h7
y5 ┌ gauge ┐┌ gauge ┐┌ combo actual vs target ┐ h3
```

Text works best as support: a headline sentence or a short note bound to the data, with a caveat the reader needs
(an estimate, a gap) next to the visual it affects. The tutorial's full-height text column exists to teach the
editor; it is rarely the right shape for a report.

Choose the visual by the question:

| Question | Visual | Notes |
|---|---|---|
| How much in total? | `card` | a measure; its `format` and `units` write the unit into the value ($416.16B), so the title is just its name |
| How does it change over time? | `line` (few series) or `bar` | x = a period attribute or a date with `dateParts.x`; keep time left to right, unsorted |
| Which is biggest? | `hbar` | `sort: "value-desc"`, `topN` for long lists; long names fit hbar best |
| What is it made of? | stacked `bar`/`area` (`stack: "stacked"`), `treemap`; `donut`/`pie` for 2 to 6 parts (`topN`) | `stack: "percent"` for mix over time |
| Two measures, different meaning, same unit | `combo` (columns + line, one axis) | different units: two charts side by side |
| Relationship between two numbers | `scatter` (x, y measures or fields; `detail` = one point per member) | |
| Flow from one category to another | `sankey` | |
| A profile across several scores on one scale | `radar` (x = a column naming the score, one row per score; group = 2 to 4 members) | `min`/`max` at the scale's useful range (3 to 5 of 5): from 0 every shape looks alike |
| Progress to a goal | `gauge` with `options.min`/`max` | |
| Detail by two dimensions | `matrix` (rows = hierarchy outer first, columns = a period, values = measures) | measures stay right at subtotals |
| Look-up rows, reference lists | `table` | aggregate columns to group; `cond: "bars"` or `"scale"` |
| Let the reader filter | `slicer` on a **dimension** attribute | `dropdown` for many members, `tiles` for few, `range` for numbers; for dates, `datePart` to pick years, quarters or months, or no `datePart` (or `range`) to pick from one date to another |
| Context, interpretation, caveats | `markdown` with bindings | see step 7 |

Visual craft:

- Anchor charts, cards, tables and matrices on the **fact** (`sourceId: "fact_sales"`) and use dimension
  attributes as `"dim_store.region"`. That is what makes slicers on dimensions filter them.
- A currency measure writes "$" on axes and labels by itself; name other units in the title or `yAxisLabel`
  ("units", "score, 1 to 5", "EUR"). Sort bars by value unless the axis is time.
- One color per series, consistent across pages: series take palette colors in order, and a sankey's nodes by
  their place in their column, so the same members in the same (`sortBy`) order get the same color in every
  chart. Avoid more than 6 series
  in one chart: use `topN`, a legend on the right (`legendPosition: "right"`) for long names, or small multiples
  (several charts with visual filters).
- Data labels (`showValues`) only where there are few points.
- A chart's title can say what it shows ("Revenue by quarter and category") or, better, the finding it proves
  ("Gross margin %: Services earns twice Products"), as long as it holds whatever the filters and data updates
  do. Numbers never go in a title (a title can't update): they go in bound text.
- Slicers apply to every visual on their page (filters only ever narrow): a visual that must ignore them belongs
  on another page.
- Size lists to their content: a list slicer needs about one row per 4 members; table and matrix rows take 28 px
  each (22 with `grid.density: "compact"`, 36 `"roomy"`), plus the title, headers and total (12 rows and a total
  fit 5 grid rows of a 1000-tall canvas). A
  matrix that pivots 4 periods × 2 values needs the full width; at w 8 keep 3 or 4 value columns and no column
  field. A visual that overflows scrolls, and the reader misses the rows below.

Finish (what separates a polished report from a correct one):

- **Choose a theme on purpose.** Set `theme` rather than relying on the default: a quiet page `background`
  slightly darker than the tile `surface` (warm off-white `#f9f9f7` / `#fcfcfb`, or a dark pair), near-black
  `text`, a soft `border`, `radius` 6 to 8, `font: "system-ui, -apple-system, 'Segoe UI', sans-serif"`, and a
  `palette` of clearly distinct hues. Give each recurring series the same color everywhere (the same members in
  the same order in every chart).
- **Lead each page with its takeaway.** A full-width text strip (h 1) on top: the page title as a heading and one
  bound sentence with the finding ("iPhone is {{ iphone_share }} of net sales; Services grew {{ svc_growth }}").
  Readers get the point before the charts. Put the page's slicer beside the strip (strip w 9, slicer w 3), and
  repeat it on every page it should drive: slicers belong to their page.
- **Give KPIs context.** A bare number tells little. A card's `compare` puts the comparison under it, computed and
  colored. For periods use `"shift": "period"` (the previous quarter, month or year of the card's date filter) or
  `"year"` (the same period a year back): a card filtered to 2025 Q4 shows "+6.4% vs 2025 Q3", and it follows when the
  filter changes. The card's date filter picks buckets (`{"table": "dim_date", "field": "date", "datePart":
  "quarter", "values": ["2025 Q4"]}`), a range or "last n"; a period that's a text label (`fiscal_year` = "2025")
  compares with `"filters": [{... "values": ["2024"]}]` instead. `show`: `change` (%), `difference` or the other
  `value`; `invert: true` for costs; `field` compares with another measure (a target). Amounts compare best as a
  % change, rates (margins, attainment, scores) as a `difference`. A slicer counts as the date filter when it's
  on a date with `datePart`: `{"type": "slicer", "sourceId": "dim_date", "field": "date", "datePart": "year",
  "style": "tiles", "selection": {"values": ["2025"]}}` makes every `shift` on its page, on cards and bindings,
  follow the reader's pick ("+17.8% vs 2024"); a slicer on a text `year` column can't be shifted. Card subtitles
  are static, so they hold units or definitions ("buybacks + dividends"), not figures.
- **Add a Highlights block where the page tells a story** (see Highlights in step 7): 3 to 6 data-driven bullets
  beside the main chart or under the takeaway strip.
- **Match the chart to the story:** a flow from total to profit is a `sankey` (a small fact of period, source,
  target, amount, linked to the period dimension so the year slicer picks the year; a few short source names, a
  gain and a loss as their own nodes, since flows can't be negative); composition over time is a stacked `bar`; rates and margins are `line`s with `min: 0`; growth by member
  is an `hbar` sorted by value, negatives included; one period's mix is a `donut`; a long-run comparison is an
  indexed line (value of 100 invested).
- **Work in bands.** Rows of 2 or 3 equal visuals (w 6 or w 4, same h) read as a set; a hero visual (w 7 to 8)
  with a narrative panel beside it anchors a page. Raise `canvas.height` (for example to 1000) when a page needs
  a header, KPIs and two bands, rather than shrinking them.
- **Amounts in full, units on display.** Store amounts in dollars (a filing's thousands or millions multiplied
  out) and give money measures `"format": "currency", "units": "billions"` (or `millions`, or `auto` when sizes
  vary, such as payment volume in billions beside costs in millions). Cards and text then read $416.16B, axes
  $400B, with no unit in titles or typed around bindings ("**{{ rev }}**", not "${{ rev }}B"). Per-share amounts
  keep `currency` without units ($7.46); counts take `integer`. A matrix's `totals: "row"` keeps each period's
  total and drops the column that adds up the years.
- **Use the look options for meaning, not decoration.** A reference line marks a target or the average a reader
  should compare against (`refLines`); `colors` pins a member to one color across charts (the same name gets the
  same color everywhere) or highlights the one that matters; `varyColors` only when each bar is a different thing
  with its own color elsewhere. Hide an axis only when data labels already carry the values, and gridlines on small
  charts. The theme sets the rest.
- **Honest axes.** Bars start at zero. Zoom a line's axis (`min`, `max`) only when the change is the point, and say
  so in the title.
- **Reference tables last.** As-reported statements or full lists belong on a final page as tables, after the
  pages that explain them.


### 7. Text with live numbers

A `markdown` element is a Mustache template evaluated against the data after the page's slicers, the page and
report filters and the element's own `filters`. Bind the figures that come from the data (totals, rates, the
largest member, a latest value); type the ones that don't:

```json
{"id": "note", "type": "markdown", "x": 0, "y": 6, "w": 12, "h": 2,
 "content": "**{{ rev }}** of revenue at a **{{ gm }}** gross margin, from **{{ units }}** units.",
 "bindings": {
   "rev":   {"table": "fact_sales", "field": "[Revenue]"},
   "gm":    {"table": "fact_sales", "field": "[Gross margin]"},
   "units": {"table": "fact_sales", "field": "units", "aggregate": "sum", "format": "integer"}}}
```

- A binding with a measure (`field: "[Name]"`) shows it in the measure's format. With `compare` (as on a card) it
  shows the comparison instead: "+6.4%" (see Highlights). A field with `aggregate` is one
  value in `format` (`count` needs no field: `{"table": "fact_sales", "aggregate": "count"}`). A field without
  `aggregate` is that column's values (a list); a binding without `field` is the table's rows.
- **One filter context per element.** All bindings in a block see the same filters. To state two years side by
  side, use two blocks with different element `filters`, or a `compare` with `show: "value"`. Don't filter an element on
  the same field a measure's `where` uses (the intersection is empty).
- **Lists** loop over a table: `{{#dim_store | sort: "store"}}- **{{ store }}** ({{ region }})\n{{/dim_store}}`.
  A loop sees only that table's own columns (no joins), so loop over a dimension for names. Row fields inside a
  loop aren't bindings. The first 1000 rows only.
- **Empty states:** a summary with no rows shows "—" (a count shows 0); `{{^rev}}No sales in this selection.{{/rev}}`
  shows when it is empty.
- Values are written as plain text (Markdown inside the data shows as typed); `{{& name}}` writes Markdown.
- Filters, chained: `upper lower title truncate:n round:n format:"percent" date:"MMM d, yyyy"` (tokens `yyyy yy
  MMMM MMM MM M dddd ddd dd d`) `default:"n/a" join:", " first first:n last size sort sort:"field" reverse`.
  `round` and `format` work on raw numbers: bind without `format` to use them.
- `currency` already writes `$`: don't type one before it. For exact or non-US amounts, bind with `number` or
  `integer` and write the unit yourself ("{{ rev }} EUR").
- Words that depend on the data ("up", "a record") can't be computed. Write neutrally ("{{ yoy }} vs 2024"), and
  read each sentence with a negative value too: "a gap of {{ gap }}" is wrong when the stores are ahead ("{{ gap }}
  versus plan" holds both ways).
- Put compared values in parentheses ("**{{ rev }}** ({{ rev_yoy }} vs last year)"): with no earlier period (the
  data's first year) the comparison is "—", which still reads there.
- Text with no data figures needs no bindings: definitions, fixed thresholds ("a target of 95%" set by policy, not
  in the data), dates and period labels (FY2025, 2025 Q1).

#### Highlights

A Highlights block is a `markdown` element titled "Highlights" whose bullets state the page's findings, every
figure bound, so the text updates with the data and the reader's filters.

**When it's appropriate:** a page that reports results (a period's performance, a filing, a review, an executive
overview) with three or more findings worth stating that the visuals alone don't say: a total's change, a share,
a ratio, the largest or smallest member, a gap against a target. Leave it out of pages for exploring or looking
things up, pages with a single chart that already says it, and pages where a finding can't be bound: fewer bullets
beats a typed number.

**How to write it:**

- 3 to 6 bullets. Each opens with a **bold lead-in naming the topic** ("**Revenue**", "**Services**", "**Cash**"),
  then the bound figures and neutral connecting words ("{{ rev }}, {{ rev_yoy }} vs FY2024"). The lead-in names,
  the figures judge: "**Services is the profit engine**" is a claim the next data update may break.
- Lead with the figures the visuals don't show directly: changes, shares, ratios, gaps, extremes. Use the same
  measures as the page's visuals, so text and charts always agree.
- **Changes and gaps come from a binding's `compare`**, as on cards: the same measure with other filters in place
  of the block's own on those fields, shown signed ("+6.4%", "-5.1%"): `{"table": "fact_sales", "field":
  "[Revenue]", "compare": {"shift": "year"}}` against the block's date filter, or `"filters": [...]` for a text
  period label (`fiscal_year` = "2024").
  `show: "difference"` gives the signed gap in the binding's format, `"value"` the other period's number. No
  year-specific measures needed. The sign says the direction: don't write "grew" or "fell" around it.
- **Largest or smallest member:** loop over a table with one row per member (a fact at that grain, or one
  pre-aggregated for it), sorted, first row only. The block's filters reach the loop, so it follows the page:
  `{{#fact_region_year | sort: "revenue" | reverse | first: 1}}- **Largest region:** {{ region }}, {{ revenue | format: "currency" }}\n{{/fact_region_year}}`.
  A loop reads that table's own columns only (no joins), so the row must carry the member's name.
- **Optional facts:** `{{#note}}…{{/note}}` shows a bullet only when there is a value; `{{^rev}}No sales in this
  selection.{{/rev}}` covers an empty filter.
- **One filter context per block**, plus each binding's `compare`. If a bullet needs a different period or segment
  for its main figure, use a second block.
- Place it beside the hero chart (w 4 to 5, the chart's height) or as a short band under the takeaway strip.
  Size its height to its bullets (about 40 px each) and give the rest of the column to a small chart rather than
  empty space.

```json
{"id": "highlights", "type": "markdown", "x": 8, "y": 3, "w": 4, "h": 5, "title": "Highlights",
 "filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2025"]}],
 "content": "- **Revenue** {{ rev }}, {{ rev_yoy }} vs FY2024.\n- **Gross margin** {{ gm }}, {{ gm_gap }} points vs FY2024.\n- **Services** {{ svc_share }} of revenue.\n{{#fact_category_year | sort: \"revenue\" | reverse | first: 1}}- **Largest category** {{ category }}, {{ revenue | format: \"currency\" }}.\n{{/fact_category_year}}",
 "bindings": {
   "rev":       {"table": "fact_sales", "field": "[Revenue]"},
   "rev_yoy":   {"table": "fact_sales", "field": "[Revenue]", "compare": {"filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2024"]}]}},
   "gm":        {"table": "fact_sales", "field": "[Gross margin]"},
   "gm_gap":    {"table": "fact_sales", "field": "[Gross margin]", "compare": {"filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2024"]}], "show": "difference"}},
   "svc_share": {"table": "fact_sales", "field": "[Services share]"}}}
```

The block's filter picks 2025 for every figure; each `compare` swaps in 2024 for its own. A measure's `where`
narrows the filters (it never replaces them), so don't build "vs last year" from a year-specific measure inside a
block filtered to this year: that finds no rows.

### 8. Build and validate

`build_doc.py` writes `doc.json`. A report has 30 to 50 elements, and a handful of helpers keeps each to one
readable line, the grid position first:

```python
def el(id, kind, x, y, w, h, title=None, source=None, **rest):
    e = {'id': id, 'type': kind, 'x': x, 'y': y, 'w': w, 'h': h}
    if title: e['title'] = title
    if source: e['sourceId'] = source
    return {**e, **rest}

def chart(id, x, y, w, h, title, kind, source, mapping, extra=None, **options):
    return el(id, 'chart', x, y, w, h, title, source, chartType=kind, mapping=mapping, options=options, **(extra or {}))

def card(id, x, title, source, measure, compare={'shift': 'year'}, y=1, **rest):
    return el(id, 'card', x, y, 3, 2, title, source, aggregation={'method': 'sum', 'field': f'[{measure}]'}, compare=compare, **rest)

bind = lambda table, measure, compare=None: {'table': table, 'field': f'[{measure}]', **({'compare': compare} if compare else {})}
total = lambda name, table, field, **m: {'name': name, 'table': table, 'format': 'currency', 'units': 'billions', 'aggregate': 'sum', 'field': field, **m}
ratio = lambda name, table, a, b, fmt='percent', op='/': {'name': name, 'table': table, 'format': fmt, 'op': op, 'a': a, 'b': b}
```

Name the fact tables once (`S, G = 'fact_category_sales', 'fact_segment'`), build `relationships` from a list of
`(fact, key, dimension)` triples, and give each page's text strip and slicer a helper too. Then:

```bash
python3 scripts/build_report.py doc.json report.html
python3 scripts/validate_dashier.py report.html          # fix every FAIL; fix or justify every WARN
```

The validator reads the document and the decoded data, and reads, compares and keys values as the app does: it
catches broken references, values that load blank (a number, date or true/false the app can't read), keys that don't
match, filter and slicer values that match nothing (a visual that would show "—" or nothing; `"1.50"` never matches
1.5), template errors, and overlaps. What
it can't judge is how the page reads, so before delivering, reread the document as the reader: does each measure
have a `format` (and money its `units`), does each visual's format suit its numbers (`percent` for fractions), do
sizes fit their content (a list slicer about one row per 4
members, a table one row per 3 data rows), and does each bound sentence say what its chart shows.

### 9. Deliver

The project folder: the report, `data/`, `doc.json` and the two scripts. Reply briefly: what the report covers, any
data caveats (estimates, gaps), how to update it (rerun the scripts on a new source; or edit a CSV, right-click its
table in the Data pane ▸ Replace data…, then Share ▸ Save), anything to roll forward by hand (a typed year in a
filter or title), one natural next step, and a Sources list when the data came from linkable sources.

## How Dashier reads the model

Relationships are filter paths, as in Power BI:

- **A visual is anchored to one table** (`sourceId`, usually the fact). Its own columns are plain names; any
  connected table's columns are `"table.field"`, however many relationships away (they are merged in along the
  nearest path, each table once).
- **Filters** (slicers, element/page/report `filters`, a measure's `where`) travel along relationships from the one
  side (`to`) to the many side (`from`), across any number of them: a slicer on `dim_region.region` filters
  `dim_store`, and through it `fact_sales`. With `crossFilter: "both"` a relationship also passes filters back from
  the many side. A filter on a relationship's key field itself crosses either way. A filter that can't reach a
  table leaves it unfiltered (a slicer on one dimension doesn't narrow another dimension's visuals unless a "both"
  relationship links them through a fact).
- **A slicer** lists the values of its own table's column (`sourceId` + `field`), so put it on the dimension: it
  lists every member, sorted. A preset pick is its `selection`: `{"values": [...]}` for listed members (a date's
  buckets with `datePart`: `"2025"`, `"2025 Q1"`, `"2025-01"`), `{"min": 0, "max": 100}` for a `range` of numbers,
  `{"from": "2025-01-01", "to": "2025-06-30"}` for a date slicer without `datePart` or with `"style": "range"`.
- **Measures** work in any connected visual and are evaluated in the cell's context (its grouping values and all
  filters, propagated to the measure's table). A grouping field that can't reach the measure's table doesn't split
  it (every bar shows the same value), exactly like Power BI: group by shared dimensions.
- **Keys** match by value and ignoring case; a `to` table is a lookup (its first row per key), so a fact row is
  never repeated by a dimension. Joining from a dimension to a fact does repeat dimension rows, one per fact row.
- **Totals and subtotals** recompute measures over the total's rows (a margin's total is the margin of the
  total), and sum plain fields.
- **Date grouping** is built in: `dateParts` on chart axes, `datePart` on table and matrix fields and slicers, and
  dates sort oldest first. A date dimension is still worth it for fiscal periods, custom labels and shared period
  slicers.

## How numbers are shown

Every number on a report goes through one of three writers. Knowing which one a surface uses tells you what the
reader will see.

**1. Values (cards, text bindings, table and matrix cells, a gauge's center)** use the value's `format` and `units`:

| format | 0.004 | 0.336 | 7.456 | 182.5 | 1234.5 | 999999.9 | 416161000 |
|---|---|---|---|---|---|---|---|
| `number` | 0.004 | 0.34 | 7.46 | 182.50 | 1.2K | 1.0M | 416.2M |
| `integer` | 0 | 0 | 7 | 183 | 1,235 | 1,000,000 | 416,161,000 |
| `currency` | $0.004 | $0.34 | $7.46 | $183 | $1,235 | $1,000,000 | $416,161,000 |
| `percent` | 0.4% | 33.6% | 745.6% | | | | |

- `number` keeps up to 2 decimals under 1,000 (whole numbers as they are) and compacts from 1,000 with 1 decimal
  (K, M, B, T). `currency` is US dollars: whole dollars from $100, cents below it (a price reads $5.86, $5 when
  whole), two significant digits under half a dollar. `percent` multiplies a fraction by 100 and keeps 1 decimal.
- `units` divides and suffixes to 2 decimals (whole with `integer`): `thousands` K, `millions` M, `billions` B,
  and `auto`, the largest unit the value reaches (under 1,000 it reads as its format). 416161000000 as `currency`
  with `billions` is $416.16B; 1093587000 as `integer` with `millions` 1,094M; -52764000 with `auto` -$52.76M.
  `percent` ignores units.
- Where a value's format comes from: a card's or binding's own `format`/`units`, a table column's, a matrix value's,
  else its measure's (a `pct-diff` measure defaults to `percent`). With none, a card uses `number`; a text binding
  writes the raw number at full precision (meant for the `round` and `format` filters); a table cell writes the
  number in the viewer's locale with up to 3 decimals, a matrix cell up to 2. A table column's `date` and `string`
  formats leave values as written (dates stay ISO).
- `integer` and unformatted table and matrix cells use the viewer's browser locale for separators (1.235 in
  Germany); `currency`, `number`, `percent` and units always read US-style.

**2. Charts (axes, data labels, pie legends, treemap and sankey labels)** write compact numbers in the chart's
format: `options.format`, else the y measure's format (never its units). Axis ticks take as many decimals as keep
them apart ($0, $50B, $100B); data labels keep 3 significant digits under 1,000 ($7.46, 67.1, $225) and 1 decimal
above ($1.1B). `options.units` fixes every label to one unit ($0.4M, $1.25M). A value shown as a share
(`percent-of-total`, 100% stacking) reads 25%; a `compare` shown as a % change reads in percent. **Tooltips** are
exact: whole dollars for currency (with units too: $416,161,000,000), up to 2 decimals for numbers, 3 significant
digits under 1.

**3. Comparisons (a card's line, a binding with `compare`, chart and matrix values with `compare`)**: `change` is
(this − other) / |other| as a signed percent (+6.4%); `difference` is signed in the value's format and units
(+$25.13B, +1.6% for a rate, +0.07 for a plain number, which rounds to the hundredth); `value` is the other
period's number, unsigned. With nothing to compare (the data's first year) a card drops the line and a binding
writes "—". A card colors a change green when it rises and red when it falls (`invert: true` for costs); `value`
stays uncolored. Its label is the moved filter's period ("vs 2024", "vs 2025 Q3"), else "vs last year" or
"vs previous period", unless `label` is set.

Recipes:

| Numbers | Store | Measure |
|---|---|---|
| Money, large (revenue, cash) | full dollars | `"format": "currency", "units": "billions"` (or `millions`; `auto` when one report mixes sizes) |
| Money per unit (EPS, a price) | dollars | `"format": "currency"`, no units ($7.46) |
| Counts (employees, orders) | whole numbers | `"format": "integer"` |
| Rates, margins, shares | fractions (0.468) | `"format": "percent"`; compare as `difference` |
| Scores, ratios (4.39, 1.8x) | plain numbers | `"format": "number"` (2 decimals); "x" or the scale in the title |
| Other currencies | amounts | `number` or `integer` with units, the currency in the title or text ("€ millions") |

## Power BI concepts in Dashier

| Power BI | Dashier |
|---|---|
| One-to-many relationship, single direction | relationship with the fact as `from`, the dimension as `to` (no join kinds: as in Power BI, every fact row stays, unmatched ones under (Blank)) |
| Cross filter direction "Both" | `"crossFilter": "both"` on the relationship |
| Many-to-many through a bridge | a bridge table with `crossFilter: "both"` on the bridge-to-dimension side (see patterns) |
| Explicit DAX measure | measure: one summary with `where` conditions (any connected table's columns, all must hold), or a two-operand calculation (operands may be other tables' measures); chain for more |
| Sort by column | `"sortBy"` on the column in `structure` |
| Card reference label (vs prior period, vs target) | a card's `compare` |
| Implicit measure (summarize a column) | a field with `aggregate` / `summary` in the visual |
| Calculated column | precompute in the CSV, row-level only (a category, a band); never a ratio of sums |
| Date table, time intelligence | `dim_date` or `dim_month`; `dateParts`; `compare` (same period last year, previous period) on cards, text, chart values and matrix values; `showAs: "running-total"` (year to date under a year filter); `last` filters (`{"field": "date", "table": "...", "last": {"n": 12, "unit": "month"}}`); anything else precomputed in pandas |
| Show value as: running total, % of grand total | `summary.showAs` / a matrix value's `showAs`: `running-total`, `percent-of-total` |
| Display units, value decimal places | `units` on the measure or visual (`thousands`, `millions`, `billions`, `auto`): 2 decimals, or whole with `integer` |
| Format pane: data labels, axes, gridlines, series colors, legend | chart `options`: `showValues`, `valueAxis`, `categoryAxis`, `xAxisLabel`, `yAxisLabel`, `gridlines`, `colors`, `legendPosition` |
| Analytics pane: constant, average, median, min, max lines | `options.refLines` |
| Matrix row and column grand totals | `totals`: `"row"`, `"column"` or false |
| Inactive relationship / USERELATIONSHIP | one dimension table per role (`dim_order_date`, `dim_ship_date`) with self-describing columns (`order_year`, `ship_year`) |
| Hierarchy, drill down | matrix `rows` outer first (expand/collapse); charts show one level each |
| Hidden column | none: keep raw keys out of visuals and label columns readably |
| Top N filter | `options.topN` |
| Conditional formatting | `cond: "scale"` or `"bars"` on table columns and matrix values |
| Visual-level / page / report filters | `filters` on the element / page / document, each with `table` |
| Sync slicers across pages | a report-level `filters` entry (not interactive) or one slicer per page |
| Bookmarks, drill-through, RLS, tooltips pages | not available |

## Modeling patterns

- **Date dimension.** `dim_month` (or `dim_date`): one row per period in the fact's range, contiguous with no
  gaps, key in the fact's format (`2025-03-01`), plus `year` (string), `quarter` ("2025 Q1"), `month` label
  ("2025-03"), and `fiscal_year` / `fiscal_quarter` if the business uses them. One table, not `dim_quarter` →
  `dim_year`. **Fiscal periods** get a date whose year and quarter are the fiscal ones (FY2025 → `2025-01-01`;
  FY2025 Q2 → `2025-04-01`) next to the real `period_end`: year and quarter buckets, slicers and `compare` shifts
  then read "2025" and "vs 2024" in the reader's fiscal terms (title the slicer "Fiscal year"). Annual data (a
  10-K's three years) works the same with a `dim_year`.
- **Snowflakes.** Work (filters and fields cross any number of relationships), but as Power BI's guidance says,
  one flattened `dim_product` with `subcategory` and `category` columns is simpler to read and to slice. The
  exception is a fact at a coarser grain: when cost of sales is reported for Products and Services only while
  net sales are by category, `fact_cost` links to a small `dim_kind` and `dim_category → dim_kind` ties them
  (a shrunken dimension). Gross margin then works by kind and never by category, which is what the data supports.
- **Role-playing dates.** One table per role; each fact date column links to its own table (a visual joins a
  table once, along the nearest path, so two relationships between the same tables can't play two roles).
- **Different grains** (daily sales, monthly targets by region). Two facts sharing the same dimensions
  (conformed dimensions): `dim_month`, `dim_region`. A slicer on a shared dimension filters both, and a visual on
  `fact_sales` grouped by `dim_region.region` can show `[Target]` and `[Attainment]` next to `[Revenue]`. Group such
  visuals only by the shared dimensions, at the coarser grain (region and month, not store or day), or the target
  repeats on every row. Any shared dimension works, not just dates: with `dim_function` shared by `fact_expense` and
  `fact_headcount`, "expense per employee by function" is one measure, `[Operating expenses]` ÷ `{"measure":
  "Employees", "table": "fact_headcount"}`. A measure whose table the grouping doesn't reach stays at its total
  (revenue by function is all revenue), which is what "expenses as a share of revenue, by function" needs.
- **Many metrics with the same shape** (financial statements, KPI scorecards): a long fact `fact_kpi (period,
  metric_id, value)` and `dim_metric (metric_id, metric, group, unit, sort_order, sign)`. Chart one metric with an
  element filter on `dim_metric.metric`. Keep units consistent within a visual. Never keep a wide and a long copy
  of the same data. Published reconciliations (profit to adjusted EBITDA, operating cash flow to free cash flow)
  fit the same shape: `fact_reconciliation (period, line, amount)` and `dim_line (line, reconciliation,
  line_order)`, one matrix per reconciliation (element filter on `reconciliation`, rows `line`, columns the
  period); its total row is the adjusted figure, so check the lines add up to it when you extract them.
- **Snapshot facts (balances, inventory, headcount).** Semi-additive: they add across members but not across
  time. Show them with a period on the axis, or filter cards to the latest period (element filter on the period
  key, or `last`); never sum across periods.
- **Events and notes** (a dividend, a reorganization) that would otherwise be typed: a small fact
  `fact_events (period, metric_id, value, note)` linked to the dimensions, then bound captions
  (`{{ note | first }}`).
- **Degenerate dimension.** An order number or invoice id stays on the fact as a column; no table of its own.
- **Junk dimension.** Several small flags (channel, status, priority) can share one `dim_order_profile` with a key
  per combination when they clutter the fact.
- **Slowly changing dimension (type 2).** Rows per version with a surrogate key, `valid_from`, `valid_to`,
  `is_current`; the fact carries the surrogate key of the version in force.
- **Many-to-many** (a salesperson in several regions): a bridge `bridge_rep_region (rep_id, region_id)` with
  `bridge → dim_region` and `bridge → dim_rep` (bridge as `from`), the latter with `crossFilter: "both"`, and
  `fact_sales → dim_rep`. A slicer on `dim_region` then filters the sales of that region's reps, exactly. Grouping a
  fact by the bridged attribute repeats a fact row per member: per-member values are right, but turn table and
  matrix `totals` off (they would count shared rows twice).

## Element reference

All elements: `id` (unique), `type`, `x` 0..11, `y`, `w` 1..12 (x + w ≤ 12), `h`, `title`, `sourceId`, `filters`.

```json
{"id": "k_rev", "type": "card", "x": 0, "y": 0, "w": 3, "h": 2, "title": "Revenue", "sourceId": "fact_sales",
 "aggregation": {"method": "sum", "field": "[Revenue]"}, "compare": {"shift": "year"}}

{"id": "c_trend", "type": "chart", "chartType": "bar", "x": 0, "y": 2, "w": 8, "h": 4, "title": "Revenue by quarter and category",
 "sourceId": "fact_sales", "mapping": {"x": "dim_month.quarter", "y": "[Revenue]", "group": "dim_product.category"},
 "options": {"stack": "stacked", "legendPosition": "bottom"}}

{"id": "c_mix", "type": "chart", "chartType": "donut", "x": 8, "y": 2, "w": 4, "h": 4, "title": "Revenue by category",
 "sourceId": "fact_sales", "mapping": {"x": "dim_product.category", "y": "revenue"}, "summary": {"aggregate": "sum"},
 "options": {"topN": 5, "showValues": true}}

{"id": "c_combo", "type": "chart", "chartType": "combo", "x": 0, "y": 2, "w": 12, "h": 4, "title": "Actual (columns) and target (line)",
 "sourceId": "fact_performance", "mapping": {"x": "dim_month.month", "y": "[Actual]", "line": "[Target]"}}

{"id": "m_detail", "type": "matrix", "x": 0, "y": 1, "w": 12, "h": 7, "title": "Revenue and margin by region and store",
 "sourceId": "fact_sales", "rows": [{"field": "dim_store.region"}, {"field": "dim_store.store"}], "columns": [{"field": "dim_month.year"}],
 "values": [{"field": "[Revenue]", "label": "Revenue"}, {"field": "[Gross margin]", "label": "Margin", "cond": "scale"}]}

{"id": "t_stores", "type": "table", "x": 0, "y": 0, "w": 6, "h": 3, "title": "Stores", "sourceId": "dim_store", "totals": false,
 "columns": [{"field": "store", "label": "Store"}, {"field": "region", "label": "Region"}]}

{"id": "s_region", "type": "slicer", "x": 9, "y": 0, "w": 3, "h": 2, "title": "Region", "sourceId": "dim_store", "field": "region", "style": "tiles"}

{"id": "s_month", "type": "slicer", "x": 0, "y": 0, "w": 4, "h": 1, "title": "Period", "sourceId": "dim_month", "field": "month", "datePart": "quarter", "style": "dropdown"}
```

- **chart:** `chartType` bar | hbar | line | area | combo | scatter | pie | donut | radar | treemap | sankey | gauge.
  `mapping` x (category; sankey source; treemap leaf), y (value), group (series; sankey target; treemap parent),
  line (combo), detail (scatter points). `summary: {aggregate, showAs (percent-of-total | running-total),
  compare}` for y, `lineSummary` (the same, for a combo's line), `xSummary`, `dateParts: {x: "month"}`. `options`: title, showLegend, legendPosition
  (bottom | top | right | left), showValues, yAxisLabel, xAxisLabel, min, max, format, units, sort (value-desc |
  value-asc | label), topN, stack (stacked | percent; lines take percent only); the look: valueAxis / categoryAxis /
  gridlines (false hides), colors (`{"Services": "#ef4444"}`, by series, slice or category name), varyColors,
  barWidth (0.2 to 1), barRadius, lineWidth, markers, donutHole, and refLines (`[{"stat": "average"}]`,
  `[{"value": 400000000000, "label": "Target"}]`: dashed, labelled with the value).
- **card:** `aggregation: {method, field}`, `format`, `units`, `callout: {size, color, align}`, `subtitle` (static), `compare: {shift | filters |
  field, show, label, invert}` (the comparison line), `staticValue` (last resort). min/max/first/last/mode also read text and
  dates.
- **table:** `columns: [{field, label, align, format (number | integer | currency | percent; date and string leave
  values as written), units,
  aggregate, showAs, datePart, cond}]`, `totals`, `grid: {density (compact | roomy), banded, lines (both | none),
  textSize}`. Any aggregated column groups the table by the others.
- **matrix:** `rows`, `columns` (`{field, datePart}`), `values` (`{field, label, aggregate, showAs, compare, format,
  units, cond}`), `subtotals`, `totals` (false, or `"row"` / `"column"` to keep only the total row or column), `grid`.
  Values in different units: turn `totals` off or split the matrix.
- **slicer:** `field` of `sourceId`, `style` list | dropdown | tiles | range, `single`, `datePart`,
  `selection: {values | min, max | from, to}` (the saved pick).
- **markdown:** `content`, `bindings` (`{table, field, aggregate, format, units, compare}`), `textSize`, `align`.

Document: `title`, `theme` (`mode` light | dark | auto, `background`, `surface`, `text`, `muted`, `border`,
`accent`, `positive` and `negative` (a comparison's good and bad news, set to suit the theme's colors), `palette`
[8 colors], `font`, `radius`), `canvas` (`{"width": 1440, "height": 810}`; portrait
`1080×1440`, A4 `1123×794`), `filters` (every page), `relationships`, `measures`, `pages` (`id`, `title`,
`elements`, `filters`). `report.html#<page id>` opens a page; `#preview` hides the editor; `#fit` fits the page to the window (`#preview,fit` for a report embedded in a frame).

## Gotchas

- Write every `<` inside the JSON as `\u003c` (`build_report.py` does it). Never touch the packed app.
- A table is its `structure` and its `payload`: gzip+base64 of a CSV with one line per column, its name then its
  values. Edit the CSVs
  and rerun `build_report.py`; to read a payload in Python: `rows = list(zip(*csv.reader(io.StringIO(gzip.decompress(base64.b64decode(p)).decode()))))`
  (header first), and back: `csv.writer(f).writerows(zip(*rows))` on an `io.StringIO` `f`, then
  `base64.b64encode(gzip.compress(f.getvalue().encode())).decode()`.
- A measure grouped by a field that doesn't reach its table shows the same value on every bar: check the filter
  direction of the relationships between them.
- A column typed `float` holding `$1,234` or `12%` loads blank. A day-first date column (`05/01/2024`) is read
  day-first only when some value makes it unambiguous: write ISO.
- `percent` expects fractions (0.125, not 12.5). A binding already writes `$` and its units: "${{ rev }}B" shows
  "$$416.16BB". A measure without a `format` reads as `number` on a card (1.1K for 1,094) and raw in text
  (1093.5869999 unless a filter rounds it): give every measure one.
- `number` compacts from 1,000 (1,094 is 1.1K); use `integer` or `units` for exact or scaled amounts.
- Matrices and tables sum plain fields at totals; a column that doesn't add up (a price, a rate, a balance across
  time) needs a measure or `totals: false`.
- A chart with a dimension attribute on x or in the legend lists it in fact-row order unless the attribute has a
  `sortBy` column: give it one, or sort the CSV oldest first (`options.sort` reorders x categories, not legend
  series).
- Pie and donut: at most about 6 slices (`topN` folds the rest into "Other").
- Long category names: hbar, or `legendPosition: "right"` for long series names.
- Slicer styles: `range` is the default for numeric fields; type label-like numbers as strings.

## References

- Microsoft Learn, *Understand star schema and the importance for Power BI*:
  https://learn.microsoft.com/power-bi/guidance/star-schema (dimension and fact tables, snowflakes, role-playing,
  slowly changing, junk and degenerate dimensions, factless facts)
- Microsoft Learn, *Design guidance for date tables in Power BI Desktop*:
  https://learn.microsoft.com/power-bi/guidance/model-date-tables
- Microsoft Learn, *Model relationships in Power BI Desktop*:
  https://learn.microsoft.com/power-bi/transform-model/desktop-relationships-understand
- Kimball Group, *Dimensional modeling techniques* (four-step design, grain, conformed dimensions):
  https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/
