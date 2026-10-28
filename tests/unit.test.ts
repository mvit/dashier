import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, buildChart, chartKind, comparison, withUnits, formatCompact, formatFull, formatValue, orderCategories, pivot, summarizeRead, summarizeValue, summaryLabel } from '../src/runtime/charts';
import { compareText, filterTest, keyText, shiftFilters, sortOrder, sortText } from '../src/runtime/data';
import { distinctOf, filterFrame, frameRows, joinFrame, reader, rowsFrame, subset, tableFrame } from '../src/runtime/frames';
import { datePartKey, datePartLabel, inRange, lastRange, shiftKey, shiftRange, toISODate } from '../src/runtime/dates';
import { CONVERT, applyTypes, csvHead, inferStructure, parseCSV, parseJSON, renameColumnInText } from '../src/runtime/hydrate';
import { decompressPayload, expandPayloads, holdBase64, holdText, isHeld, payloadSize, payloadText } from '../src/runtime/payloads';
import { parseMarkdown } from '../src/runtime/markdown';
import { renameInTemplate, renderTemplate, templateVariables } from '../src/runtime/template';
import { scatterPoints } from '../src/runtime/draw/scatter';
import { buildMatrix } from '../src/runtime/matrix';
import { fitText, layoutLabel, measurer, num, tickLabels, valueAxis } from '../src/runtime/draw/svg';
import { ColumnTable, cellOf, columnsFromCSVAsync, columnsFromRows } from '../src/runtime/columns';
import { gzipSync } from 'node:zlib';

// a payload as a file holds it: base64(gzip(text))
const compressPayload = async (text: string) => gzipSync(text).toString('base64');
const columnsFromCSV = (csv: string, structure: ReturnType<typeof inferStructure>) => columnsFromCSVAsync(csv, structure, () => {});
const get = (t: ColumnTable, field: string, i: number) => cellOf(t.columns[field], i);
import type { ChartElement, DashMeasure } from '../src/types/model';
import { compileMeasure, isMeasureRef, measureError, measureFormat } from '../src/runtime/measures';

// --- aggregation -------------------------------------------------------------------

const summarize = (values: unknown[], method?: Parameters<typeof summarizeRead>[2]) => summarizeRead(values.length, k => values[k], method);

test('summarize: numeric summaries skip blanks and text', () => {
  const v = [4, '2', null, '', 'x', 9];
  assert.equal(summarize(v, 'sum'), 15);
  assert.equal(summarize(v, 'avg'), 5);
  assert.equal(summarize(v, 'min'), 2);
  assert.equal(summarize(v, 'max'), 9);
  assert.equal(summarize(v, 'median'), 4);
  assert.equal(summarize([1, 2, 3, 4], 'median'), 2.5);
  assert.equal(summarize(v, 'latest'), 9);
  assert.equal(summarize(['a', 'b'], 'sum'), null);
});

test('summarize: count counts rows, distinct counts distinct non-blank values', () => {
  assert.equal(summarize(['a', 'a', null, 'b'], 'count'), 4);
  assert.equal(summarize(['a', 'a', null, '', 'b'], 'distinct'), 2);
});

test('aggregate: count ignores the field; other methods reduce it', () => {
  const rows = [{ v: 1 }, { v: 3 }, { v: null }];
  assert.equal(aggregate(rowsFrame(rows), 'count', 'v'), 3);
  assert.equal(aggregate(rowsFrame(rows), 'avg', 'v'), 2);
});

test('summaryLabel names the summary: "Sum of revenue"', () => {
  assert.equal(summaryLabel('revenue', 'sum'), 'Sum of revenue');
  assert.equal(summaryLabel('revenue', 'avg', 'percent-of-total'), '%GT Average of revenue');
  assert.equal(summaryLabel('region'), 'region');
});

// --- chart data ----------------------------------------------------------------------

const sales = [
  { region: 'East', q: 'Q1', v: 10 },
  { region: 'East', q: 'Q2', v: 30 },
  { region: 'West', q: 'Q1', v: 20 },
  { region: 'North', q: 'Q1', v: 40 }
];

test('pivot: summarizes per category and series', () => {
  const { cats, totals, groups } = pivot(rowsFrame(sales), 'region', 'v', 'q');
  assert.deepEqual(cats, ['East', 'West', 'North']);
  assert.equal(totals.get('East'), 40);
  assert.equal(groups.get('Q1')!.get('West'), 20);
  assert.equal(groups.get('Q2')!.get('West'), undefined);
});

test('pivot: percent of grand total adds up to 100', () => {
  const { groups, totals } = pivot(rowsFrame(sales), 'region', 'v', 'q', 'sum', 'percent-of-total');
  const cells = [...groups.values()].flatMap(m => [...m.values()]);
  assert.equal(Math.round(cells.reduce((a, b) => a + b, 0)), 100);
  assert.equal(totals.get('North'), 40);
});

