# Text with live numbers

A `markdown` element is a Mustache template evaluated against the data after the page's slicers, the page and
report filters and the element's own `filters`. Bind the figures that come from the data; type only the ones that
don't (a policy threshold, a period label):

```json
{"id": "note", "type": "markdown", "x": 0, "y": 6, "w": 12, "h": 2,
 "content": "**{{ rev }}** of revenue at a **{{ gm }}** gross margin ({{ rev_yoy }} vs last year).",
 "bindings": {
   "rev":     {"table": "fact_sales", "field": "[Revenue]"},
   "rev_yoy": {"table": "fact_sales", "field": "[Revenue]", "compare": {"shift": "year"}},
   "gm":      {"table": "fact_sales", "field": "[Gross margin]"}}}
```

- A binding to a measure (`field: "[Name]"`) shows it in the measure's format; with `compare` (as on a card) it
  shows the comparison: "+6.4%" (`show: "difference"` the signed gap, `"value"` the other period's number;
  `"filters": [...]` in place of `shift` for a text period label). A field with `aggregate` is one value in
  `format` (`count` needs no field). A field without `aggregate` is the column's values; no `field` is the table's
  rows.
- **One filter context per element.** To state two periods side by side, use two blocks with different `filters`,
  or a `compare`. Don't filter a block on the field a measure's `where` uses.
- **Lists** loop over a table: `{{#dim_store | sort: "store"}}- **{{ store }}** ({{ region }})\n{{/dim_store}}`. A
  loop sees that table's own columns only (no joins), first 1000 rows. Row fields inside a loop aren't bindings.
- **Largest member:** a loop over a table with one row per member, sorted, first row:
  `{{#fact_region_year | sort: "revenue" | reverse | first: 1}}**{{ region }}**, {{ revenue | format: "currency" }}{{/fact_region_year}}`.
- **Empty states:** `{{^rev}}No sales in this selection.{{/rev}}`; a summary with no rows shows "—" (a count 0).
- Values are plain text; `{{& name}}` writes Markdown. Filters, chained: `upper lower title truncate:n round:n
  format:"percent" date:"MMM d, yyyy" default:"n/a" join:", " first first:n last size sort sort:"field" reverse`.
  `round` and `format` work on raw numbers: bind without `format` to use them.
- A `currency` value already writes its symbol and a value with `units` its suffix: never type them around a
  binding ("${{ rev }}B" shows "$$416.16BB").
- Write neutrally around signed figures ("{{ yoy }} vs 2024", not "grew {{ yoy }}"), and put comparisons in
  parentheses: with no earlier period they read "—".

## Highlights

A `markdown` element titled "Highlights": 3 to 6 bullets with the page's findings, every figure bound. Use it on
pages that report results (a period, a filing, an executive overview); leave it out of exploration and look-up
pages, and drop a bullet rather than type a number.

- Each bullet opens with a **bold topic** ("**Revenue**", "**Services**"), then the bound figures with neutral
  words. The lead-in names; the figures judge.
- Prefer what the visuals don't show directly: changes, shares, ratios, gaps, extremes, from the same measures as
  the page's visuals.
- Place it beside the hero chart (w 4 to 5, the chart's height), about 40 px per bullet.

```json
{"id": "highlights", "type": "markdown", "x": 8, "y": 3, "w": 4, "h": 5, "title": "Highlights",
 "filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2025"]}],
 "content": "- **Revenue** {{ rev }}, {{ rev_yoy }} vs FY2024.\n- **Gross margin** {{ gm }}, {{ gm_gap }} points vs FY2024.",
 "bindings": {
   "rev":     {"table": "fact_sales", "field": "[Revenue]"},
   "rev_yoy": {"table": "fact_sales", "field": "[Revenue]", "compare": {"filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2024"]}]}},
   "gm":      {"table": "fact_sales", "field": "[Gross margin]"},
   "gm_gap":  {"table": "fact_sales", "field": "[Gross margin]", "compare": {"filters": [{"table": "dim_period", "field": "fiscal_year", "values": ["2024"]}], "show": "difference"}}}}
```
