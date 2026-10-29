# Dashier

Interactive reports in **one HTML file**. The editor is 139 KB: open it in a browser, build a report, **Share ▾ → Save** to write it back in place, and send the file to anyone. They open it in any browser, filter it, and can edit it too. There's no server, no account and no network request; the data travels compressed inside the file.

The whole report (model, measures, pages, theme and data) is one JSON block in the file, so an LLM agent can build or edit it as easily as you can. The [Dashier skill](skill/dashier-report) teaches it how.

**Try it:** https://mvit.github.io/dashier/ (the editor, a sample report and the skill).

MIT licensed. Free.

## What's in this repository

| Path | What it is |
|---|---|
| `src/`, `index.html` | The app (Solid.js) and the page template, whose head carries the editing guide for people and LLMs |
| `dist/dashier.html` | The built editor, opening on its tutorial: the one file you share |
| `skill/dashier-report/` | The LLM skill: `SKILL.md` plus `get_dashier.py` (downloads the current editor from the site), `build_report.py` (writes a document into a Dashier file) and `validate_dashier.py` (checks it) |
| `site/` | The landing page, with the editor, the sample report and the skill as a zip. Every push to `main` rebuilds the editor and the zip into it and publishes it to https://mvit.github.io/dashier/ (`.github/workflows/pages.yml`) |
| `tests/`, `test-*.cjs`, `test-unit.mjs` | Unit tests, checks on the built file and browser tests |

## Use

```bash
npm install
npm run dev        # develop
npm run build      # -> dist/dashier.html  (the single shareable file)
npm test           # unit tests (aggregation, charts, dates, filters, joins, Markdown) + checks on the built file
npm run unit       # just the unit tests (a fraction of a second)
npm run upgrade -- report.dashier.html   # give a saved report the current build (keeps its document)
npm run e2e        # drives it in headless Chrome/Edge (edit, filters, data dialogs, save → reload, encryption)
npm run phone      # the sample report at 390×844, 360×800 and 844×390 (Playwright): layout and touch checks, screenshots in test-results/phone/
python3 tests/test_validator.py   # the skill's build_report.py and validate_dashier.py (after npm run build)
```

`npm test` fails if the packed app (gzip + base85 of the JS and CSS) passes **140 KB**; it's 113 KB now. The guide and the tutorial document don't count toward it.

The file opens in the editor. **▶ Preview** hides the chrome (Esc to return).

The report page has a fixed size (default 1440×810, set under **Page size** when nothing is selected; stored as `canvas`). It is never reflowed to fit the window (except on a phone, below): zoom it with a trackpad pinch or the status bar at the bottom of the window (slider, −/+, **Fit width**, **Fit page**). The browser's own zoom (Ctrl/⌘ +/−/0, Ctrl + wheel) resizes the editor UI as usual. Pan with the scrollbars, by dragging the background, or with Space + drag or the middle button. The page grows taller if visuals run past the bottom. A `#preview` URL hash opens straight into preview, `#<page id>` opens a page and `#fit` fits the page to the window (combine them: `#preview,fit`), handy for links you share and reports embedded in a frame.

On a phone (a window under 640 px wide) the report reflows into one column instead of being scaled down: KPI cards first, two to a row, then every other visual at full width in reading order (top to bottom, left to right on the desktop page). The page's slicers move into a drawer opened by the **Filters** button at the top. Phones view and filter; editing is for wider windows.

## Build a report with an LLM agent

Give your agent the skill (`skill/dashier-report`, or `site/dashier-report-skill.zip`) and your data. It downloads the current editor from https://mvit.github.io/dashier/ to build on (or give it a Dashier file to build from instead). It models the data as a star schema, writes measures with their formats, binds the numbers in the text to the data, builds the file and validates it. Each report lives in its own folder:

```
sales-report/
  extract.py                 source files → data/*.csv, checked against the source's totals
  data/                      dim_*.csv and fact_*.csv
  build_doc.py               data/ → doc.json: sources, relationships, measures, pages
  doc.json
  sales-report.dashier.html
```

```bash
cd sales-report
python3 extract.py source/      # your source files
python3 build_doc.py
python3 <skill>/scripts/build_report.py doc.json sales-report.dashier.html   # downloads the editor; or pass a Dashier file first
python3 <skill>/scripts/validate_dashier.py sales-report.dashier.html
```

When the data changes, rerun the scripts; or replace one table in the editor (its ⋯ → **Replace data…**).

## How the file is built

