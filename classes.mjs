// Shortens the editor's own class names in the app the build ships: each `d-…`/`ed-…` class of the editor's chrome
// becomes `_` and a short code, in the stylesheet and the code alike (gzip then has a few KB less to carry). Left as
// written: the report's classes (in its CSS rules, or put there by the code that draws it), names put together at run
// time (`type-${t}`), and names other tools read (the page template, the README, the skill). The map goes next to the
// build, for the browser tests, which find elements by class.
import fs from 'node:fs';
import path from 'node:path';

const CLASS = /\b(?:d|ed)-[a-z0-9-]+/g;
/** Matches any of `names` as a whole class name (not inside a longer one). */
export const namesRe = (names) =>
  new RegExp(`(?<![\\w$-])(${[...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/-/g, '\\-')).join('|')})(?![\\w-])`, 'g');

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** The editor's classes to shorten: defined in theme.css, and none of the ones that stay (see above). */
function shortenable(root) {
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const sheet = read('src/styles/theme.css');
  const keep = new Set();
  // the report's rules: the widgets' section, and any rule naming a part of the report (its sheet and tiles, a widget,
  // a chart and its legend, the tooltip, the print view), with every class it names
  const part = /\.(?:d-(?:chart|legend|matrix|slicer|markdown|tip|print|card-widget)[a-z0-9-]*|d-table(?:-widget)?|d-canvas-sheet|d-visual-(?:container|inner)|d-visuals-grid|card-|markdown|chart-title|c-)(?![\w-])/;
  let widgets = false;
  for (const line of sheet.split('\n')) {
    if (line.startsWith('/* 4. WIDGET RENDERING')) widgets = true;
    if (line.startsWith('/* 5. MODALS')) widgets = false;
    const sel = line.split('{')[0];
    if (widgets || part.test(sel)) for (const n of sel.match(CLASS) ?? []) keep.add(n);
  }
  // the code that draws the report, and what other tools and people read
  const src = files(path.join(root, 'src'));
  const drawing = src.filter((f) => /[\\/](widgets|draw)[\\/]|[\\/](Widget|PrintView|ChartHost)\.tsx$|[\\/](charts|tooltip|markdown|template)\.ts$/.test(f));
  for (const f of [...drawing, ...['index.html', 'README.md'].map((p) => path.join(root, p)), ...files(path.join(root, 'skill'))])
    for (const n of fs.readFileSync(f, 'utf8').match(CLASS) ?? []) keep.add(n);
  // names put together at run time: whatever comes right before a `${` in the code
  const prefixes = [...new Set(src.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/([a-z][a-z0-9-]*)\$\{/g)].map((m) => m[1])))];
  // what the stylesheet's selectors name (not words in its comments)
  const defined = new Set((sheet.match(/\.(?:d|ed)-[a-z0-9-]+/g) ?? []).map((s) => s.slice(1)));
  return [...defined].filter((n) => !keep.has(n) && !prefixes.some((p) => n.startsWith(p)));
}

/** The stylesheet and code with the editor's classes shortened (most used first, so they get the shortest codes), and the map. */
export default function shortenClasses(css, js, root) {
  const names = shortenable(root);
  const uses = (n) => (css + js).split(n).length;
  const map = Object.fromEntries(names.sort((a, b) => uses(b) - uses(a)).map((n, i) => [n, '_' + i.toString(36)]));
  const re = namesRe(names);
  const rename = (s) => s.replace(re, (n) => map[n]);
  return { css: rename(css), js: rename(js), map };
}
