# Checks on the skill's scripts: validate_dashier.py checks values (picks, filters, keys, types) as the app reads them,
# and its "looks derived" warning skips keys, ids and text; build_report.py packs tables as columns, typed as the app
# types them; dashier_data.py, which both use, answers as the app's own TypeScript does.
# Usage: python3 tests/test_validator.py (with dist/ built and node_modules installed)
import base64, csv, gzip, io, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = open(os.path.join(ROOT, 'dist', 'dashier.html'), encoding='utf-8').read()
sys.stdout.reconfigure(encoding='utf-8')  # the check marks, on a Windows console too


def src(cols, types, rows):
    lines = [cols, *rows]
    text = ''.join(','.join(map(str, r)) + '\n' for r in zip(*lines))
    return {'structure': [{'name': c, 'type': t} for c, t in zip(cols, types)],
            'payload': base64.b64encode(gzip.compress(text.encode())).decode()}


def run(doc):
    """The validator's WARN and FAIL lines for a document (in a copy of the built app)."""
    body = json.dumps(doc, indent=1).replace('<', '\\u003c')
    html = re.sub(r'(<script type="application/dashier\+json" id="dashier-doc">)[\s\S]*?(</script>)', lambda m: m[1] + body + m[2], APP)
    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as f:
        f.write(html)
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'skill/dashier-report/scripts/validate_dashier.py'), f.name], capture_output=True, text=True)
    os.remove(f.name)
    assert not r.stderr, r.stderr
    return [l for l in r.stdout.splitlines() if l.startswith(('WARN', 'FAIL'))]


def model(fact, dim, *elements):
    """A fact (keyed by k) looking up a dimension, a count measure, and a page of `elements` (a card first)."""
    card = {'id': 'c', 'type': 'card', 'x': 0, 'y': 0, 'w': 3, 'h': 2, 'sourceId': 'fact_x', 'aggregation': {'method': 'sum', 'field': '[N]'}}
    return {'format': 'dashier', 'version': 1, 'title': 'T', 'sources': {'fact_x': fact, 'dim_k': dim},
            'relationships': [{'from': {'table': 'fact_x', 'field': 'k'}, 'to': {'table': 'dim_k', 'field': 'k'}}],
            'measures': [{'name': 'N', 'table': 'fact_x', 'aggregate': 'count'}],
            'pages': [{'id': 'p', 'title': 'P', 'elements': [{**card, **(elements[0] if elements else {})}, *elements[1:]]}]}


def validate(pick):
    doc = {'format': 'dashier', 'version': 1, 'title': 'T', 'canvas': {'width': 1440, 'height': 810},
           'sources': {'fact_sales': src(['month', 'shopper_id', 'margin_key', 'amount', 'gross_margin_pct'], ['datetime', 'string', 'string', 'float', 'float'],
                                         [['2024-01-01', 'S1', 'M1', 5, 0.1], ['2024-05-01', 'S2', 'M1', 7, 0.2]]),
                       'dim_shopper': src(['shopper_id', 'share_class'], ['string', 'string'], [['S1', 'A'], ['S2', 'B']]),
                       'dim_margin': src(['margin_key', 'margin_tier'], ['string', 'string'], [['M1', 'Low']])},
           'relationships': [{'from': {'table': 'fact_sales', 'field': 'shopper_id'}, 'to': {'table': 'dim_shopper', 'field': 'shopper_id'}},
                             {'from': {'table': 'fact_sales', 'field': 'margin_key'}, 'to': {'table': 'dim_margin', 'field': 'margin_key'}}],
           'measures': [{'name': 'Amount', 'table': 'fact_sales', 'aggregate': 'sum', 'field': 'amount'}],
           'pages': [{'id': 'p', 'title': 'P', 'elements': [
               {'id': 's', 'type': 'slicer', 'x': 0, 'y': 0, 'w': 3, 'h': 2, 'sourceId': 'fact_sales', 'field': 'month', 'datePart': 'quarter', 'selection': {'values': [pick]}},
               {'id': 'c', 'type': 'card', 'x': 3, 'y': 0, 'w': 3, 'h': 2, 'sourceId': 'fact_sales', 'aggregation': {'method': 'sum', 'field': '[Amount]'}},
               {'id': 'b', 'type': 'chart', 'chartType': 'bar', 'x': 6, 'y': 0, 'w': 6, 'h': 3, 'sourceId': 'fact_sales', 'mapping': {'x': 'dim_shopper.share_class', 'y': '[Amount]'}}]}]}
    body = json.dumps(doc, indent=1).replace('<', '\\u003c')
    html = re.sub(r'(<script type="application/dashier\+json" id="dashier-doc">)[\s\S]*?(</script>)', lambda m: m[1] + body + m[2], APP)
    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False, encoding='utf-8') as f:
        f.write(html)
    out = subprocess.run([sys.executable, os.path.join(ROOT, 'skill/dashier-report/scripts/validate_dashier.py'), f.name], capture_output=True, text=True).stdout
    os.remove(f.name)
    return out


