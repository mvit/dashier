#!/usr/bin/env python3
"""
Reads a Dashier report back: its tables as pandas DataFrames, typed as their structure says, and its model.

    python3 read_report.py report.html [OUT_DIR] [--password PW]

Writes OUT_DIR (default: the report's name, next to it), a project the skill works from:
  data/<table>.csv    each table's columns as stored (the update templates)
  recovered.json      the document, each source pointing at its CSV: build_report.py recovered.json out.html
                      rebuilds the same report, and build_doc.py can start from it
and prints the model: tables (rows, columns and types), relationships, measures and pages. An encrypted report needs
its password (and the `cryptography` package).

In Python (pandas needed only here):
    from read_report import read_report
    doc, tables = read_report('report.html')        # tables: {name: DataFrame}
"""
import base64, csv, gzip, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashier_data import NUMERIC, boolean, day_first, number, to_iso, unpack


def read_doc(path):
    """The document of a Dashier file."""
    html = open(path, encoding='utf-8').read()
    m = re.search(r'<script type="application/dashier\+json" id="dashier-doc">(.*?)</script>', html, re.S)
    if not m:
        sys.exit(f'{path}: no dashier-doc block (is this a Dashier file?)')
    return json.loads(m.group(1))


def payloads(doc, password=None):
    """Each table's payload (gzip+base64), decrypting the file's data when it is encrypted."""
    sealed = doc.get('encryption')
    if not sealed:
        return {t: s['payload'] for t, s in doc['sources'].items()}
    if password is None:
        sys.exit('The data is encrypted: pass --password (read_report(path, password=...) in Python).')
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError:
        sys.exit('An encrypted report needs the cryptography package: pip install cryptography')
    if sealed.get('version') != 1 or sealed.get('kdf') != 'PBKDF2-SHA256':
        sys.exit('Unknown encryption.')
    # as crypt.ts: AES-256-GCM under PBKDF2-SHA256 of the password; the plaintext is a JSON line of [table, bytes]
    # pairs, then those tables' gzip bytes back to back
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(sealed['salt']), sealed['iterations'], 32)
    try:
        plain = AESGCM(key).decrypt(base64.b64decode(sealed['iv']), base64.b64decode(sealed['ciphertext']), None)
    except Exception:
        sys.exit('Wrong password (or a changed file).')
    nl = plain.index(b'\n')
    out, at = {}, nl + 1
    for t, n in json.loads(plain[:nl]):
        out[t] = base64.b64encode(plain[at:at + n]).decode()
        at += n
    return out


def columns(doc, password=None):
    """Each table's stored columns: {table: [(name, values as text)]}."""
    return {t: unpack(p) for t, p in payloads(doc, password).items()}


def typed(values, type):
    """A column's values as the app reads them: numbers, true/false, ISO dates (None for a blank), else text."""
    if type in NUMERIC:
        return [number(v) for v in values]
    if type == 'boolean':
        return [boolean(v) for v in values]
    if type == 'datetime':
        first = day_first(values)
        return [to_iso(v, first) for v in values]
    return [v if v != '' else None for v in values]


def read_report(path, password=None):
    """The document, and its tables as DataFrames: int columns nullable Int64, floats, booleans, datetimes, strings."""
    import pandas as pd
    doc = read_doc(path)
    tables = {}
    for t, cols in columns(doc, password).items():
        types = {c['name']: c.get('type', 'string') for c in doc['sources'][t].get('structure') or []}
        df = pd.DataFrame({n: typed(v, types.get(n, 'string')) for n, v in cols})
        for n in df.columns:
            ty = types.get(n, 'string')
            df[n] = (df[n].astype('Int64') if ty in ('int', 'uint') and df[n].dropna().map(float.is_integer).all()
                     else df[n].astype('float64') if ty in NUMERIC
                     else df[n].astype('boolean') if ty == 'boolean'
                     else pd.to_datetime(df[n]) if ty == 'datetime'
                     else df[n].astype('string'))
        tables[t] = df
    return doc, tables


def summary(doc, cols):
    """The model in a few lines: what a reader (or a model) needs to work with the report."""
    out = [f'"{doc.get("title", "")}": {len(cols)} tables, {len(doc.get("relationships") or [])} relationships, '
           f'{len(doc.get("measures") or [])} measures, {len(doc.get("pages") or [])} pages']
    for t, cs in cols.items():
        types = {c['name']: c.get('type', 'string') for c in doc['sources'][t].get('structure') or []}
        rows = len(cs[0][1]) if cs else 0
        out.append(f'  {t} ({rows:,} rows): ' + ', '.join(f'{n}:{types.get(n, "?")}' for n, _ in cs))
    for r in doc.get('relationships') or []:
        out.append(f'  {r["from"]["table"]}.{r["from"]["field"]} -> {r["to"]["table"]}.{r["to"]["field"]}'
                   + (f' ({r["crossFilter"]})' if r.get('crossFilter') else ''))
    def operand(o, table):
        o = o or {}
        return (f'[{o["measure"]}]' + (f' of {o["table"]}' if o.get('table') and o['table'] != table else '') if 'measure' in o
                else f'sum({o["field"]})' if 'field' in o else str(o.get('value', '?')))
    for m in doc.get('measures') or []:
        wh = m.get('where') or []
        conds = ' and '.join(f'{w.get("table", m["table"])}.{w["field"]} in {w.get("values")}' for w in (wh if isinstance(wh, list) else [wh]))
        what = (f'{operand(m.get("a"), m["table"])} {m["op"]} {operand(m.get("b"), m["table"])}' if m.get('op')
                else f'{m.get("aggregate", "sum")}({m.get("field", "")})' + (f' where {conds}' if conds else ''))
        fmt = '|'.join(x for x in (m.get('format'), m.get('units')) if x)
        out.append(f'  [{m["name"]}] on {m["table"]} = {what}' + (f'  ({fmt})' if fmt else ''))
    for p in doc.get('pages') or []:
        kinds = [e.get('chartType') or e.get('type') for e in p.get('elements') or []]
        out.append(f'  page "{p.get("title")}": ' + ', '.join(f'{n} {k}' for k, n in sorted({k: kinds.count(k) for k in kinds}.items())))
    return '\n'.join(out)


def main(path, out=None, password=None):
    sys.stdout.reconfigure(encoding='utf-8')
    doc = read_doc(path)
    cols = columns(doc, password)
    out = out or os.path.splitext(os.path.splitext(path)[0])[0]
    os.makedirs(os.path.join(out, 'data'), exist_ok=True)
    for t, cs in cols.items():
        with open(os.path.join(out, 'data', f'{t}.csv'), 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow([n for n, _ in cs])
            w.writerows(zip(*(v for _, v in cs)))
        doc['sources'][t] = {'file': f'data/{t}.csv', 'structure': doc['sources'][t].get('structure') or []}
    doc.pop('encryption', None)
    with open(os.path.join(out, 'recovered.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    print(summary(doc, cols))
    print(f'wrote {out}/data/ ({len(cols)} CSVs) and {out}/recovered.json')


if __name__ == '__main__':
    args = sys.argv[1:]
    password = None
    if '--password' in args:
        i = args.index('--password')
        password = args[i + 1] if i + 1 < len(args) else sys.exit('--password needs a value')
        del args[i:i + 2]
    if not 1 <= len(args) <= 2 or args[0] in ('-h', '--help'):
        sys.exit(__doc__)
    main(*args, password=password)
