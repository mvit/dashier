# Dashier

A whole dashboard in one HTML file, with the data inside. Email it. Open it in any browser. Filter it, slice it, edit it. No server, no account, no license, no network request.

The editor is 139 KB. **[Try it](https://mvit.github.io/dashier/).**

## Why

Most reports stop working the moment you send them. A PDF can't answer a follow-up question. A screenshot can't be filtered. A BI link needs a license the other person doesn't have. So every question after the handoff comes back to you.

Dashier keeps the report working without you. The file is the app, the report and the data, all at once. Whoever has it can dig in, and change it if they want.

## Written by LLMs, read by people

The whole report (model, measures, pages, theme and data) is one JSON block in the file. That's a format an LLM writes as easily as you do.

Give your agent the [Dashier skill](skill/dashier-report) and your data. It models a star schema, writes the measures, builds the file and validates it. Then the AI's job is done. The person you send it to doesn't need one.

Want changes later? **Export as JSON** hands the report back to an agent, and **Replace with JSON** takes it in again.

## What you get

- Column, bar, line, area, line-and-column, scatter, pie, donut, radar, treemap, sankey and gauge charts.
- Slicers, filters and relationships across tables, the way Power BI does them.
- Measures without formulas, plus comparisons with the previous period or the same period last year.
- Text boxes that quote live numbers and follow the filters.
- Tables and matrices with totals, sorting and conditional formatting.
- A phone layout: one column, slicers in a drawer.
- Optional password encryption (AES-256-GCM, in the browser's own Web Crypto).
- Print every page, at the report's size.

## Small on purpose

Solid is the only runtime dependency. The charts are small hand-written SVG renderers, ported from [Pele](https://github.com/obsidianmd/pele), about 10 KB gzipped. The packed app is 115 KB, and `npm test` fails the build if it ever passes 140 KB. Tables are stored as columns, so big files open fast.

That budget is the feature. Most feature requests will get a polite no.

## Run it

```bash
npm install
npm run dev        # develop
npm run build      # -> dist/dashier.html, the one file you share
npm test           # unit tests, plus checks on the built file and its size
npm run e2e        # headless Chrome/Edge: editing, filters, save and reload, encryption
npm run phone      # the sample report at phone sizes, portrait and landscape
python3 tests/test_validator.py   # the skill's build and validate scripts (after npm run build)
npm run upgrade -- report.dashier.html   # give an old report the current build
```

## Limits

- **Saving in place works in Chrome and Edge only.** Other browsers download a copy instead.
- **Phones view and filter, but don't edit.** The editor needs a window at least 640 px wide.
- **Without a password, the data is readable.** It's compressed, not hidden. With one, every table is sealed with AES-256-GCM, keyed by PBKDF2-SHA256 at 600,000 iterations. Lose the password and the data is gone for good.
- **CSV and JSON in, no live refresh.** When the data changes, rebuild the report or replace a table in the editor.
- **Big tables work, but they aren't instant.** A million rows takes about a second and a half to open.

## More

The [manual](manual.md) covers the editor, the LLM workflow, theming, the file format and the repository. The file format is also described in the guide at the top of every Dashier file.

## License

MIT. See [LICENSE](LICENSE), which also lists the bundled Solid.js and the chart renderers ported from Pele (MIT, © kepano), and the Lucide undo and redo icons (ISC).