failures = 0
def check(name, ok, extra=''):
    global failures
    print(f'{"✓ PASS" if ok else "✗ FAIL"}: {name}' + (f' — {extra}' if extra and not ok else ''))
    failures += not ok


good = validate('2024 Q2')
check('a quarter pick that matches the data passes', 'RESULT: PASS' in good, good)
check('a quarter pick that matches nothing fails', "has no ['2023 Q1']" in validate('2023 Q1'))
check('a quarter pick written in the wrong case fails (the app writes "2024 Q1")', "has no ['2024 q1']" in validate('2024 q1'))
derived = re.findall(r'WARN: (\S+) looks derived', good)
check('"looks derived" warns on a derived number, not on keys, ids or text', derived == ['fact_sales.gross_margin_pct'], derived)

# build_report.py packs a CSV as columns (plain gzip) that read back with the guide's one-liner
with tempfile.TemporaryDirectory() as d:
    text = 'id,amount\n' + ''.join(f'K{i % 37},{i * 7 % 101}\n' for i in range(3000))
    open(os.path.join(d, 'x.csv'), 'w', encoding='utf-8').write(text)
    json.dump({**json.loads(re.search(r'id="dashier-doc">([\s\S]*?)</script>', APP)[1]), 'sources': {'x': {'file': 'x.csv'}}}, open(os.path.join(d, 'doc.json'), 'w', encoding='utf-8'))
    out = os.path.join(d, 'out.html')
    subprocess.run([sys.executable, os.path.join(ROOT, 'skill/dashier-report/scripts/build_report.py'), os.path.join(ROOT, 'dist', 'dashier.html'), os.path.join(d, 'doc.json'), out], check=True, capture_output=True)
    x = json.loads(re.search(r'id="dashier-doc">([\s\S]*?)</script>', open(out, encoding='utf-8').read())[1])['sources']['x']
    cols = gzip.decompress(base64.b64decode(x['payload'])).decode()
    rows = [list(r) for r in zip(*csv.reader(io.StringIO(cols)))]
    check('build_report.py packs a CSV as columns that read back', set(x) == {'structure', 'payload'} and rows == list(csv.reader(io.StringIO(text))), cols[:60])
    check('…with plain gzip -9 (zopfli is for the app code only)', base64.b64decode(x['payload'])[10:] == gzip.compress(cols.encode(), 9)[10:])  # past the header's timestamp

