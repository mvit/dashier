#!/usr/bin/env python3
"""
Writes a Dashier document into a copy of a Dashier template.

    python3 build_report.py DOC.json OUT.html                  # template: the current editor, downloaded
    python3 build_report.py TEMPLATE.html DOC.json OUT.html    # template: a Dashier file (path or URL)

DOC.json is a normal Dashier document, except that a source may name a CSV file instead of carrying a payload:

    "fact_sales": {"file": "data/fact_sales.csv"}                        # structure inferred
    "dim_date":   {"file": "data/dim_date.csv", "structure": [...]}       # its columns as given, any others inferred

Paths are relative to DOC.json. The CSV is read as the app reads one (values trimmed, lines of only spaces skipped)
and stored as columns (a CSV line per column, its name then its values), gzip+base64, with its structure: column
names in header order, and types as given or guessed as the app guesses them (dashier_data.infer). A column the
structure names but the CSV lacks is left out. Sources that already have a payload are kept as they are. Every "<" in the JSON is written as \\u003c, and nothing else in the
template is touched. The template itself is never modified.
"""
import csv, itertools, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from get_dashier import fetch
from dashier_data import ISO_DATE, infer, pack


def main(template, doc_path, out):
    html = fetch(template)
    m = re.search(r'(<script type="application/dashier\+json" id="dashier-doc">)(.*?)(</script>)', html, re.S)
    if not m:
        sys.exit(f'{template}: no dashier-doc block (is this a Dashier file?)')
    doc = json.load(open(doc_path, encoding='utf-8'))
    base = os.path.dirname(os.path.abspath(doc_path))
    for name, src in (doc.get('sources') or {}).items():
        if 'file' not in src:
            continue
        # as the app reads a CSV: a line of only spaces is no record, and values are trimmed
        rows = [[v.strip() for v in r] for r in csv.reader(open(os.path.join(base, src.pop('file')), encoding='utf-8-sig', newline='')) if r and (len(r) > 1 or r[0].strip())]
        header = rows[0]
        if len(set(header)) != len(header):
            sys.exit(f'{name}: duplicate column names {header}')
        given = {c['name']: c for c in src.get('structure') or []}
        # stored as columns, a CSV line each (its name, then its values): smaller and faster to open
        columns = list(itertools.zip_longest(*(r[:len(header)] for r in rows), fillvalue=''))
        src['structure'] = [given.get(h) or {'name': h, 'type': infer(c[1:])} for h, c in zip(header, columns)]
        src['payload'] = pack(columns)
        print(f'{name}: {len(rows) - 1} rows, ' + ', '.join(f"{c['name']}:{c['type']}" for c in src['structure']))
        for c, col in zip(src['structure'], columns):
            if c['type'] == 'datetime' and any(v and not ISO_DATE.match(v) for v in col[1:]):
                print(f"  {name}.{c['name']}: dates that aren't ISO (yyyy-mm-dd) are read, but write them ISO: 03/04/2024 is March or April only by the column's other dates")
    body = json.dumps(doc, indent=1, ensure_ascii=False).replace('<', '\\u003c')
    html = html[:m.start(2)] + '\n' + body + '\n  ' + html[m.end(2):]
    open(out, 'w', encoding='utf-8').write(html)
    print(f'wrote {out} ({len(html.encode()):,} bytes)')


if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) == 2:
        main(None, *args)
    elif len(args) == 3:
        main(*args)
    else:
        sys.exit(__doc__)