test('orderCategories: dates first by time, then sort, then top N', () => {
  const totals = new Map([['a', 5], ['b', 1], ['c', 9], ['d', 3]]);
  assert.deepEqual(orderCategories(['a', 'b', 'c', 'd'], totals, {}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orderCategories(['a', 'b', 'c', 'd'], totals, { sort: 'value-desc' }), ['c', 'a', 'd', 'b']);
  assert.deepEqual(orderCategories(['a', 'b', 'c', 'd'], totals, { sort: 'value-asc' }), ['b', 'd', 'a', 'c']);
  assert.deepEqual(orderCategories(['b', 'c', 'a', 'd'], totals, { sort: 'label' }), ['a', 'b', 'c', 'd']);
  // top N without a sort keeps the data's order
  assert.deepEqual(orderCategories(['a', 'b', 'c', 'd'], totals, { topN: 2 }), ['a', 'c']);
  assert.deepEqual(orderCategories(['2024-03', '2023-12', '2024-01'], new Map(), {}, true), ['2023-12', '2024-01', '2024-03']);
});

test('number formats: compact for axes, exact for tooltips', () => {
  assert.equal(formatCompact(250000), '250K');
  assert.equal(formatCompact(1200000), '1.2M');
  assert.equal(formatCompact(250000, 'currency'), '$250K');
  assert.equal(formatCompact(7.46, 'currency'), '$7.46');
  assert.equal(formatCompact(8, 'currency'), '$8');
  assert.equal(formatCompact(224.94, 'currency'), '$225');
  assert.equal(formatCompact(67.05), '67.1');
  assert.equal(formatCompact(1250, undefined, 1), '1.3K');
  assert.equal(formatCompact(25, 'share'), '25%');
  assert.equal(formatCompact(0.25, 'percent'), '25%');
  assert.equal(formatFull(124500.5, 'currency'), '$124,501');
  assert.equal(formatFull(124500.5), '124,500.5');
  assert.equal(formatFull(12.345, 'share'), '12.3%');
  // card and table values: prices keep their cents, larger amounts round to the dollar
  assert.equal(formatValue(5.857, 'currency'), '$5.86');
  assert.equal(formatValue(5, 'currency'), '$5');
  assert.equal(formatValue(4180724.4, 'currency'), '$4,180,724');
  // a plain number's difference reads to the hundredth
  assert.equal(comparison(4.3395, 4.33, 'difference', 'number')?.text, '+0.01');
  assert.equal(comparison(4180724, 3547984, 'difference', 'currency')?.text, '+$632,740');
});

const chart = (over: Partial<ChartElement>): ChartElement => ({ id: 'c', type: 'chart', x: 0, y: 0, w: 6, h: 4, chartType: 'bar', mapping: { x: 'region', y: 'v' }, ...over }) as ChartElement;
// what a drawn chart shows: its bars' heights relative to the tallest, and the text of its labels
const drawn = (spec: { draw?: (a: { w: number; h: number }) => string }, w = 600, h = 400) => spec.draw!({ w, h });
const barHeights = (svg: string) => {
  const hs = [...svg.matchAll(/<rect x="[\d.-]+" y="[\d.-]+" width="[\d.-]+" height="([\d.-]+)"\/>/g)].map(m => +m[1]);
  return hs.map(h => +(h / Math.max(...hs)).toFixed(2));
};
const texts = (svg: string, anchor: string) =>
  [...(/<g class="c-axis-labels"[^>]*>(.*?)<\/g>/.exec(svg)?.[1] ?? '').matchAll(new RegExp(`text-anchor="${anchor}">([^<]*)<`, 'g'))].map(m => m[1]);
// a stand-in for the SVG element under the pointer: a piece with data-i
const over = (i: number) => ({ closest: () => ({ getAttribute: () => String(i) }), tagName: 'path' }) as unknown as Element;

test('buildChart: a combo chart draws columns and a line on one axis', () => {
  const spec = buildChart(chart({ chartType: 'combo', mapping: { x: 'region', y: 'v', line: 'v' }, lineSummary: { aggregate: 'avg' } }), rowsFrame(sales));
  const svg = drawn(spec);
  assert.deepEqual(barHeights(svg), [1, 0.5, 1]);
  assert.equal((svg.match(/class="c-series c-line"/g) || []).length, 1);
  assert.deepEqual(spec.legend.map(l => [l.name, !!l.line]), [['Sum of v', false], ['Average of v', true]]);
  const [, x, y, w] = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/.exec(svg)!.map(Number);
  const tip = spec.tip!({ tagName: 'svg', closest: () => null } as unknown as Element, null as any, { x: x + w / 2, y: y + 1 });
  assert.deepEqual(tip, { title: 'East', rows: [{ label: 'Sum of v', value: '40', color: 'var(--series-1)', active: false }, { label: 'Average of v', value: '20', color: 'var(--series-2)', active: false }] });
});

test('buildChart: top N and sorting reach the chart', () => {
  const spec = buildChart(chart({ options: { sort: 'value-desc', topN: 2 } }), rowsFrame(sales));
  assert.deepEqual(texts(drawn(spec), 'middle'), ['East', 'North']);
});

test('buildChart: value ticks are in the chart format, categories as they are', () => {
  const svg = drawn(buildChart(chart({ options: { format: 'currency' } }), rowsFrame(sales)));
  assert.deepEqual(texts(svg, 'end'), ['$0', '$5', '$10', '$15', '$20', '$25', '$30', '$35', '$40']);
  assert.deepEqual(texts(svg, 'middle'), ['East', 'West', 'North']);
});

// --- dates ----------------------------------------------------------------------------

test('toISODate: understands common date spellings', () => {
  assert.equal(toISODate('2024-01-03'), '2024-01-03');
  assert.equal(toISODate('2024-1-3'), '2024-01-03');
  assert.equal(toISODate('2024-01-03T14:05:00Z'), '2024-01-03T14:05');
  assert.equal(toISODate('2024-01-03 00:00:00'), '2024-01-03');
  assert.equal(toISODate('1/3/2024'), '2024-01-03'); // month first
  assert.equal(toISODate('25/12/2024'), '2024-12-25'); // only a day can be 25
  assert.equal(toISODate('3.1.2024'), '2024-01-03'); // dotted: day first
  assert.equal(toISODate('Jan 3, 2024'), '2024-01-03');
  assert.equal(toISODate('2024-02-30'), null);
  assert.equal(toISODate('12345'), null);
  assert.equal(toISODate('Q1'), null);
});

test('date hierarchy: buckets sort in time order and read naturally', () => {
  assert.equal(datePartKey('2024-05-17', 'year'), '2024');
  assert.equal(datePartKey('2024-05-17', 'quarter'), '2024 Q2');
  assert.equal(datePartKey('2024-05-17T09:30', 'month'), '2024-05');
  assert.equal(datePartKey('2024-05-17T09:30', 'day'), '2024-05-17');
  assert.equal(datePartLabel('2024-05', 'month'), 'May 2024');
  assert.equal(datePartLabel('2024 Q2', 'quarter'), '2024 Q2');
});

test('lastRange: relative ranges end today and include it', () => {
  const today = new Date(2024, 4, 17); // 17 May 2024
  assert.deepEqual(lastRange(7, 'day', today), { from: '2024-05-11', to: '2024-05-17' });
  assert.deepEqual(lastRange(3, 'month', today), { from: '2024-02-18', to: '2024-05-17' });
  assert.deepEqual(lastRange(1, 'year', today), { from: '2023-05-18', to: '2024-05-17' });
  assert.ok(inRange('2024-05-17T23:00', '2024-05-11', '2024-05-17'));
  assert.ok(!inRange('2024-05-18', undefined, '2024-05-17'));
  assert.ok(!inRange('', '2024-01-01'));
});

// --- filters, joins --------------------------------------------------------------------

test('filterTest: values, numbers, dates and buckets', () => {
  const row = { region: 'East', v: 25, d: '2024-05-17' };
  assert.ok(filterTest({ field: 'region', values: ['East', 'West'] })(row['region']));
  assert.ok(!filterTest({ field: 'region', values: ['West'] })(row['region']));
  assert.ok(filterTest({ field: 'region', values: [] })(row['region']), 'an empty list means all');
  assert.ok(filterTest({ field: 'v', min: 20, max: 30 })(row['v']));
  assert.ok(!filterTest({ field: 'v', min: 26 })(row['v']));
  assert.ok(filterTest({ field: 'd', from: '2024-05-01', to: '2024-05-31' })(row['d']));
  assert.ok(!filterTest({ field: 'd', to: '2024-05-16' })(row['d']));
  assert.ok(filterTest({ field: 'd', values: ['2024 Q2'], datePart: 'quarter' })(row['d']));
  assert.ok(!filterTest({ field: 'd', values: ['2024-04'], datePart: 'month' })(row['d']));
  const recent = { d: lastRange(1, 'day').to };
  assert.ok(filterTest({ field: 'd', last: { n: 1, unit: 'week' } })(recent.d));
  assert.ok(!filterTest({ field: 'd', last: { n: 1, unit: 'week' } })('2000-01-01'));
});

test('date grouping reads buckets off the rows without copying or changing them', () => {
  const rows = [{ d: '2024-01-03', v: 1 }, { d: '2024-01-20', v: 2 }, { d: '2024-04-02', v: 4 }];
  const frozen = rows.map(r => Object.freeze(r)); // any write would throw
  const spec = buildChart(chart({ mapping: { x: 'd', y: 'v' }, dateParts: { x: 'month' } }), rowsFrame(frozen), { xDate: true });
  const svg = drawn(spec);
  assert.deepEqual(texts(svg, 'middle'), ['Jan 2024', 'Apr 2024']);
  assert.deepEqual(barHeights(svg), [0.75, 1]);
  const q = buildChart(chart({ chartType: 'pie', mapping: { x: 'd', y: 'v' }, dateParts: { x: 'quarter' } }), rowsFrame(frozen));
  assert.equal(q.tip!(over(0), null as any, { x: 0, y: 0 })!.title, '2024 Q1');
  assert.equal(q.tip!(over(0), null as any, { x: 0, y: 0 })!.rows[0].value, '3');
});

test('joinFrame: every row of the frame stays, with its matches or blanks, as Power BI keeps them', () => {
  const left = rowsFrame([{ k: 'a', l: 1 }, { k: 'b', l: 2 }]);
  const right = rowsFrame([{ id: 'a', r: 10 }, { id: 'a', r: 11 }, { id: 'c', r: 30 }]).base.table;
  const run = (lookup = false) => frameRows(joinFrame(left, 'k', right, 'id', 'R', lookup)).map(x => `${x.k ?? '∅'}:${x['R.r'] ?? '∅'}`);
  assert.deepEqual(run(), ['a:10', 'a:11', 'b:∅']);
  assert.deepEqual(run(true), ['a:10', 'b:∅'], 'a lookup takes the first match');
});

test('frames: filtering keeps positions into the same columns, and filters on missing fields are ignored', () => {
  const f = rowsFrame(sales);
  const east = filterFrame(f, [{ field: 'region', values: ['East'] }, { field: 'nope', values: ['x'] }]);
  assert.equal(east.length, 2);
  assert.equal(east.base.table, f.base.table, 'no copy of the data');
  assert.deepEqual(Array.from(east.base.ids!), [0, 1]);
  assert.deepEqual(frameRows(east).map(r => r.q), ['Q1', 'Q2']);
  assert.equal(filterFrame(f, []), f);
  assert.deepEqual(frameRows(subset(f, sortOrder(f.length, reader(f, 'v')!, true))).map(r => r.v), [40, 30, 20, 10]);
  const read = reader(filterFrame(f, [{ field: 'v', min: 25 }]), 'region')!;
  assert.deepEqual([read(0), read(1)], ['East', 'North']);
  assert.deepEqual(sortText(distinctOf(f, 'region')), ['East', 'North', 'West']);
  assert.equal(tableFrame().length, 0);
});

test('csvHead: the first records and a count, quoted line breaks included', () => {
  const csv = 'a,b\n1,"x\ny"\n\n2,z\r\n3,w\n';
  assert.deepEqual(csvHead(csv, 1), { head: 'a,b\n1,"x\ny"\n', total: 3 });
  assert.equal(csvHead(csv, 10).total, 3);
  assert.deepEqual(parseCSV(csvHead(csv, 2).head).map(r => r.a), ['1', '2']);
});

test('sortOrder: natural text order, numbers numerically, blanks last, both directions', () => {
  const rows = [{ q: 'Q10' }, { q: '' }, { q: 'Q2' }, { q: 'q1' }, { q: null }];
  assert.deepEqual(Array.from(sortOrder(rows.length, k => rows[k].q), i => rows[i]).map(r => r.q), ['q1', 'Q2', 'Q10', '', null]);
  assert.deepEqual(Array.from(sortOrder(rows.length, k => rows[k].q, true), i => rows[i]).map(r => r.q), ['Q10', 'Q2', 'q1', '', null]);
  assert.deepEqual(((r: any[]) => Array.from(sortOrder(r.length, k => r[k].n), i => r[i]))([{ n: 10 }, { n: -2 }, { n: null }, { n: 3 }]).map(r => r.n), [-2, 3, 10, null]);
});

test('sortOrder: two million rows sort in seconds, not minutes', () => {
  const rows = Array.from({ length: 2_000_000 }, (_, i) => ({ name: `name${(i * 7919) % 5000}` }));
  const t = performance.now();
  const out = Array.from(sortOrder(rows.length, k => rows[k].name), i => rows[i]);
  assert.ok(performance.now() - t < 5000, `${Math.round(performance.now() - t)} ms`);
  assert.equal(out[0].name, 'name0');
  assert.equal(out.at(-1)!.name, 'name4999');
  assert.deepEqual(sortText(['b10', 'b9', 'a']), ['a', 'b9', 'b10']);
});

// --- loading data ------------------------------------------------------------------------

test('inferStructure and applyTypes: types are detected and values converted', () => {
  const rows = parseCSV('city,sales,share,day,ok\nParis,120,0.5,1/3/2024,true\n"Lyon, FR",80,,2024-02-10,false');
  assert.deepEqual(inferStructure(rows).map(c => `${c.name}:${c.type}`), ['city:string', 'sales:int', 'share:float', 'day:datetime', 'ok:boolean']);
  const typed = applyTypes(rows, inferStructure(rows));
  assert.deepEqual(typed[0], { city: 'Paris', sales: 120, share: 0.5, day: '2024-01-03', ok: true });
  assert.equal(typed[1].city, 'Lyon, FR');
  assert.equal(typed[1].share, null);
});

test('payloads round-trip through gzip+base64, across decoding chunks and with line breaks', async () => {
  // ~7 MB of text that barely compresses: its base64 spans several 4 MB decoding chunks
  let seed = 7;
  const text = Array.from({ length: 700_000 }, () => ((seed = (seed * 48271) % 2147483647) / 2147483647).toString(36).slice(2, 12)).join(',');
  const payload = await compressPayload(text);
  assert.ok(payload.length > 1 << 22, `${payload.length} base64 characters: more than one 4M-character chunk`);
  assert.equal(await decompressPayload(payload), text);
  const small = await compressPayload('a,b\n1,2');
  assert.equal(await decompressPayload(small.replace(/(.{20})/g, '$1\n  ')), 'a,b\n1,2', 'wrapped payloads still decode');
});

test('payloads live outside the JS heap as bytes, and are written back as base64 in pieces', async () => {
  const csv = 'a,b\n' + Array.from({ length: 50_000 }, (_, i) => `${i},${(i * 7919) % 1000}`).join('\n');
  const ref = await holdText(csv);
  assert.ok(isHeld(ref) && ref.length < 20, ref);
  assert.equal(await payloadText(ref), csv);
  const fromFile = await holdBase64(await compressPayload(csv));
  assert.equal(await payloadText(fromFile), csv);
  // the document text keeps the reference; writing it out expands it to base64 that decodes back
  const doc = JSON.stringify({ sources: { t: { payload: ref } }, note: 'say @gzip:999 stays as written', title: `also ${ref}` });
  const out = await new Blob(await expandPayloads(doc)).text();
  const parsed = JSON.parse(out);
  assert.equal(await decompressPayload(parsed.sources.t.payload), csv);
  assert.equal(parsed.note, 'say @gzip:999 stays as written');
  assert.equal(parsed.title, `also ${ref}`, 'a reference typed in text is not a payload');
  assert.equal(payloadSize(ref), parsed.sources.t.payload.length);
});

// --- markdown ------------------------------------------------------------------------------

test('parseMarkdown: structure, inline styles, and no raw HTML', () => {
  const html = parseMarkdown('# T\n* **a** and *b*\n* `c`\n\n| h |\n|---|\n| v |\n\n<script>x</script> [l](https://x.y)');
  assert.match(html, /<h1 class="md-h1">T<\/h1>/);
  assert.match(html, /<ul class="md-list">\n<li><strong>a<\/strong> and <em>b<\/em><\/li>\n<li><code class="md-inline-code">c<\/code><\/li>\n<\/ul>/);
  assert.match(html, /<thead><tr><th>h<\/th><\/tr><\/thead><tbody>\n<tr><td>v<\/td><\/tr>\n<\/tbody>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<a href="https:\/\/x.y" target="_blank" rel="noopener noreferrer" class="md-link">l<\/a>/);
  assert.doesNotMatch(parseMarkdown('[x](javascript:alert(1))'), /<a /);
});

// --- measures --------------------------------------------------------------------------------

const ms: DashMeasure[] = [
  { name: 'Revenue', table: 't', aggregate: 'sum', field: 'v' },
  { name: 'East revenue', table: 't', aggregate: 'sum', field: 'v', where: { field: 'region', values: ['East'] } },
  { name: 'Orders', table: 't', aggregate: 'count' },
  { name: 'Per order', table: 't', op: '/', a: { measure: 'Revenue' }, b: { measure: 'Orders' } },
  { name: 'East share', table: 't', op: '/', a: { measure: 'East revenue' }, b: { field: 'v' }, format: 'percent' },
  { name: 'Growth', table: 't', op: 'pct-diff', a: { measure: 'Revenue' }, b: { value: 80 } },
  { name: 'Doubled', table: 't', op: '*', a: { measure: 'Revenue' }, b: { value: 2 } }
];
const run = (name: string, rows = sales) => compileMeasure(ms, 't', name)!(rowsFrame(rows));

test('measures: summarize a field, optionally only some rows', () => {
  assert.equal(run('Revenue'), 100);
  assert.equal(run('East revenue'), 40);
  assert.equal(run('Orders'), 4);
});

test('measures: calculate with measures, field sums and numbers', () => {
  assert.equal(run('Per order'), 25);
  assert.equal(run('East share'), 0.4);
  assert.equal(run('Growth'), 0.25);
  assert.equal(run('Doubled'), 200);
  assert.equal(run('Per order', []), null, 'nothing to divide');
  assert.equal(measureFormat(ms[5]), 'percent', 'a % difference shows as a percent');
});

test('measures: problems are caught before saving', () => {
  const fields = (t: string) => (t === 't' ? ['region', 'v'] : t === 'dim' ? ['region', 'group'] : []);
  assert.match(measureError(ms, { name: 'Revenue', table: 't', aggregate: 'sum', field: 'v' }, fields)!, /already a measure named "Revenue"/);
  assert.match(measureError([...ms, { name: 'Target', table: 'u', aggregate: 'sum', field: 'x' }], { name: 'Target', table: 't', aggregate: 'sum', field: 'v' }, fields)!, /\(on u\)/, 'names are unique in the report');
  assert.equal(measureError(ms, { name: 'X', table: 't', aggregate: 'sum', field: 'v', where: { table: 'dim', field: 'group', values: ['a'] } }, fields), null, 'a where on a connected table');
  assert.match(measureError(ms, { name: 'X', table: 't', aggregate: 'sum', field: 'v', where: { table: 'dim', field: 'nope', values: ['a'] } }, fields)!, /dim has no column "nope"/);
  assert.equal(measureError(ms, { name: 'Revenue', table: 't', aggregate: 'avg', field: 'v' }, fields, 'Revenue'), null, 'editing keeps its own name');
  assert.match(measureError(ms, { name: 'v', table: 't', aggregate: 'sum', field: 'v' }, fields)!, /already a column/);
  assert.match(measureError(ms, { name: 'X', table: 't', aggregate: 'sum' }, fields)!, /Choose the field/);
  assert.match(measureError(ms, { name: 'X', table: 't', op: '+', a: { measure: 'Revenue' } }, fields)!, /both values/);
  // Revenue redefined as Per order + 1 would use itself (Per order = Revenue / Orders)
  assert.match(measureError(ms, { name: 'Revenue', table: 't', op: '+', a: { measure: 'Per order' }, b: { value: 1 } }, fields, 'Revenue')!, /uses itself/);
  assert.ok(isMeasureRef('[Revenue]') && !isMeasureRef('revenue') && !isMeasureRef('[]'));
});

test('buildChart: a measure is worked out for each bar', () => {
  const measure = (ref: string) => (ref === '[Per order]' ? { fn: compileMeasure(ms, 't', 'Per order')!, name: 'Per order' } : null);
  const spec = buildChart(chart({ mapping: { x: 'region', y: '[Per order]' } }), rowsFrame(sales), { measure });
  const svg = drawn(spec);
  assert.deepEqual(barHeights(svg), [0.5, 0.5, 1]); // East: 40 over 2 orders
  assert.match(svg, /rotate\(-90\)"><text[^>]*>Per order</);
});

// --- legends ---------------------------------------------------------------------------------

test('every chart uses the same legend, drawn outside the chart, which fills its tile', () => {
  const spec = buildChart(chart({ chartType: 'pie' }), rowsFrame(sales));
  assert.deepEqual(spec.legend.map(l => l.name), ['East', 'West', 'North']);
  assert.equal(buildChart(chart({ chartType: 'pie', options: { showLegend: false } }), rowsFrame(sales)).legend.length, 0);
  const treemap = buildChart(chart({ chartType: 'treemap', mapping: { x: 'q', y: 'v', group: 'region' } }), rowsFrame(sales));
  const radar = buildChart(chart({ chartType: 'radar', mapping: { x: 'q', y: 'v', group: 'region' } }), rowsFrame(sales));
  assert.equal(treemap.legend.length, 3);
  assert.equal(radar.legend.length, 3);
  for (const s of [spec, treemap, radar]) {
    const svg = drawn(s, 320, 200);
    assert.doesNotMatch(svg, /c-legend/);
    assert.match(svg, /viewBox="0 0 320 200" width="320" height="200"/);
  }
});

// --- column storage (groundwork) ---------------------------------------------------------------

test('columns: the same values as today\'s rows, in compact arrays', async () => {
  const csv = 'id,city,n,ok,day,note\n1,Paris,1.5,true,1/3/2024,"a, b"\n2,Lyon,,false,2024-02-10,\n3,Paris,7,,,x';
  const structure = inferStructure(parseCSV(csv));
  const table = await columnsFromCSV(csv, structure);
  const rows = applyTypes(parseCSV(csv), structure);
  // booleans: a blank stays blank in both
  assert.deepEqual(frameRows(tableFrame(table)), rows);
  assert.equal(table.length, 3);
  assert.equal(get(table, 'n', 1), null, 'a blank number reads as null');
  assert.equal(get(table, 'day', 0), '2024-01-03', 'dates read as ISO');
  assert.deepEqual(frameRows(tableFrame(table), 0, 1)[0], rows[0]);
  assert.equal(table.columns.n.kind, 'number');
  assert.equal(table.columns.city.kind, 'dict');
  assert.equal(table.columns.ok.kind, 'bool');
  assert.equal(table.columns.day.kind, 'dict');
});

test('columns: repeated text is stored once, mostly-unique text stays plain', async () => {
  const lines = ['id,country,email'];
  for (let i = 0; i < 30_000; i++) lines.push(`${i},Country ${i % 50},user${i}@mail.com`);
  const csv = lines.join('\n');
  const table = await columnsFromCSV(csv, inferStructure(parseCSV(csv.slice(0, 5000))));
  const country = table.columns.country as { kind: 'dict'; words: string[] };
  assert.equal(country.kind, 'dict');
  assert.equal(country.words.length, 50);
  assert.equal(table.columns.email.kind, 'text');
  assert.equal(get(table, 'email', 29_999), 'user29999@mail.com');
  assert.equal(get(table, 'country', 29_999), 'Country 49');
});

// --- text box templates ------------------------------------------------------------

test('templates: variables are the names used outside sections, plus section names', () => {
  assert.deepEqual(templateVariables('{{ total }} {{#rows}}{{region}} {{title}}{{/rows}} {{^none}}-{{/none}} {{a.b}} {{.}}').names, ['total', 'rows', 'none', 'a']);
  assert.deepEqual(templateVariables('no tags').names, []);
  assert.match(templateVariables('{{#rows}} open').error!, /Unclosed section/);
  assert.equal(templateVariables('{{ rows | length }}').error, undefined);
  assert.match(templateVariables('{{ rows | nosuch }}').error!, /Unknown filter "nosuch"/);
  assert.match(templateVariables('{% if x %}').error!, /aren't supported/);
  assert.match(templateVariables('{{/rows}}').error!, /Unopened section "rows"/);
});

test('templates: values go in as text (Markdown escapes HTML), sections repeat and test', () => {
  const r = renderTemplate('{{ name }}: {{#rows}}{{n}},{{/rows}}{{^empty}} none{{/empty}}', { name: 'A & <B>', rows: [{ n: 1 }, { n: 2 }], empty: [] });
  assert.equal(r.output, 'A & <B>: 1,2, none');
  assert.equal(r.error, undefined);
  assert.equal(renderTemplate('{{#x}}', {}).output, '');
});

test('formatValue: dates and other text are never read as numbers', () => {
  assert.equal(formatValue('2025-01-01', 'date'), '2025-01-01');
  assert.equal(formatValue('2025-01-01', 'number'), '2025-01-01');
  assert.equal(formatValue('1500', 'number'), '1500', 'text stays as written');
  assert.equal(formatValue('02134'), '02134');
  assert.equal(formatValue('12abc', 'integer'), '12abc');
});

// --- scatter -------------------------------------------------------------------------

const scatterEl = (mapping: ChartElement['mapping'], extra: Partial<ChartElement> = {}): ChartElement =>
  ({ id: 's', type: 'chart', chartType: 'scatter', x: 0, y: 0, w: 6, h: 4, mapping, ...extra }) as ChartElement;

test('scatter: one point per row with numbers for both axes, colored by legend', () => {
  const f = rowsFrame([
    { p: 1, q: 10, g: 'a' }, { p: 2, q: 20, g: 'b' }, { p: '', q: 5, g: 'a' }, { p: 3, q: 30, g: 'a' }
  ]);
  const pts = scatterPoints(scatterEl({ x: 'p', y: 'q', group: 'g' }), f)!;
  assert.equal(pts.n, 3);
  assert.deepEqual([...pts.xs.subarray(0, 3)], [1, 2, 3]);
  assert.deepEqual([...pts.series.subarray(0, 3)], [0, 1, 0]);
  assert.deepEqual(pts.seriesNames, ['a', 'b']);
  assert.equal(pts.names, null);
});

test('scatter: with details, one point per value, x and y summarized', () => {
  const f = rowsFrame([
    { item: 'A', price: 10, units: 1 }, { item: 'A', price: 20, units: 3 }, { item: 'B', price: 5, units: 7 }
  ]);
  const pts = scatterPoints(scatterEl({ x: 'price', y: 'units', detail: 'item' }, { xSummary: { aggregate: 'avg' } }), f)!;
  assert.deepEqual(pts.names, ['A', 'B']);
  assert.deepEqual([...pts.xs], [15, 5]);
  assert.deepEqual([...pts.ys], [4, 7]);
});

test('scatter: draws one path per series, at most one point per 2×2 px cell, with tooltips', () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ({ a: i % 100, b: (i * 7) % 50, g: i % 2 ? 'odd' : 'even' }));
  const spec = buildChart(scatterEl({ x: 'a', y: 'b', group: 'g' }), rowsFrame(rows));
  assert.deepEqual(spec.legend.map(l => l.name), ['even', 'odd']);
  const svg = spec.draw!({ w: 400, h: 300 });
  const paths = [...svg.matchAll(/class="c-points" data-s="\d+" d="([^"]+)"/g)];
  assert.equal(paths.length, 2);
  const dots = paths.reduce((n, m) => n + (m[1].match(/h0/g) || []).length, 0);
  assert.ok(dots > 0 && dots <= 5000, `${dots} dots for 20,000 rows`);
  const [, px, py] = /M([\d.]+) ([\d.]+)h0/.exec(paths[0][1])!.map(Number);
  const tip = spec.tip!(null as any, null as any, { x: px + 1, y: py });
  assert.ok(tip && tip.rows[0].label === 'a' && tip.rows[1].label === 'b', JSON.stringify(tip));
  assert.equal(spec.tip!(null as any, null as any, { x: -50, y: -50 }), null);
});

test('scatter: round axis ticks; a fixed minimum and maximum are kept', () => {
  assert.deepEqual(valueAxis(3, 97, 5).ticks, [0, 20, 40, 60, 80, 100]);
  const fixed = valueAxis(3, 97, 5, { min: 10, max: 90 });
  assert.equal(fixed.lo, 10);
  assert.equal(fixed.hi, 90);
  assert.deepEqual(fixed.ticks, [20, 40, 60, 80]);
  assert.equal(chartKind('scatter'), 'scatter');
});

// --- drawing -----------------------------------------------------------------------

test('drawing: coordinates print with two decimals at most, without rounding noise', () => {
  assert.deepEqual([0.1 + 0.2, -1.005, 12, 1e-7, 2.5].map(num), ['0.3', '-1', '12', '0', '2.5']);
  assert.deepEqual(valueAxis(0, 0.7, 7).ticks, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
});

test('drawing: text shrinks, then is cut with an ellipsis, to fit a width', () => {
  const m = measurer();
  assert.equal(fitText('Revenue', 200, 13, 7, m)!.size, 13);
  assert.ok(fitText('Revenue', 30, 13, 7, m)!.size < 13);
  assert.match(fitText('A very long section name', 40, 13, 7, m)!.text, /…$/);
  assert.equal(fitText('Revenue', 2, 13, 7, m), undefined);
});

test('drawing: treemap, sankey and radar pieces carry the data their tooltips show', () => {
  const rows = [{ from: 'A', to: 'X', v: 3 }, { from: 'A', to: 'Y', v: 1 }, { from: 'B', to: 'X', v: 2 }];
  const sankey = buildChart(chart({ chartType: 'sankey', mapping: { x: 'from', y: 'v', group: 'to' } }), rowsFrame(rows));
  const svg = drawn(sankey, 500, 300);
  assert.equal((svg.match(/class="c-sankey-link"/g) || []).length, 3);
  assert.equal(sankey.tip!(over(0), null as any, { x: 0, y: 0 })!.title, 'A → X');
  // nodes in order of first appearance: A, X, Y, B
  const x = { ...over(3), closest: (sel: string) => (sel.includes('link') ? null : { getAttribute: () => '3' }) } as unknown as Element;
  assert.deepEqual(sankey.tip!(x, null as any, { x: 0, y: 0 }), { title: 'B', rows: [{ label: 'Sum of v', value: '2' }] });
  const loop = buildChart(chart({ chartType: 'sankey', mapping: { x: 'from', y: 'v', group: 'to' } }), rowsFrame([{ from: 'A', to: 'B', v: 1 }, { from: 'B', to: 'A', v: 1 }]));
  assert.throws(() => drawn(loop), /circle/);
  const tree = buildChart(chart({ chartType: 'treemap', mapping: { x: 'to', y: 'v', group: 'from' } }), rowsFrame(rows));
  assert.match(drawn(tree), /class="c-node c-section"/);
  assert.deepEqual(tree.tip!(over(0), null as any, { x: 0, y: 0 }), { title: 'A', rows: [{ label: 'Sum of v', value: '4' }] });
});

// --- stacking, areas, donuts, matrices ------------------------------------------------

test('stacked bars stand on each other; 100% stacked fill each category', () => {
  const stacked = drawn(buildChart(chart({ mapping: { x: 'region', y: 'v', group: 'q' }, options: { stack: 'stacked' } }), rowsFrame(sales)));
  // East: 10 (Q1) and 30 (Q2) in one bar of 40, as tall as North's 40
  const rects = [...stacked.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"\/>/g)].map(m => m.slice(1).map(Number));
  const east = rects.filter(r => r[0] === rects[0][0]);
  assert.equal(east.length, 2);
  assert.ok(Math.abs(east[0][1] - (east[1][1] + east[1][2])) < 0.02, 'Q1 starts where Q2 ends');
  const pct = buildChart(chart({ mapping: { x: 'region', y: 'v', group: 'q' }, options: { stack: 'percent' } }), rowsFrame(sales));
  assert.deepEqual(texts(drawn(pct), 'end').slice(-1), ['100%']);
  const [, x, y, w] = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/.exec(drawn(pct))!.map(Number);
  assert.equal(pct.tip!({ tagName: 'svg', closest: () => null } as unknown as Element, null as any, { x: x + w / 2, y: y + 1 })!.rows[0].value, '25.0% (10)');
});

test('area charts fill under the line; donuts have a hole', () => {
  const area = drawn(buildChart(chart({ chartType: 'area', mapping: { x: 'region', y: 'v', group: 'q' }, options: { stack: 'stacked' } }), rowsFrame(sales)));
  assert.equal((area.match(/class="c-area"/g) || []).length, 2);
  assert.doesNotMatch(area, /<circle/);
  const donut = drawn(buildChart(chart({ chartType: 'donut' }), rowsFrame(sales)));
  // a ring slice: out along the rim, in, then back along the inner rim
  assert.match(donut, /class="c-slice" data-i="0" d="M[^"]*A[^"]*L[^"]*A[^"]*Z"/);
});

test('matrix: rows in a hierarchy, columns across, subtotals and grand totals', () => {
  const m = buildMatrix(
    { id: 'm', type: 'matrix', x: 0, y: 0, w: 8, h: 5, rows: [{ field: 'region' }], columns: [{ field: 'q' }], values: [{ field: 'v' }, { field: 'v', aggregate: 'count' }] },
    rowsFrame(sales)
  );
  assert.deepEqual(m.headers, [[{ label: 'Q1', span: 1 }, { label: 'Q2', span: 1 }]]);
  assert.equal(m.cols, 2);
  assert.ok(m.totalCol);
  assert.deepEqual(m.rows.map(r => r.label), ['East', 'North', 'West']);
  // East: Q1 10 (1 row), Q2 30 (1 row), Total 40 (2 rows)
  assert.deepEqual(m.rows[0].cells, [10, 1, 30, 1, 40, 2]);
  assert.deepEqual(m.rows[1].cells, [40, 1, null, null, 40, 1]);
  assert.deepEqual(m.total, [70, 3, 30, 1, 100, 4]);
  const nested = buildMatrix({ id: 'm', type: 'matrix', x: 0, y: 0, w: 8, h: 5, rows: [{ field: 'region' }, { field: 'q' }], values: [{ field: 'v', showAs: 'percent-of-total' }] }, rowsFrame(sales));
  assert.deepEqual(nested.rows[0].children.map(r => [r.label, r.depth, r.cells[0]]), [['Q1', 1, 0.1], ['Q2', 1, 0.3]]);
  assert.equal(nested.rows[0].cells[0], 0.4);
  assert.equal(nested.totalCol, false);
});

test('time intelligence: running totals and comparisons with another period, along a chart axis and a matrix', () => {
  // two years of two months; with no date filter the comparison reads the same rows, each month a year back
  const months = rowsFrame([
    { d: '2024-01-15', region: 'East', v: 100 }, { d: '2024-02-15', region: 'East', v: 200 },
    { d: '2025-01-15', region: 'East', v: 150 }, { d: '2025-02-15', region: 'East', v: 300 }
  ]);
  const same = () => ({ frame: months, measure: () => null });
  const bars = (summary: object) => barHeights(drawn(buildChart(chart({ mapping: { x: 'd', y: 'v' }, dateParts: { x: 'month' }, summary }), months, { xDate: true, compared: same })));
  assert.deepEqual(bars({ showAs: 'running-total' }), [0.13, 0.4, 0.6, 1], '100, 300, 450, 750');
  // last year's value for each month: none for 2024, then 100 and 200
  assert.deepEqual(bars({ compare: { shift: 'year', show: 'value' } }).slice(-2), [0.5, 1]);
  const legend = buildChart(chart({ chartType: 'combo', mapping: { x: 'd', y: 'v', line: 'v' }, dateParts: { x: 'month' }, lineSummary: { compare: { shift: 'year', show: 'value' } } }), months, { xDate: true, compared: same }).legend;
  assert.deepEqual(legend.map(l => l.name), ['Sum of v', 'Sum of v, last year']);
  // a matrix: each year's column against the one before it, the difference; a running total along the columns
  const m = buildMatrix(
    { id: 'm', type: 'matrix', x: 0, y: 0, w: 8, h: 5, rows: [{ field: 'region' }], columns: [{ field: 'd', datePart: 'year' }], values: [{ field: 'v', compare: { shift: 'year', show: 'difference' } }, { field: 'v', showAs: 'running-total' }] },
    months, () => null, undefined, same
  );
  assert.deepEqual(m.rows[0].cells, [null, 300, 150, 750, 450, 750], '2024: nothing before it; 2025: 450 − 300; the total: 750 − 2024 moved onto 2025 (300)');
  // only the total row, or only the total column
  assert.equal(buildMatrix({ id: 'm', type: 'matrix', x: 0, y: 0, w: 8, h: 5, columns: [{ field: 'd', datePart: 'year' }], values: [{ field: 'v' }], totals: 'row' }, months).totalCol, false);
});

test('chart format: fixed units, colorable names, reference lines, axes and bars', () => {
  // fixed display units put every label in them; ticks keep their own digits
  assert.equal(formatCompact(1250000, 'currency|millions'), '$1.25M');
  assert.equal(formatCompact(400000, 'currency|millions', 1), '$0.4M');
  const frame = rowsFrame(sales);
  // one series: its name to color; one color per bar: the categories
  assert.deepEqual(buildChart(chart({}), frame).names, ['Sum of v']);
  const vary = buildChart(chart({ options: { varyColors: true } }), frame);
  assert.deepEqual(vary.names, ['East', 'West', 'North']);
  assert.match(drawn(vary), /<rect [^>]*fill="var\(--series-2\)"/);
  // an average line, labelled with its value; hidden axes; rounded bars; no gridlines
  const svg = drawn(buildChart(chart({ options: { refLines: [{ stat: 'average', label: 'Average' }], valueAxis: false, categoryAxis: false, barRadius: 4, gridlines: false } }), frame));
  assert.match(svg, /class="c-ref-lines"[^]*Average 33\.3/);
  assert.doesNotMatch(svg, /class="c-grid"/);
  assert.match(svg, /<rect [^>]*rx="4"/);
  assert.equal(texts(svg, 'end').length + texts(svg, 'middle').length, 0, 'no axis labels');
});

test('display units: divided and suffixed, set on a format', () => {
  assert.equal(formatValue(416161000000, withUnits('currency', 'billions')), '$416.16B');
  assert.equal(formatValue(1093587000, 'integer|millions'), '1,094M');
  assert.equal(formatValue(-52764000, 'currency|auto'), '-$52.76M');
  assert.equal(formatValue(850, 'number|auto'), '850');
  assert.equal(formatValue(0.268, 'percent|millions'), '26.8%');
  assert.equal(withUnits('currency|millions', 'billions'), 'currency|billions');
  assert.equal(withUnits(undefined, undefined), undefined);
});

test('summaries: spread, most common, first and last; text and dates where a single value is shown', () => {
  const v = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(summarize(v, 'var'), 32 / 7);
  assert.equal(summarize(v, 'stdev'), Math.sqrt(32 / 7));
  assert.equal(summarize([5], 'stdev'), null, 'a spread needs two values');
  assert.equal(summarize(v, 'mode'), 4);
  assert.equal(summarize([3, null, 8, ''], 'first'), 3);
  assert.equal(summarize([3, null, 8, ''], 'last'), 8);
  assert.equal(summarize([3, 8], 'latest'), 8, 'older files say latest');
  const value = (values: unknown[], m: Parameters<typeof summarizeValue>[2]) => summarizeValue(values.length, k => values[k], m);
  const regions = ['West', 'east', '', 'North', 'West', null];
  assert.equal(value(regions, 'min'), 'east');
  assert.equal(value(regions, 'max'), 'West');
  assert.equal(value(regions, 'mode'), 'West');
  assert.equal(value(regions, 'first'), 'West');
  assert.equal(value(regions, 'last'), 'West');
  assert.equal(value(['Q10', 'Q2', 'Q9'], 'max'), 'Q10', 'natural order');
  assert.equal(value(['2024-03-01', '2023-12-31', '2024-01-15'], 'min'), '2023-12-31');
  assert.equal(value(['02134', '10001'], 'min'), '02134', 'text that looks numeric stays text');
  assert.equal(value([3, 1, 2], 'max'), 3, 'numbers stay numbers');
  assert.equal(value(['a', 'b'], 'sum'), null, 'and text still has no sum');
});

test('templates: filters, alone or chained, on values and on sections', () => {
  const rows = [{ q: 'Q1', v: 10 }, { q: 'Q2', v: 40 }, { q: 'Q3', v: 25 }];
  const r = (t: string, vars: Record<string, unknown> = {}) => renderTemplate(t, { rows, name: 'north america', total: 1234.567, day: '2025-03-07', none: '—', ...vars });
  assert.equal(r('{{ name | upper }} · {{ name | title }} · {{ name | truncate: 5 }}').output, 'NORTH AMERICA · North America · north…');
  assert.equal(r('{{ total | round }} {{ total | round: 1 }} {{ total | format: "currency" }} {{ total | format }}').output, '1235 1234.6 $1,235 1.2K');
  assert.equal(r('{{ day | date }} · {{ day | date: "MMMM yyyy" }} · {{ month | date: "MMM yy" }}', { month: '2025-03' }).output, 'Mar 7, 2025 · March 2025 · Mar 25');
  assert.equal(r('{{ none | default: "n/a" }} {{ missing | default: \'?\' }}').output, 'n/a ?');
  assert.equal(r('{{ rows | size }} {{ rows | length }}').output, '3 3');
  assert.equal(r('{{#rows | sort: "v" | reverse | first: 2}}{{q}} {{/rows}}').output, 'Q2 Q3 ', 'the top 2 by v');
  assert.equal(r('{{ list | join: " / " }} | {{ list }} | {{ list | last }}', { list: ['a', 'b'] }).output, 'a / b | a, b | b');
  assert.equal(r('{{! a comment }}{{& name }}').output, 'north america');
  assert.equal(r('{{ name | nosuch }}').error, 'Unknown filter "nosuch"');
});

test('templates: a section tag alone on its line takes the line with it, so lists stay lists', () => {
  const out = renderTemplate('Managers:\n{{#rows}}\n- {{q}}\n{{/rows}}\nEnd', { rows: [{ q: 'A' }, { q: 'B' }] }).output;
  assert.equal(out, 'Managers:\n- A\n- B\nEnd');
  assert.equal(renderTemplate('{{#rows}}{{q}}{{/rows}} inline', { rows: [{ q: 'A' }] }).output, 'A inline');
});

test('templates: names are read from the innermost section out; output is capped', () => {
  assert.equal(renderTemplate('{{#rows}}{{q}}-{{title}};{{/rows}}', { title: 'T', rows: [{ q: 1 }, { q: 2, title: 'own' }] }).output, '1-T;2-own;');
  assert.equal(renderTemplate('{{#a}}{{b.c}}{{/a}}', { a: { b: { c: 'deep' } } }).output, 'deep');
  const many = Array.from({ length: 1000 }, () => ({ s: 'x'.repeat(300) }));
  assert.match(renderTemplate('{{#many}}{{s}}{{/many}}', { many }).error!, /too long/);
});

test('templates: names every object has are not variables; inner names are listed in `all`', () => {
  assert.equal(renderTemplate('x {{ toString }} {{ constructor }} {{ a.constructor }} y', { a: {} }).output, 'x    y');
  const v = templateVariables('{{#total}}Total {{total}} over {{n}} on {{page}}{{/total}}');
  assert.deepEqual(v.names, ['total']);
  assert.deepEqual(v.all, ['total', 'n', 'page']);
});

test('templates: "—" (no value) is empty for sections; data is text, not Markdown, unless asked', () => {
  assert.equal(renderTemplate('A[{{t}}] B[{{^t}}none{{/t}}] C[{{#t}}some{{/t}}]', { t: '—' }).output, 'A[—] B[none] C[]');
  const vars = { f: 'file_name_v2', b: '**bold**', l: '[click](https://evil.example/x)', h: '# big', n: '1. one' };
  const html = parseMarkdown(renderTemplate('{{f}} {{b}} {{l}}\n{{h}}\n{{n}}\n{{& b}}', vars).output);
  const shown = html.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c));
  assert.ok(shown.includes('file_name_v2 **bold** [click](https://evil.example/x)') && shown.includes('# big') && shown.includes('1. one'), shown);
  assert.ok(!html.includes('<em>'), html);
  assert.ok(!html.includes('<a ') && !html.includes('<h1') && !html.includes('<ol') && html.includes('<strong>bold</strong>'), html);
  assert.equal(html.match(/<strong>/g)!.length, 1, 'only the raw value is styled');
  assert.ok(parseMarkdown('[docs](https://ex.com/my_page_name) and _this_').includes('href="https://ex.com/my_page_name"'));
  assert.ok(parseMarkdown('| a \\| b | c |').includes('<th>a &#124; b</th>'));
});

test('templates: edge cases of tags and filters', () => {
  assert.equal(renderTemplate('{{ x }}}', { x: 1 }).output, '1}');
  assert.equal(renderTemplate('{{{ x }}}', { x: '*a*' }).output, '*a*');
  assert.equal(renderTemplate('{{ x | round: "a" }} {{ x | round: 400 }} {{ x | round: -1 }}', { x: 1234.5 }).output, '1235 1234.5 1230');
  assert.equal(renderTemplate('{{ d | date: "Today is d MMM" }} {{ d | date: "yyyyMMdd" }}', { d: '2025-03-05' }).output, 'Today is 5 Mar 20250305');
});

test('templates: renaming a table or a column rewrites the names that read it', () => {
  const t = '{{#sales | sort: "revenue"}}{{category}} {{/sales}}{{ sales | size }} {{! sales }}{{ category }}';
  assert.equal(renameInTemplate(t, n => (n === 'sales' ? 'orders' : n)), '{{#orders | sort: "revenue"}}{{category}} {{/orders}}{{orders | size}} {{! sales }}{{ category }}');
  const col = renameInTemplate(t, (n, within) => (n === 'category' && within.at(-1) === 'sales' ? 'kind' : n === 'revenue' && within.at(-1) === 'sales' ? 'amount' : n));
  assert.equal(col, '{{#sales | sort: "amount"}}{{kind}} {{/sales}}{{ sales | size }} {{! sales }}{{ category }}');
});

test('CSV: number-like headers keep their place; inline code shows its marks', () => {
  assert.deepEqual(inferStructure(parseCSV('region,2023,2024\nNorth,10,20')).map(c => c.name), ['region', '2023', '2024']);
  assert.ok(parseMarkdown('`**a**` and **b**').includes('<code class="md-inline-code">&#42;&#42;a&#42;&#42;</code> and <strong>b</strong>'));
});

test('JSON: plain values, nested values and wrapped lists all become rows', () => {
  assert.deepEqual(parseJSON('[1,2,3]'), [{ value: 1 }, { value: 2 }, { value: 3 }]);
  assert.deepEqual(parseJSON('[{"a":{"b":1},"c":[1,2]}]'), [{ a: '{"b":1}', c: '[1,2]' }]);
  assert.deepEqual(parseJSON('{"data":[{"a":1},{"a":2}]}'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseJSON('{"a":[1,2],"b":[3,4]}'), [{ a: 1, b: 3 }, { a: 2, b: 4 }]);
  assert.deepEqual(JSON.parse(renameColumnInText('json', '{"data":[{"a":1}]}', 'a', 'z')), [{ z: 1 }]);
});

test('templates: weekday names; Markdown: a link address keeps its * and _', () => {
  assert.equal(renderTemplate('{{ d | date: "dddd, MMM d" }} {{ d | date: "ddd" }}', { d: '2025-03-05' }).output, 'Wednesday, Mar 5 Wed');
  const html = parseMarkdown('[a](https://ex.com/*x*/y_z_)');
  assert.ok(html.includes('href="https://ex.com/*x*/y_z_"') && !html.includes('<em>'), html);
});

test('relationships: keys match as Power BI matches them; a lookup never repeats rows', () => {
  assert.deepEqual(['2024', '2024.0', ' S1 ', 's1', '00501', '2024-01-01T00:00', 7].map(keyText), ['2024', '2024', 's1', 's1', '00501', '2024-01-01', '7']);
  const fact = columnsFromRows([{ k: 's1', v: 1 }, { k: 'S2', v: 2 }, { k: 's2', v: 3 }], [{ name: 'k', type: 'string' }, { name: 'v', type: 'int' }]);
  const dim = columnsFromRows([{ k: 'S1', g: 'a' }, { k: 'S2', g: 'b' }, { k: 'S2', g: 'b (old)' }], [{ name: 'k', type: 'string' }, { name: 'g', type: 'string' }]);
  const joined = joinFrame(tableFrame(fact), 'k', dim, 'k', 'dim', true);
  assert.equal(joined.length, 3, 'a repeated dimension key matches its first row');
  assert.deepEqual(frameRows(joined).map(r => r['dim.g']), ['a', 'b', 'b']);
  assert.equal(joinFrame(tableFrame(fact), 'k', dim, 'k', 'dim').length, 5, 'a plain join repeats them');
  assert.equal(filterFrame(tableFrame(fact), [{ field: 'k', values: ['S1'], match: 'key' }]).length, 1);
});

test('measures: a calculation can use another table\'s measure, worked out for the same cell', () => {
  const all: DashMeasure[] = [
    { name: 'Revenue', table: 'f', aggregate: 'sum', field: 'v' },
    { name: 'Target', table: 'g', aggregate: 'sum', field: 't' },
    { name: 'Attainment', table: 'f', op: '/', a: { measure: 'Revenue' }, b: { measure: 'Target', table: 'g' } }
  ];
  const targets = rowsFrame([{ t: 50 }, { t: 150 }]);
  const env = { narrow: (fr: any) => fr, across: (table: string) => (table === 'g' ? targets : tableFrame()) };
  assert.equal(compileMeasure(all, 'f', 'Attainment', env)!(rowsFrame([{ v: 40 }, { v: 60 }])), 0.5);
  assert.equal(compileMeasure(all, 'f', 'Attainment')!(rowsFrame([{ v: 40 }])), null, 'without the store, another table has no rows');
});

test('measures: several where conditions must all hold', () => {
  const rows = rowsFrame([{ r: 'N', c: 'a', v: 1 }, { r: 'N', c: 'b', v: 2 }, { r: 'S', c: 'a', v: 4 }]);
  const ms: DashMeasure[] = [{ name: 'Na', table: 't', aggregate: 'sum', field: 'v', where: [{ field: 'r', values: ['N'] }, { field: 'c', values: ['a'] }] }];
  assert.equal(compileMeasure(ms, 't', 'Na')!(rows), 1);
  assert.equal(measureError(ms, { ...ms[0], name: 'X', where: [{ field: 'r', values: ['N'] }, { field: 'nope', values: ['a'] }] }, () => ['r', 'c', 'v']), 't has no column "nope".');
});

test('sort-by: categories and matrix headers follow another column', () => {
  const rank: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3 };
  const cmp = (a: string, b: string) => (rank[a] ?? 99) - (rank[b] ?? 99);
  assert.deepEqual(orderCategories(['Mar', 'Jan', 'Feb'], new Map(), {}, false, undefined, cmp), ['Jan', 'Feb', 'Mar']);
  assert.deepEqual(orderCategories(['Mar', 'Jan', 'Feb'], new Map(), { sort: 'label' }, false, undefined, cmp), ['Jan', 'Feb', 'Mar'], '"label" order is the sort-by order');
  assert.deepEqual(orderCategories(['Mar', 'Jan', 'Feb'], new Map(), {}), ['Mar', 'Jan', 'Feb'], 'without one, the data\'s order');
  const frame = rowsFrame([{ m: 'Mar', v: 3 }, { m: 'Jan', v: 1 }, { m: 'Feb', v: 2 }]);
  const el = { id: 'm', type: 'matrix', x: 0, y: 0, w: 6, h: 4, rows: [{ field: 'm' }], values: [{ field: 'v' }] } as any;
  assert.deepEqual(buildMatrix(el, frame).rows.map(r => r.label), ['Feb', 'Jan', 'Mar']);
  assert.deepEqual(buildMatrix(el, frame, undefined, () => cmp).rows.map(r => r.label), ['Jan', 'Feb', 'Mar']);
});

test('comparisons: the previous period or a year back, for picks and ranges', () => {
  assert.deepEqual(['2025 Q4', '2025 Q1'].map(k => shiftKey(k, 'quarter', 'period')), ['2025 Q3', '2024 Q4']);
  assert.equal(shiftKey('2025 Q1', 'quarter', 'year'), '2024 Q1');
  assert.deepEqual(['2025-01', '2025-03'].map(k => shiftKey(k, 'month', 'period')), ['2024-12', '2025-02']);
  assert.equal(shiftKey('2025', 'year', 'period'), '2024');
  assert.deepEqual([shiftKey('2025-03-01', 'day', 'period'), shiftKey('2024-02-29', 'day', 'year')], ['2025-02-28', '2023-02-28']);
  assert.deepEqual(shiftRange('2025-10-01', '2025-12-31', 'period'), { from: '2025-07-01', to: '2025-09-30' }, 'whole months move by months');
  assert.deepEqual(shiftRange('2025-03-10', '2025-03-16', 'period'), { from: '2025-03-03', to: '2025-03-09' }, 'else by days');
  assert.deepEqual(shiftRange('2025-01-01', '2025-03-31', 'year'), { from: '2024-01-01', to: '2024-03-31' });
  const own = [{ field: 'date', datePart: 'quarter' as const, values: ['2025 Q4'] }, { field: 'region', values: ['North'] }];
  assert.deepEqual(shiftFilters(own, 'period', f => f.field === 'date'), [{ field: 'date', datePart: 'quarter', values: ['2025 Q3'] }], 'only date filters move');
});

// --- data loading edge cases -----------------------------------------------------------------

test('CSV: a quote opens a field only at its start; whitespace-only lines are not records', () => {
  const csv = 'name,height\nBob,5\'10"\nAl,6\'0"\nCy,5\'2"';
  assert.deepEqual(parseCSV(csv).map(r => r.height), ['5\'10"', '6\'0"', '5\'2"']);
  assert.equal(csvHead(csv, 10).total, 3);
  assert.equal(csvHead('a,b\n1,2\n   \n3,4', 10).total, 2);
  assert.deepEqual(parseCSV('a,b\n"x, ""y""",2').map(r => r.a), ['x, "y"']);
});

test('CSV: repeated headers get their own columns; renaming keeps every header in place', async () => {
  assert.deepEqual(parseCSV('a,b,a\n1,2,3'), [{ a: '1', b: '2', 'a 2': '3' }]);
  const t = await columnsFromCSV('a,b,a\n1,2,3', inferStructure(parseCSV('a,b,a\n1,2,3')));
  assert.deepEqual([get(t, 'a', 0), get(t, 'a 2', 0)], [1, 3]);
  assert.equal(renameColumnInText('csv', 'region,2023,2024\nNorth,10,20', 'region', 'area'), 'area,2023,2024\nNorth,10,20');
  assert.equal(renameColumnInText('csv', 'a,b,a\n1,2,3', 'b', 'c'), 'a,c,a 2\n1,2,3');
  assert.equal(renameColumnInText('csv', '"x\ny",b\n1,2', 'b', 'c'), '"x\ny",c\n1,2');
});

test('types: guessed from every sampled row, numbers kept whole, mixed kinds stay text', () => {
  const rows = [...Array.from({ length: 55 }, (_, i) => ({ n: String(i) })), { n: '56.75' }];
  assert.equal(inferStructure(rows)[0].type, 'float');
  const type = (vals: string[]) => inferStructure(vals.map(v => ({ v })))[0].type;
  assert.equal(type(['1e3', '2']), 'int');
  assert.equal(type(['00501', '10001']), 'string', 'zip codes keep their zeros');
  assert.equal(type(['0x1A', '5']), 'string');
  assert.equal(type(['true', '1', '0']), 'boolean');
  assert.equal(type(['true', '5']), 'string');
  assert.equal(type(['2024', '2024-01-01']), 'string');
  assert.deepEqual(inferStructure([{ a: 1 }, { a: 2, b: 3 }]).map(c => c.name), ['a', 'b'], 'JSON rows: every key');
  assert.equal(CONVERT.int('1e3'), 1000);
  assert.equal(CONVERT.int('56.75'), 56.75);
  for (const bad of ['1,234.50', '12%', '$3,000', '0x1A', ' ', 'Infinity']) assert.equal(CONVERT.float(bad), null, bad);
  assert.equal(CONVERT.float(' 2.5 '), 2.5);
});

test('booleans: a blank stays blank', async () => {
  const csv = 'id,f\n1,true\n2,\n3,false';
  const t = await columnsFromCSV(csv, inferStructure(parseCSV(csv)));
  assert.deepEqual([0, 1, 2].map(i => get(t, 'f', i)), [true, null, false]);
  assert.equal(get(columnsFromRows([{ f: null }], [{ name: 'f', type: 'boolean', nullable: true }]), 'f', 0), null);
});

test('dates: a column reads slashed dates one way', async () => {
  const csv = 'd\n05/01/2024\n13/01/2024\n1/3/2024';
  const structure = inferStructure(parseCSV(csv));
  const t = await columnsFromCSV(csv, structure);
  assert.deepEqual([0, 1, 2].map(i => get(t, 'd', i)), ['2024-01-05', '2024-01-13', '2024-03-01']);
  assert.deepEqual(applyTypes(parseCSV(csv), structure).map(r => r.d), ['2024-01-05', '2024-01-13', '2024-03-01']);
  const us = await columnsFromCSV('d\n05/01/2024\n5/1/2024', [{ name: 'd', type: 'datetime', nullable: false }]);
  assert.deepEqual([get(us, 'd', 0), get(us, 'd', 1)], ['2024-05-01', '2024-05-01']);
  assert.equal((us.columns.d as { words: string[] }).words.length, 1, 'the same day is one word');
});

test('lastRange: month ends clamp to the shorter month', () => {
  assert.equal(lastRange(1, 'month', new Date(2026, 2, 31)).from, '2026-03-01');
  assert.equal(lastRange(1, 'month', new Date(2026, 2, 30)).from, '2026-03-01');
  assert.equal(lastRange(1, 'month', new Date(2025, 4, 31)).from, '2025-05-01');
  assert.equal(lastRange(1, 'year', new Date(2028, 1, 29)).from, '2027-03-01');
});

test('filters: a min/max range never passes a blank', () => {
  const t = filterTest({ field: 'n', min: 0, max: 10 });
  assert.deepEqual([null, '', ' ', 0, '5', 11].map(v => t(v)), [false, false, false, true, true, false]);
});

test('sortText: number-like text by value, the rest naturally', () => {
  assert.deepEqual(sortText(['-1.5', '-1.25', '-2.5', '0.5', '0.25', '1.5', '-3.25']), ['-3.25', '-2.5', '-1.5', '-1.25', '0.25', '0.5', '1.5']);
  assert.ok(compareText('Q2', 'Q10') < 0);
});

// --- chart and visual fixes ----------------------------------------------------------

test('formatValue: tiers carry, and small values keep their sign and digits', () => {
  assert.equal(formatValue(999_999.9), '1.0M');
  assert.equal(formatValue(2_500_000_000), '2.5B');
  assert.equal(formatValue(-1500), '-1.5K');
  assert.equal(formatValue(-0.004), '-0.004');
  assert.equal(formatValue(-0.00001, 'percent'), '0.0%');
  assert.equal(formatValue(-0.4, 'integer'), '0');
});

test('tickLabels: as many decimals as it takes to tell ticks apart', () => {
  const fmt = (v: number, d: number) => formatCompact(v, undefined, d);
  assert.deepEqual(tickLabels([0, 0.01, 0.02], fmt), ['0', '0.01', '0.02']);
  assert.deepEqual(tickLabels([1000, 1050, 1100], fmt), ['1K', '1.05K', '1.1K']);
  assert.deepEqual(tickLabels([0, 50, 100], fmt), ['0', '50', '100']);
  assert.equal(formatFull(0.00412), '0.00412');
});

test('valueAxis: a fixed end past the data is kept', () => {
  const a = valueAxis(0, 50, 5, { min: 100 });
  assert.equal(a.lo, 100);
  assert.ok(a.hi > 100);
  const b = valueAxis(-50, 0, 5, { max: -100 });
  assert.equal(b.hi, -100);
  assert.ok(b.lo < -100);
});

test('layoutLabel: a long word is cut short', () => {
  const m = measurer();
  const l = layoutLabel('x'.repeat(200), m, 11, 60);
  assert.ok(l.width <= 60 && l.lines[0].endsWith('…'));
  assert.equal(layoutLabel('2024-01-15', m, 11, 30, 120).lines[0], '2024-01-15', 'kept up to the limit');
});

test('pivot: blank categories are "(Blank)"; shares of a zero total are 0', () => {
  const f = rowsFrame([{ c: 'a', v: 5 }, { c: '', v: -5 }, { c: null, v: 0 }]);
  const { cats, totals } = pivot(f, 'c', 'v', undefined, 'sum', 'percent-of-total');
  assert.deepEqual(cats, ['a', '(Blank)']);
  assert.deepEqual([...totals.values()], [0, 0]);
});

test('pie: slices in date order, the top n keep it, the rest are "Other"', () => {
  const rows = [{ m: '2024-03-01', v: 1 }, { m: '2024-01-01', v: 5 }, { m: '2024-02-01', v: 3 }, { m: '2024-04-01', v: 4 }];
  const el = { id: 'p', type: 'chart', chartType: 'pie', x: 0, y: 0, w: 4, h: 4, mapping: { x: 'm', y: 'v' }, dateParts: { x: 'month' }, options: { topN: 2, showValues: true } } as ChartElement;
  const spec = buildChart(el, rowsFrame(rows), { xDate: true });
  assert.deepEqual(spec.legend.map(l => l.name), ['Jan 2024 · 5', 'Apr 2024 · 4', 'Other · 4']);
});

test('summarizeValue: mode of true/false is a boolean value', () => {
  assert.equal(summarizeValue(3, k => [true, false, true][k], 'mode'), 'true');
});

test('matrix: rows carry their keys, to sort by', () => {
  const m = buildMatrix({ id: 'm', type: 'matrix', x: 0, y: 0, w: 4, h: 4, rows: [{ field: 'd', datePart: 'month' }], values: [{ field: 'v', showAs: 'percent-of-total' }] } as any, rowsFrame([{ d: '2024-02-03', v: 0 }, { d: '2024-10-01', v: 0 }]));
  assert.deepEqual(m.rows.map(r => r.key), ['2024-02', '2024-10']);
  assert.equal(m.total[0], null, 'a share of a zero total is blank');
});

// --- minor chart and format fixes ------------------------------------------------------

test('formatValue: K/M/B/T like the axes, huge numbers in exponent form, cents, and no NaN', () => {
  assert.equal(formatValue(1500), '1.5K');
  assert.equal(formatValue(2.5e12), '2.5T');
  assert.equal(formatValue(1e21), '1.0e+21');
  assert.equal(formatValue(0.004, 'currency'), '$0.004');
  assert.equal(formatValue(1234, 'currency'), '$1,234');
  for (const v of [NaN, Infinity, -Infinity]) assert.equal(formatValue(v), '—');
});

test('summaries skip cells of only spaces', () => {
  const v = [10, ' ', '', 20, '\t'];
  assert.equal(summarizeRead(v.length, k => v[k], 'avg'), 15);
  assert.equal(summarizeRead(v.length, k => v[k], 'min'), 10);
  assert.equal(summarizeRead(v.length, k => v[k], 'distinct'), 2);
});

const chartOf = (patch: object) => ({ id: 'c', type: 'chart', x: 0, y: 0, w: 4, h: 4, mapping: { x: 'c', y: 'v' }, ...patch }) as unknown as ChartElement;

test('pie top n: n slices plus "Other", as bars keep n', () => {
  const frame = rowsFrame(['a', 'b', 'c', 'd', 'e'].map((c, i) => ({ c, v: i + 1 })));
  const legend = buildChart(chartOf({ chartType: 'pie', options: { topN: 3 } }), frame).legend.map(l => l.name);
  assert.deepEqual(legend, ['c', 'd', 'e', 'Other']);
});

test('charts: all-blank values draw nothing; a line at 100% shows each series\' share', () => {
  assert.equal(buildChart(chartOf({ chartType: 'bar' }), rowsFrame([{ c: 'a', v: '' }, { c: 'b', v: null }])).draw, undefined);
  const frame = rowsFrame([{ c: 'a', g: 'x', v: 1 }, { c: 'a', g: 'y', v: 3 }]);
  const spec = buildChart(chartOf({ chartType: 'line', mapping: { x: 'c', y: 'v', group: 'g' }, options: { stack: 'percent' } }), frame);
  const svg = spec.draw!({ w: 400, h: 300, font: 'sans-serif' } as any);
  assert.match(svg, /100%/);
  const tip = spec.tip!({ tagName: 'svg', closest: () => null } as any, null as any, { x: 200, y: 150 })!;
  assert.deepEqual(tip.rows.map(r => r.value), ['25.0% (1)', '75.0% (3)']);
});