# the validator reads values as the app does (dashier_data.py)
DIM = src(['k', 'name'], ['string', 'string'], [['A1', 'x'], ['B2', 'y']])
out = run(model(src(['k', 'flag'], ['string', 'boolean'], [['A1', '1'], ['B2', 'no']]), DIM))
check('booleans 1, 0, yes and no are read (true, 1 and yes are true), not failed', not any('flag' in l for l in out), out)
out = run(model(src(['k', 'flag'], ['string', 'boolean'], [['A1', 'maybe'], ['B2', 'true']]), DIM))
check('…other text in a boolean column fails: it loads as false', any("holds ['maybe']: these load as false" in l for l in out), out)
out = run(model(src(['k'], ['string'], [['a1'], ['b2 ']]), DIM))
check('relationship keys match ignoring case, as the app matches them', not any('missing' in l for l in out), out)
out = run(model(src(['k'], ['int'], [['7']]), src(['k'], ['float'], [['7.0'], ['7']])))
check('…and numbers by value (7 = 7.0): a repeat counts', not any('missing' in l for l in out) and any('repeats' in l for l in out), out)
out = run(model(src(['k', 'v'], ['string', 'float'], [['A1', '1.5']]), DIM, {'filters': [{'table': 'fact_x', 'field': 'v', 'values': ['1.50']}]}))
check('a filter value is compared as written: "1.50" matches no 1.5 in the app, so it fails', any("has no ['1.50']" in l for l in out), out)
out = run(model(src(['k', 'v'], ['string', 'float'], [['A1', '1.5']]), DIM, {'filters': [{'table': 'fact_x', 'field': 'v', 'values': ['1.5']}]}))
check('…and "1.5" passes', not any('has no' in l for l in out), out)
slicer = {'id': 's', 'type': 'slicer', 'x': 3, 'y': 0, 'w': 3, 'h': 2, 'sourceId': 'fact_x', 'field': 'd', 'datePart': 'quarter', 'selection': {'values': ['2024 Q1']}}
out = run(model(src(['k', 'd'], ['string', 'datetime'], [['A1', '03/15/2024'], ['B2', '04/02/2024']]), DIM, {}, slicer))
check('dates the app reads (03/15/2024) are bucketed as it buckets them, with a warning to write them ISO', not any('FAIL' in l for l in out) and any('write dates as ISO' in l for l in out), out)
out = run(model(src(['k', 'd'], ['string', 'datetime'], [['A1', '03/15/2024'], ['B2', '15/04/2024']]), DIM))
check('…but a column whose dates are day first (15/04) reads them all so: 03/15/2024 is no date then', any("holds ['03/15/2024']: these load as blank" in l for l in out), out)
out = run(model(src(['k', 'd'], ['string', 'datetime'], [['A1', 'soon']]), DIM))
check('…a date the app can\'t read fails: it loads as blank', any("holds ['soon']: these load as blank" in l for l in out), out)

# build_report.py reads a CSV as the app does: lines of only spaces are no record; types as the app guesses them
with tempfile.TemporaryDirectory() as d:
    open(os.path.join(d, 'x.csv'), 'w', encoding='utf-8').write('id,when,ok,zip\nK1,03/15/2024,true,02134\n   \nK2,04/02/2024,1,10001\n')
    json.dump({**json.loads(re.search(r'id="dashier-doc">([\s\S]*?)</script>', APP)[1]), 'sources': {'x': {'file': 'x.csv'}}}, open(os.path.join(d, 'doc.json'), 'w', encoding='utf-8'))
    out = os.path.join(d, 'out.html')
    log = subprocess.run([sys.executable, os.path.join(ROOT, 'skill/dashier-report/scripts/build_report.py'), os.path.join(ROOT, 'dist', 'dashier.html'), os.path.join(d, 'doc.json'), out], check=True, capture_output=True, text=True).stdout
    x = json.loads(re.search(r'id="dashier-doc">([\s\S]*?)</script>', open(out, encoding='utf-8').read())[1])['sources']['x']
    check('build_report.py skips a line of only spaces, as the app does', 'x: 2 rows' in log, log)
    check('…and guesses types as the app does (slashed dates, 0/1 among true/false, a zip code stays text)', [c['type'] for c in x['structure']] == ['string', 'datetime', 'boolean', 'string'], x['structure'])
    check('…warning that dates are best written ISO', "aren't ISO" in log, log)

