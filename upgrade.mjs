// Upgrade a saved dashboard to the current build: keeps the file's document (data, pages, theme) and swaps in
// the app from dist/dashier.html. Run `npm run build` first.
//   node upgrade.mjs report.dashier.html [out.html]     (default: report.upgraded.dashier.html)
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output = input.replace(/(\.dashier)?\.html$/i, '.upgraded.dashier.html')] = process.argv.slice(2);
if (!input) {
  console.error('usage: node upgrade.mjs <saved.dashier.html> [out.html]');
  process.exit(1);
}

/** Where the document JSON sits: between the dashier-doc script tag and its </script>. */
const docBounds = (html, file) => {
  const at = html.indexOf('id="dashier-doc"');
  if (at < 0) throw new Error(`${file} has no dashier document`);
  const start = html.indexOf('>', at) + 1;
  return [start, html.indexOf('</script>', start)];
};

const old = readFileSync(input, 'utf8');
const app = readFileSync('dist/dashier.html', 'utf8');
const [os, oe] = docBounds(old, input);
const [as, ae] = docBounds(app, 'dist/dashier.html');
const title = /<title>([\s\S]*?)<\/title>/i.exec(old)?.[1];
let out = app.slice(0, as) + old.slice(os, oe) + app.slice(ae);
if (title != null) out = out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title}</title>`);
writeFileSync(output, out);
console.log(`${output}: ${(out.length / 1e6).toFixed(1)} MB, document from ${input}, app from dist/dashier.html`);
