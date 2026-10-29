# Checks on skill/dashier-report/scripts/validate_dashier.py: date-part picks are checked as the app buckets them, and
# the "looks derived" warning skips keys, ids and text; build_report.py packs tables as columns. Usage: python3 tests/test_validator.py (with dist/ built)
import base64, csv, gzip, io, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = open(os.path.join(ROOT, 'dist', 'dashier.html'), encoding='utf-8').read()
sys.stdout.reconfigure(encoding='utf-8')  # the check marks, on a Windows console too


ROWS = False  # store the test tables as a header row and rows (csv), which is no longer a format


def src(cols, types, rows):
    lines = [cols, *rows]
    text = ''.join(','.join(map(str, r)) + '\n' for r in (lines if ROWS else zip(*lines)))
    return {'format': 'csv' if ROWS else 'csv-columns', 'encoding': 'gzip+base64', 'structure': [{'name': c, 'type': t} for c, t in zip(cols, types)],
            'payload': base64.b64encode(gzip.compress(text.encode())).decode()}


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
ROWS = True
rows = validate('2024 Q2')
check('a table stored as rows (the old csv format) fails', "FAIL: fact_sales: format 'csv'" in rows and 'RESULT: FAIL' in rows, rows)
ROWS = False

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
    check('build_report.py packs a CSV as columns that read back', x['format'] == 'csv-columns' and rows == list(csv.reader(io.StringIO(text))), cols[:60])
    check('…with plain gzip -9 (zopfli is for the app code only)', base64.b64decode(x['payload'])[10:] == gzip.compress(cols.encode(), 9)[10:])  # past the header's timestamp
print(f'\n{failures} check(s) FAILED' if failures else '\nAll checks passed.')
sys.exit(1 if failures else 0)