# dashier_data.py follows the app: the same answers as its own TypeScript (bundled with esbuild, run with node)
sys.path.insert(0, os.path.join(ROOT, 'skill/dashier-report/scripts'))
import dashier_data as D
VALUES = ['', '0', '007', '0.5', '.5', '+3', '-2.50', '1e3', '1,234', '0x1A', 'true', 'FALSE', 'yes', 'no', 'S1', ' A1 ', '2024', '2024.0',
          '2024-01-05', '2024-1-5', '2024-02-30', '2024-01-05T00:00', '2024-01-05 10:30:15', '03/15/2024', '15/03/2024', '05/01/2024',
          '1.3.2024', '02/29/2023', 'Jan 3, 2024', '3 January 2024', 'Sept 3, 2024', 'Foo 3, 2024']
NUMBERS = [0.1 + 0.2, 1e21, 1e-7, 1e-6, 2.0 ** 70, 1 / 3, -0.000001234]
entry = os.path.join(tempfile.mkdtemp(), 'rules.ts')
open(entry, 'w').write(f"""import {{ toISODate, dayFirst }} from {json.dumps(os.path.join(ROOT, 'src/runtime/dates'))};
import {{ keyText }} from {json.dumps(os.path.join(ROOT, 'src/runtime/data'))};
import {{ inferStructure }} from {json.dumps(os.path.join(ROOT, 'src/runtime/hydrate'))};
const vs = {json.dumps(VALUES)}, cols = vs.map((v, i) => [v, vs[(i * 7) % vs.length], vs[(i * 11) % vs.length]]);
console.log(JSON.stringify({{ iso: vs.map(v => [toISODate(v), toISODate(v, true)]), key: vs.map(keyText), num: {json.dumps(NUMBERS)}.map(String),
  infer: cols.map(c => [inferStructure(c.map(v => ({{ c: v }})))[0].type, dayFirst(c)]) }}));""")
bundle = entry[:-3] + '.cjs'
subprocess.run(['node', '-e', f'require({json.dumps(os.path.join(ROOT, "node_modules/esbuild"))}).buildSync({{ entryPoints: [{json.dumps(entry)}], bundle: true, platform: "node", outfile: {json.dumps(bundle)}, logLevel: "error" }})'], check=True)
js = json.loads(subprocess.run(['node', bundle], capture_output=True, text=True, check=True).stdout)
cols = [[v, VALUES[(i * 7) % len(VALUES)], VALUES[(i * 11) % len(VALUES)]] for i, v in enumerate(VALUES)]
py = {'iso': [[D.to_iso(v), D.to_iso(v, True)] for v in VALUES], 'key': [D.key_text(v, 'string') for v in VALUES], 'num': [D.js_num(n) for n in NUMBERS],
      'infer': [[D.infer(c), D.day_first(c)] for c in cols]}
for k in py:
    diff = [(a, b) for a, b in zip(js[k], py[k]) if a != b]
    check(f'dashier_data.py reads values as the app does: {k}', not diff, diff[:3])

# the site's skill zip (written by the build) holds the skill as it is, and its scripts run from it
import zipfile
SKILL = os.path.join(ROOT, 'skill', 'dashier-report')
with zipfile.ZipFile(os.path.join(ROOT, 'site', 'dashier-report-skill.zip')) as z, tempfile.TemporaryDirectory() as d:
    files = sorted(os.path.relpath(os.path.join(p, f), SKILL).replace(os.sep, '/') for p, ds, fs in os.walk(SKILL) for f in fs
                   if '__pycache__' not in p and not f.startswith('.'))
    zipped = sorted(n[len('dashier-report/'):] for n in z.namelist() if not n.endswith('/'))
    same = zipped == files and z.testzip() is None and all(z.read('dashier-report/' + f) == open(os.path.join(SKILL, f), 'rb').read() for f in files)
    check('the site\'s skill zip holds the skill folder as it is', same, f'{zipped} vs {files}')
    z.extractall(d)
    r = subprocess.run([sys.executable, os.path.join(d, 'dashier-report', 'scripts', 'validate_dashier.py'), os.path.join(ROOT, 'dist', 'dashier.html')], capture_output=True, text=True)
    check('…and its scripts run from it (dashier_data.py goes with them)', 'RESULT:' in r.stdout and not r.stderr, r.stderr[-300:])
print(f'\n{failures} check(s) FAILED' if failures else '\nAll checks passed.')
sys.exit(1 if failures else 0)
