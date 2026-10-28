#!/usr/bin/env python3
"""
Writes a Dashier document into a copy of a Dashier template.

    python3 build_report.py TEMPLATE.html DOC.json OUT.html

DOC.json is a normal Dashier document, except that a source may name a CSV file instead of carrying a payload:

    "fact_sales": {"file": "data/fact_sales.csv"}                        # structure inferred
    "dim_date":   {"file": "data/dim_date.csv", "structure": [...]}       # structure as given

Paths are relative to DOC.json. The CSV is stored as gzip+base64 with its structure (column names and types,
in header order). Sources that already have a payload are kept as they are. Every "<" in the JSON is written as
\\u003c, and nothing else in the template is touched. The template itself is never modified.
"""
import base64, csv, gzip, io, json, os, re, sys

NUM = re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$')


def infer(values):
    """The column's type from all of its values: blank cells don't count; mixed kinds are text."""
    kinds = set()
    for v in values:
        s = v.strip()
        if not s:
            continue
        if s.lower() in ('true', 'false'):
            kinds.add('boolean')
        elif NUM.match(s) and not re.match(r'^[-+]?0\d', s):  # 00501 is a code, not a number
            kinds.add('int' if re.match(r'^[-+]?\d+$', s) else 'float')
        elif DATE.match(s):
            kinds.add('datetime')
        else:
            kinds.add('string')
    if kinds <= {'int'}:
        return 'int' if kinds else 'string'
    if kinds <= {'int', 'float'}:
        return 'float'
    return kinds.pop() if len(kinds) == 1 else 'string'


def main(template, doc_path, out):
    html = open(template, encoding='utf-8').read()
    m = re.search(r'(<script type="application/dashier\+json" id="dashier-doc">)(.*?)(</script>)', html, re.S)
    if not m:
        sys.exit(f'{template}: no dashier-doc block (is this a Dashier file?)')
    doc = json.load(open(doc_path, encoding='utf-8'))
    base = os.path.dirname(os.path.abspath(doc_path))
    for name, src in (doc.get('sources') or {}).items():
        if 'file' not in src:
            continue
        text = open(os.path.join(base, src.pop('file')), encoding='utf-8-sig').read()
        rows = list(csv.reader(io.StringIO(text)))
        header = rows[0]
        if len(set(header)) != len(header):
            sys.exit(f'{name}: duplicate column names {header}')
        given = {c['name']: c for c in src.get('structure') or []}
        src['structure'] = [given.get(h) or {'name': h, 'type': infer(r[i] if i < len(r) else '' for r in rows[1:])} for i, h in enumerate(header)]
        src.update(format='csv', encoding='gzip+base64', payload=base64.b64encode(gzip.compress(text.encode('utf-8'), 9)).decode())
        print(f'{name}: {len(rows) - 1} rows, ' + ', '.join(f"{c['name']}:{c['type']}" for c in src['structure']))
    body = json.dumps(doc, indent=1, ensure_ascii=False).replace('<', '\\u003c')
    html = html[:m.start(2)] + '\n' + body + '\n  ' + html[m.end(2):]
    open(out, 'w', encoding='utf-8').write(html)
    print(f'wrote {out} ({len(html.encode()):,} bytes)')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
