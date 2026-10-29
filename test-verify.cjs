// Verifies the built single file (dist/dashier.html): document block, data payloads, packed app code.
const fs = require('fs');
const zlib = require('zlib');
const vm = require('vm');

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

const html = fs.readFileSync('dist/dashier.html', 'utf-8');

// 1. Document block
const docMatch = html.match(/<script\s+type="application\/dashier\+json"\s+id="dashier-doc">([\s\S]*?)<\/script>/i);
if (!docMatch) {
  console.error('FAIL: #dashier-doc block not found');
  process.exit(1);
}
const raw = docMatch[1];
check('no raw "<" inside #dashier-doc', !raw.includes('<'));
const doc = JSON.parse(raw);
check('format is "dashier"', doc.format === 'dashier', String(doc.format));
check('has pages', Array.isArray(doc.pages) && doc.pages.length > 0, `${doc.pages.length} pages`);

// 2. Data sources: gzip+base64 with an explicit structure manifest
for (const [id, src] of Object.entries(doc.sources)) {
  check(`source "${id}" is gzip+base64`, src.encoding === 'gzip+base64');
  check(`source "${id}" has a structure manifest`, Array.isArray(src.structure) && src.structure.length > 0);
  const text = zlib.gunzipSync(Buffer.from(src.payload, 'base64')).toString('utf-8');
  // names without quotes or commas here: a row CSV's header line, a column CSV's first field on each line
  const lines = text.split('\n');
  const header = src.format === 'csv' ? lines[0].split(',').map(s => s.trim()) : src.format === 'csv-columns' ? lines.map(l => l.split(',')[0].trim()) : Object.keys(JSON.parse(text)[0] || {});
  const names = src.structure.map(c => c.name);
  check(`source "${id}" structure matches the payload columns`, JSON.stringify(header) === JSON.stringify(names), header.join(','));
  src.fields = new Set(names);
}

// 3. Elements only reference sources and fields that exist: their own, "table.field" of a connected table, or "[measure]"
const refs = [];
const linked = (a, b) => (doc.relationships || []).some(r => (r.from.table === a && r.to.table === b) || (r.from.table === b && r.to.table === a));
const known = (table, f) => {
  if (/^\[.+\]$/.test(f)) return (doc.measures || []).some(m => m.table === table && `[${m.name}]` === f);
  if (doc.sources[table].fields.has(f)) return true;
  const t = Object.keys(doc.sources).find(t => f.startsWith(t + '.') && linked(table, t));
  return !!t && doc.sources[t].fields.has(f.slice(t.length + 1));
};
for (const page of doc.pages) {
  for (const el of page.elements) {
    if (el.sourceId) {
      const src = doc.sources[el.sourceId];
      if (!src) { refs.push(`${el.id}: unknown source ${el.sourceId}`); continue; }
      const used = [...Object.values(el.mapping || {}), el.aggregation?.field, ...[...(el.columns || []), ...(el.rows || []), ...(el.values || [])].map(c => c.field)].filter(Boolean);
      for (const f of used) if (!known(el.sourceId, f)) refs.push(`${el.id}: unknown field ${f}`);
    }
  }
}
check('every element references existing sources and fields', refs.length === 0, refs.join('; '));

// Relationships connect existing fields of two different tables
const badRels = (doc.relationships || []).filter(r =>
  [r.from, r.to].some(e => !doc.sources[e.table] || !doc.sources[e.table].fields.has(e.field)) || r.from.table === r.to.table);
check('relationships connect existing fields of two tables', badRels.length === 0, JSON.stringify(badRels));
const JOINS = ['left', 'right', 'inner', 'full', 'left-anti', 'right-anti'];
check('relationship joins are valid', (doc.relationships || []).every(r => !r.join || JOINS.includes(r.join)));

// 4. Packed app code
check('no unpacked <script type="module">', !/<script type="module"/.test(html));
const js = html.match(/<script id="dashier-js" type="text\/plain">([^<]+)<\/script>/);
check('packed app code present', !!js);
if (js) {
  const code = zlib.gunzipSync(require('./pack85.cjs').decode(js[1])).toString('utf-8');
  check('packed code is plain script (no import/export)', !/\bimport\.meta\b|^\s*(import|export)\s/m.test(code));
  try { new vm.Script(code); check('packed code parses', true, `${(code.length / 1024).toFixed(0)} KB unpacked`); }
  catch (e) { check('packed code parses', false, e.message); }
  // the budget is the packed app alone (gzip + base85), not the document or the editing guide around it
  const BUDGET = 140 * 1024;
  check(`packed app within its ${BUDGET / 1024} KB budget`, js[1].length <= BUDGET, `${(js[1].length / 1024).toFixed(1)} KB`);
}

console.log(`\nfile size: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed.');
process.exit(failed ? 1 : 0);
