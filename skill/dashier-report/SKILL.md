---
name: "dashier-reports"
description: "Build and edit expert Dashier dashboards: single-file .html reports whose document is a dashier+json block. Use for any Dashier request (a new report from data, adding pages or visuals, fixing or reviewing one). It models the data as a star schema (fact and dimension tables, relationships, measures) so every visual can be built from it, in code or later in the editor, binds every number that comes from the data, and checks the model before handing it over."
---

# Expert Dashier reports

A Dashier report is one HTML file: the app (packed, never edited) plus the document, plain JSON in one block
(`<script type="application/dashier+json" id="dashier-doc">`). You build the document: a **star schema** (dimension
tables to filter and group by, fact tables to summarize, relationships, measures for every derived number) and
**pages** of visuals bound to it. The model is what matters most: when it is clean, any chart can be built from it,
by you now or by the user in the editor later.

| Script (in `scripts/`, run them, don't retype them) | Does |
|---|---|
| `get_dashier.py [OUT.html]` | downloads the current editor, the template a new report is built from |
| `build_report.py [TEMPLATE.html] DOC.json OUT.html` | writes DOC.json into a copy of the template (downloaded when none is given); a source `{"file": "data/x.csv"}` is packed and typed as the app types it |
| `validate_dashier.py OUT.html` | checks the model against its data and every reference; exit 0 = no FAIL. `--style` adds notes on how pages read; `--render` (Playwright) fails visuals that render empty |

Open these when the step needs them, not before:

| File | When |
|---|---|
| [references/extract.md](references/extract.md) | writing `extract.py`: pandas connectors, shaping a star, checking totals, values Dashier can't compute |
| [references/model.md](references/model.md) | how filters and measures travel; measure patterns (targets, YoY, shares); modeling patterns (dates, grains, bridges) |
| [references/visuals.md](references/visuals.md) | laying out pages, choosing visuals, the full element reference |
| [references/text.md](references/text.md) | text boxes with bound numbers, Highlights |
| [references/numbers.md](references/numbers.md) | formats, units, currency, what readers see on cards, charts and comparisons |

## Rules that are never skipped

1. **Star schema.** Facts (`fact_*`) hold events or observations at one grain, with keys and numbers. Dimensions
   (`dim_*`) hold one row per member with a unique key and readable attributes. Every fact links to its
   dimensions; with more than one table, `relationships` is never empty.
2. **Derived numbers are measures, never columns.** Margins, ratios, shares, per-unit values and growth are
   measures, recomputed for every bar, row and total. A stored ratio is wrong at every total.
3. **Numbers from the data are bound, not typed.** A figure in text that comes from the data is a `{{ variable }}`.
   Titles carry no data figures.
4. **Filters name their table:** `{"field": "region", "table": "dim_store", "values": ["North"]}`.
5. **Everything is regenerated from code.** `extract.py` and `build_doc.py` rebuild the report from the source with
   no model in the loop: never type data into CSVs or hand-edit `doc.json`.
6. **The template's document is not a model.** `build_report.py` replaces it; never copy its pages or tables.

Work in one pass: don't ask the user to approve the model or the layout. Ask only about a choice that is hard to
undo and could reasonably go either way.

## Workflow

Each report is a folder of two scripts that take the source to the document:

```
apple-10k/
  extract.py              source → data/*.csv: the star schema, amounts in full, checked against the source's totals
  data/                   dim_*.csv and fact_*.csv
  build_doc.py            data/ → doc.json: sources, relationships, measures, pages
  doc.json
  apple-10k.dashier.html  build_report.py's output
```

```bash
python3 extract.py                 # writes data/ (pandas: see references/extract.md)
python3 build_doc.py               # writes doc.json
python3 <skill>/scripts/build_report.py doc.json apple-10k.dashier.html
python3 <skill>/scripts/validate_dashier.py apple-10k.dashier.html
```

When the source changes, the user reruns the four commands: no tokens spent. For sample data, a seeded
`make_data.py` takes the place of `extract.py`. Sources in `doc.json` point at the CSVs (`{"file":
"data/fact_sales.csv"}`, relative to `doc.json`).

### 1. Template

A new report needs no file from the user: `build_report.py` downloads the editor when given no template. To change
an existing report, use it as the template and build into a new file (never overwrite the original); keep its
structure unless asked. Never decode or read the packed app (the `dashier-js` block).

### 2. Design the model

Write down the 3 to 6 questions the report must answer, then (Kimball's four steps):

1. **Business process.** Each process that produces numbers (sales, budget, tickets) is a fact table.
2. **Grain.** One sentence for what one fact row is ("one row per month, store and product"). Different grains are
   different facts (daily sales, monthly targets) sharing the same dimensions.
3. **Dimensions.** The nouns the questions group and filter by: period, product, customer, region. One table each,
   one row per member.
4. **Facts.** The additive numbers at that grain, raw amounts at full precision, not rates.

Flat source sheets get split: repeated descriptive columns move to a dimension, the fact keeps the key. How
filters and measures travel through the model, and the patterns for dates, different grains, statements and
many-to-many, are in [references/model.md](references/model.md).

### 3. Tables (written by `extract.py`)

- **Keys.** A dimension key is unique and never blank. Keys match as numbers by value (`2024` = `2024.0`), text
  trimmed and ignoring case; a leading-zero code stays text. A repeated dimension key matches its first row only.
- **Every fact key exists in its dimension**, or it shows as "(Blank)": add an "Unknown" member for gaps.
- **Columns are the labels readers see:** `region`, `store`, not `rgn_cd` (`cost_type` reads "Cost type").
- **Natural orders get a sort-by column:** `{"name": "month", "type": "string", "sortBy": "month_number"}` in
  `structure` orders that label everywhere (months, quarters, statement lines, bands, stages). Without one, labels
  sort as text (`2025 Q1`, not `Q1 2025`).
- **Values are plain:** `1234.5` (never `$1,234.50`, `12%`, `1.2K`: those load blank), percentages as fractions,
  dates ISO (`2025-03-31`), booleans `true`/`false`. Years, ids and codes used as labels are typed `string`.
- **Rows oldest first** in facts: categories and legend series without a sort-by column appear in the order rows
  first mention them.
- **No dots or brackets** in table or column names (`table.field` and `[measure]` are reference syntax).

### 4. Relationships

One per fact-to-dimension link, the fact (many side) as `from`, the dimension (one side) as `to`:

```json
{"from": {"table": "fact_sales", "field": "store_id"}, "to": {"table": "dim_store", "field": "store_id"}}
```

Filters flow from `to` to `from`. Never point a dimension at a fact. `cardinality` is `many-to-one` by default
(`one-to-one` when both columns are unique, `many-to-many` only for a bridge); `"crossFilter": "both"` only where a
fact must filter a dimension (a bridge). Snowflakes work: filters and fields cross any number of relationships.

### 5. Measures

A measure lives on one table and works in any visual connected to it as `"[Name]"`, worked out for each bar, cell,
row, card and total in its filter context (like a DAX measure). Names are unique and never repeat a column name of
their table.

```json
{"name": "Revenue", "table": "fact_sales", "aggregate": "sum", "field": "revenue", "format": "currency", "units": "millions"}
{"name": "Software revenue", "table": "fact_sales", "aggregate": "sum", "field": "revenue", "where": {"table": "dim_product", "field": "category", "values": ["Software"]}, "format": "currency", "units": "millions"}
{"name": "Gross margin", "table": "fact_sales", "op": "/", "a": {"measure": "Gross profit"}, "b": {"measure": "Revenue"}, "format": "percent"}
{"name": "Attainment", "table": "fact_sales", "op": "/", "a": {"measure": "Revenue"}, "b": {"measure": "Target", "table": "fact_targets"}, "format": "percent"}
```

- Summary: `aggregate` (sum, avg, min, max, median, count, distinct, mode, first, last, stdev, var) of a `field`
  (`count` needs none), optionally `where`: one `{field, values, table}` condition or a list, all of which must
  hold, on the measure's table or a connected one. Values match as text (`"2025"`).
- Calculation: `op` `+ - * / pct-diff` on operands `{"measure": ...}` (with `"table"` for another table's),
  `{"field": ...}` (its sum) or `{"value": 100}`. Chain measures for longer formulas.
- Give every measure a `format` (`number`, `integer`, `currency`, `percent`) and money its `units` (`thousands`,
  `millions`, `billions`, `auto`): it reads that way on every card, cell and text. See
  [references/numbers.md](references/numbers.md); the document's `currency` sets the currency.
- Year over year, year to date, shares and moving averages need no extra measures: they are `compare` and `showAs`
  on the visual ([references/model.md](references/model.md)).

### 6. Pages

Build the pages that answer the questions, each anchored on the fact (`sourceId: "fact_sales"`) with dimension
attributes as `"dim_store.region"`. A typical page: a bound headline sentence, KPI cards with `compare`, one main
chart, supporting visuals. The user can add more visuals in the editor from the same model, so a few well-built
pages beat many.

**Filters, not a wall of slicers.** A slicer is a visual on one page; it costs space on every page it's copied to.
Give a page at most 3, the ones its question turns on (usually the period and one or two key dimensions), on
dimension tables. A scope that applies to the whole report (a year, a business unit, excluding test rows) is a
document `filters` entry, written once; one that applies to a page is that page's `filters`. Both are edited in
the editor's Filters pane, so never mirror every dimension as a slicer on every page. Layouts, the visual for each question and the full element syntax
are in [references/visuals.md](references/visuals.md); bound text in [references/text.md](references/text.md).

### 7. build_doc.py

A report has 30 to 50 elements; a handful of helpers keeps each to one line, the grid position first:

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

Build `relationships` from `(fact, key, dimension)` triples. Document fields: `format: "dashier"`, `version: 1`,
`title`, `theme`, `canvas`, `currency`, `sources`, `relationships`, `measures`, `pages` (`id`, `title`, `elements`,
`filters`), `filters`.

### 8. Validate once

Run the validator, fix every FAIL (a visual that will be empty or wrong, a model that drops or inflates rows), and
fix the WARNs about the model and its data (keys, relationships, types, measures) unless there is a reason not to.
Then rebuild and validate once more. That's enough to deliver: the validator checks keys, joins, references,
filter and slicer values and templates as the app reads them. `--style` notes are optional polish.

### 9. Deliver

The project folder: the report, `data/`, `doc.json` and the two scripts. Reply briefly: what the report covers, the
model (facts, dimensions, measures), any data caveats, how to update it (rerun the scripts), and a Sources list
when the data came from linkable sources.

## Gotchas

- A measure grouped by a field that can't reach its table shows the same value on every bar: check the
  relationships' direction.
- `percent` expects fractions (0.125). A binding already writes its currency symbol and units: never type them around it.
- `number` compacts from 1,000 (1,094 is 1.1K): use `integer` or `units` for exact or scaled amounts.
- A date column like `05/01/2024` is read day-first only when some value makes it unambiguous: write ISO.
- Write every `<` inside the JSON as `<` (`build_report.py` does it).