- **Document**: `<script type="application/dashier+json" id="dashier-doc">`. Every `<` is written `<`, so the JSON can never end its own script tag.
- **Data**: each table is `base64(gzip(CSV | JSON))` plus a required `structure` manifest (column names and types). An LLM can build most visuals from the manifest alone, and can decode a payload with the one-liner in the file's header comment.
- **Big data**: tables are held as columns (numbers in typed arrays; dates and repeated text as a dictionary plus codes), and what a visual reads is a *frame*: positions into those columns after filters and joins, never copied rows. Row objects are only made for what must be objects: the table rows on screen, the Edit data preview, and templates that use a whole table. Payloads stay compressed in browser Blobs outside the JS heap (the document holds references like `@gzip:3`; saving writes base64 back in pieces), and files are decoded a few MB at a time.
- **Upgrading**: each saved file carries the app it was saved with. `npm run upgrade -- file.dashier.html` writes `file.upgraded.dashier.html`: the same document with the app from `dist/dashier.html`.
- **App**: the minified JS *and* CSS are one `base85(gzip(…))` blob (`pack85.cjs`: 5 characters per 4 bytes, against base64's 5⅓, about 7 KB less) behind a ~700-byte loader (the stylesheet is installed as an adopted sheet, so saving never duplicates it). Saving rewrites the page HTML with the new document and leaves the packed app untouched.
- **Charts**: column, bar, line, area, line and column, scatter, pie, donut, radar, treemap, sankey and gauge, drawn by Dashier's own small renderers in `src/runtime/draw/`. They're ported from [Pele](https://github.com/obsidianmd/pele) (MIT, © kepano) and keep its speed tricks: layouts are plain arithmetic, text is measured without laying anything out (cached canvas widths), and a chart is one SVG string inserted once, drawn at its tile's exact size. Without Pele's Mermaid parsers that's ~5 KB gzipped instead of ~30 KB. A scatter keeps one dot per series per 3×3 px and draws each series as one path. Text templates use a small built-in engine with Mustache's syntax plus filters (`src/runtime/template.ts`).

## Report theme

The report canvas is themed by the document, independently of the editor's own light/dark setting (☾/☀ in the status bar). Deselect everything to see **Report theme**: presets, light/dark/auto base, page/tile/text/accent colors, 8 series colors, font and corner radius. Corners are square by default, and no visual has an outer border. It's stored under `theme` in the document; see the guide at the top of the file.

## Editing

- Click an icon in the **Visualizations** pane to add an **empty** visual (nothing is pre-filled), then **drag fields** from the Data pane into its slots. There are no pickers and no source setting: the first field decides the visual's table, fields of connected tables join in as `table.field`, and a field from an unconnected table is refused until you clear the visual's fields. A placed field shows as a pill ("Sum of revenue"); click it for its menu: Remove field, Rename for this visual (tables), Summarize (Sum, Average, Minimum, Maximum, Count, Count (Distinct), Median…), Show value as, Compare with, Format and Display units. Summarizing a table column groups the table by its other columns. With a visual selected, the icons change its type.
- Drag a visual to move it, drag its handles to resize (12-column grid). Arrow keys move, Shift+arrows resize, Delete removes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo. Right-click a visual to duplicate or delete it, a page tab to rename, duplicate or delete the page (double-click also renames), a field pill for its menu, and a table or measure in the Data pane for its options.
- **Format pane** (the Format tab, with a visual selected): settings grouped by what they change (Title, Values, Data labels, axes, Legend, Colors, Bars or Lines, Order, Reference lines; Callout value and Comparison on cards; Grid and Totals on tables and matrices). Search finds a setting by name, a switch in a section's header turns it on or off, a dot marks what you changed and ↺ resets a section. **Copy** and **Paste** carry one visual's look to another of the same type, never its fields or text.
- **Data pane**: fields are dragged into visuals and onto the Filters pane's wells. *Get data* takes a dropped or browsed CSV/JSON file (or pasted text), previews it with each column's type (click a type badge to change it), and loads it under the name you give. A table's **⋯** (or right-click, or double-click) → **Edit data…**:
  - **Data**: the table as a grid. Rename the table (click its name) and its columns (click a column name; visuals, filters and relationships that used it follow, and the stored header is rewritten), and change column types with the type badges (values are re-read as the type you pick; the stored data is untouched). Each column shows its distinct and blank counts.
  - **Relationships**: links between this table's fields and fields of other tables (`relationships` in the document). Everything is editable: both fields, the other table, the cardinality and which way filters flow (one way, or both). Each link shows the share of matching values, and same-named fields are suggested. Connected fields share filters, and a visual built on one table can use the other's fields (dragged in, they appear as `table.field`): as in Power BI, every row of the visual's table stays, and one with no match shows the other table's fields blank.
  - **Used by**: every visual bound to the table, on any page; click one to jump to it.
  - **Replace data…** (same menu, or the button in Edit data) loads an updated CSV/JSON into the table. Its name, relationships and visuals stay, and columns it already had keep their types. Before replacing, columns the new data lacks are flagged with the visuals and relationships that use them; new columns are just listed.
  - The same menu deletes a table. A ⟷ marks related fields in the pane.
- **Measures** (a table's ⋯ → New measure…): a named number, no formulas. Either summarize a field (Sum, Average, Count…, optionally only rows where a field is certain values) or calculate with two values (measures, field sums or numbers: + − × ÷ or % difference). Give it a format and display units once, and every visual that uses it shows them. Drag a measure onto values, columns, a card or a text variable; it's worked out for each bar, table row group and filter. Renaming a measure updates everything that uses it; one that another measure uses can't be deleted.
- **Comparisons, no formulas**: a value's menu on column, bar, line, area and combo charts, cards, matrix values and text variables has **Compare with** (Previous period, or Same period last year), shown as % change, difference or the earlier value. The comparison moves the date filters and slicers back a period, so it follows whatever the reader picks. Along a chart's axis or a matrix, **Show value as → Running total** accumulates, and **Percent of grand total** gives shares.
- **Numbers**: formats are Number (1.2K), Whole number (1,234), Currency and Percent, and display units (K, M, B, or Auto) divide and suffix. Store amounts in full and pick the units on the measure: 416161000000 shows as $416.16B on a card and in text. Charts compact their axes on their own unless you set units.
- **Text boxes** quote live numbers. Drop a field from the Data pane on the text: it inserts `{{ revenue }}` and binds it. Each variable the text uses gets a field well under it; the field's menu sets how it's summarized, its format and its comparison. Summaries: Sum, Average, Minimum, Maximum, Median, Standard deviation, Variance, Count, Count (Distinct), and for a single value on show (text boxes, cards, table columns, matrix values) also Most common, First and Last; there, text and dates get Minimum and Maximum too (alphabetical, earliest/latest). Drop a field or table on a well to rebind it. Values follow the active filters and slicers. The text is a template in [Mustache](https://mustache.github.io/mustache.5.html)'s syntax: `{{#name}}…{{/name}}` repeats over rows (set the table's menu to All rows) or shows when a value is set, `{{^name}}…{{/name}}` when it's empty. Filters shape a value or a list, chained left to right: `upper`, `lower`, `title`, `truncate: n`, `round: n`, `format: "currency"`, `date: "MMM yyyy"`, `default: "n/a"`, `join: ", "`, `first`/`first: n`, `last`, `size`, `sort`/`sort: "field"`, `reverse`. A top 3, say: `{{#sales | sort: "revenue" | reverse | first: 3}}- {{region}}{{/sales}}`. Every table is also a variable named after it (its rows, the first 1,000), along with `title` and `page`.
- **Slicers** (funnel icon): drop a field in, and viewers pick its values on the page; every other visual on the page follows, including other tables through connections. Styles (Format tab): list, dropdown, tiles, or a between range for numbers; optional single select. A slicer's options follow the other filters but not its own pick. The pick is saved with the file.
- **Filters** pane: drag a field onto a visual's, the page's or all pages' well. A filter applies to every widget whose table has that field, or a field connected to it.
- **Charts**: hover for a tooltip with the exact values. The Format pane sets sorting (by value or name), top N, data labels, axis titles and range, gridlines, series colors, bar width and corners, line width and points, and reference lines. The **line and column chart** puts column values and line values on one axis. Column, bar and area charts **stack** (stacked or 100% stacked; the line and column chart stacks its columns).
- **Dates** are real dates: any common spelling is read as an ISO date, sorted in time order, and a date field's menu groups it by **Month, Quarter or Year** (charts start at Month). In the Filters pane a date filters **between** two dates or **in the last** n days/weeks/months/years; a date slicer picks a range, or a list of months/quarters/years when grouped.
- **Tables** scroll inside their tile, sort by a header click, draw only the rows in view (large tables stay fast) and end with a **totals** row (Format → Totals). Rename a header from its field menu (Rename for this visual). A numeric column's menu adds **conditional formatting**: a color scale or data bars.
- **Matrix**: a pivot table. Rows (a hierarchy: each group expands into the next field with its +/−, showing its subtotal on its own row), Columns across, and Values summarized at every crossing. Format → Totals shows a total row, a total column, both or neither, and row subtotals. A header click sorts the rows (each group among its siblings). Values have the table's summaries, comparisons, running totals, % of grand total, conditional formatting and formats. Up to 100 column headers are shown; the totals count them all.
- **Field pills** drag everywhere: reorder them in a multi-field well, drag one to another well of the visual to move it, onto a filter well to filter by it, or off the wells to remove it (Esc cancels).
- **Print** (Share ▾ → Print…, or Ctrl/⌘+P) opens the browser's print dialog straight away with every page, each on its own sheet at the report's size (laid out off screen while the dialog is open). Saving to PDF is up to the dialog. Printing from the browser's own menu prints just the page on screen.
- **Share ▾**: Save (Ctrl+S, in place via the File System Access API, or a download; a dot on the button marks unsaved changes), Save a copy, **Encrypt with password…** / **Remove encryption** (each saves at once), and Export / Open JSON for just the document.

## Limits

- **Your data is encrypted when you set a password, and compressed but readable otherwise.** Without a password anyone with the file can decode its tables (the guide at the top of the file says how). With one (Share ▾ → Encrypt with password…) every table is sealed in one AES-256-GCM ciphertext, keyed by PBKDF2-SHA256 from the password (600,000 iterations, a random 16-byte salt, a fresh 12-byte IV on every save), using only the browser's Web Crypto API. The file asks for the password before it shows anything, and the decrypted data stays in memory. The report's layout, text, measures and column names stay readable; only the tables' rows are encrypted. **If you lose the password, the data cannot be recovered.**
- **Phones view and filter, never edit**: the editor needs a window at least 640 px wide.

## License

MIT. See [LICENSE](LICENSE); it also lists the bundled Solid.js and the chart renderers ported from Pele, both MIT.
