#!/usr/bin/env python3
"""
Checks a Dashier report against the dashier-reports skill: the data model, every field reference, filter and
slicer values against the data, text box templates, and the grid. Usage: python3 validate_dashier.py report.html   (exit 0 = no FAIL)

FAIL lines are defects (a visual that will be empty or wrong, a model that inflates or drops rows).
WARN lines are judgment calls: fix them unless the report has a stated reason not to.
"""
import base64, csv, gzip, io, json, re, sys
from collections import Counter

html = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'<script type="application/dashier\+json" id="dashier-doc">(.*?)</script>', html, re.S)
if not m:
    sys.exit('FAIL: no dashier-doc block')
raw = m.group(1)
fails, warns = [], []
F, W = fails.append, warns.append
if '<' in raw:
    F('a raw "<" inside the JSON: write it as \\u003c')
doc = json.loads(raw)
src = doc.get('sources') or {}
rels = doc.get('relationships') or []
measures = doc.get('measures') or []
pages = doc.get('pages') or []
AGG = {'sum', 'avg', 'count', 'distinct', 'min', 'max', 'median', 'mode', 'first', 'last', 'latest', 'stdev', 'var'}
FMT = {'number', 'integer', 'currency', 'percent'}
UNITS = {'auto', 'thousands', 'millions', 'billions'}
CHARTS = {'bar', 'hbar', 'line', 'area', 'combo', 'scatter', 'pie', 'donut', 'radar', 'treemap', 'sankey', 'gauge'}
NUM = re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$')
ISO = re.compile(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$')

# --- tables -------------------------------------------------------------------------------------------------
cols, data = {}, {}
for t, s in src.items():
    if '.' in t or '[' in t:
        F(f'table "{t}": no dots or brackets in table names ("table.field" and "[measure]" refs would be ambiguous)')
    names = [c['name'] for c in s.get('structure') or []]
    cols[t] = set(names)
    types = {c['name']: c.get('type') for c in s.get('structure') or []}
    for n in names:
        if '.' in n or '[' in n or ']' in n:
            F(f'{t}.{n}: no dots or brackets in column names')
    try:
        text = gzip.decompress(base64.b64decode(s['payload'])).decode('utf-8-sig')
    except Exception as e:
        F(f'{t}: payload is not gzip+base64 ({e})')
        continue
    if s.get('format') == 'json':
        rows = json.loads(text)
        rows = rows if isinstance(rows, list) else []
    else:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        header = reader.fieldnames or []
        if header != names:
            (F if set(header) != set(names) else W)(f'{t}: structure {names} does not match the CSV header {header}')
    data[t] = rows
    for n, ty in types.items():
        vals = [str(r.get(n) if r.get(n) is not None else '').strip() for r in rows]
        bad = [v for v in vals if v and ((ty in ('int', 'uint', 'float') and not NUM.match(v)) or (ty == 'boolean' and v.lower() not in ('true', 'false')))]
        if bad:
            F(f'{t}.{n} is {ty} but holds {bad[:3]}: these load as blank (plain numbers only: no $, %, or thousands commas)')
        if ty == 'datetime' and any(v and not ISO.match(v) for v in vals):
            W(f'{t}.{n}: write dates as ISO yyyy-mm-dd')
        # years, ids and codes are labels: text keeps them out of sums and range slicers
        if ty == 'string' and any(vals) and all(NUM.match(v) for v in vals if v) and not re.search(r'year|id$|key|code|zip|postal|phone|fy', n, re.I) and not any(re.match(r'^0\d', v) for v in vals):
            W(f'{t}.{n} holds only numbers but is typed string')
for t, s_ in src.items():
    for c in s_.get('structure') or []:
        if c.get('sortBy') and c['sortBy'] not in cols[t]:
            F(f'{t}.{c["name"]}: sortBy names {c["sortBy"]}, which {t} does not have')
seen = {}
for t, c in cols.items():
    k = frozenset(c)
    if k in seen:
        rows_of = lambda x: {tuple(sorted((n, str(v)) for n, v in r.items())) for r in data.get(x, [])}
        if rows_of(seen[k]) & rows_of(t):
            F(f'{seen[k]} and {t} hold the same rows: the same data twice')
        else:
            W(f'{seen[k]} and {t} have the same shape: one fact with a column that tells them apart (and a dimension for it) is simpler to slice')
    seen[k] = t
for t, c in cols.items():
    for n in c:
        if re.search(r'margin|ratio|_pct$|pct_|percent|growth|(^|_)share($|_)|per_|yoy|_avg$|average', n, re.I):
            W(f'{t}.{n} looks derived (a ratio, share, average or growth): make it a measure unless it is a source fact')

facts = [t for t in src if t.startswith('fact')]
dims = [t for t in src if t.startswith('dim')]
if len(src) > 1 and (not facts or not dims):
    W('name tables fact_* (events, numbers) and dim_* (things that filter and group them)')

def text_of(v, numeric):
    """A cell or filter value as the app compares it: numbers by value (1.50 is "1.5"), text as written."""
    s = str(v if v is not None else '').strip()
    if numeric and NUM.match(s):
        f = float(s)
        return str(int(f)) if f.is_integer() else repr(f)
    return s


def check_values(where, t, field, values):
    """Values that match no row: a filter, slicer pick or measure where on them shows nothing."""
    if t not in data or not values:
        return
    numeric = next((c.get('type') for c in src[t].get('structure') or [] if c['name'] == field), '') in ('int', 'uint', 'float')
    have = {text_of(r.get(field), numeric) for r in data[t]}
    miss = [v for v in values if text_of(v, numeric) not in have]
    if miss:
        (W if len(miss) < len(values) else F)(f'{where}: {t}.{field} has no {miss[:5]}' + ('' if len(miss) < len(values) else ': it shows nothing'))


# --- relationships ------------------------------------------------------------------------------------------
if len(src) > 1 and not rels:
    F('several tables but no relationships')
linked, pairs = set(), Counter()
for i, r in enumerate(rels):
    a, b = r.get('from') or {}, r.get('to') or {}
    ok = True
    for e in (a, b):
        if e.get('table') not in src:
            F(f'relationship {i}: unknown table {e.get("table")}')
            ok = False
        elif e.get('field') not in cols[e['table']]:
            F(f'relationship {i}: {e["table"]} has no column {e.get("field")}')
            ok = False
    if not ok:
        continue
    ta, tb = a['table'], b['table']
    linked |= {ta, tb}
    pairs[frozenset((ta, tb))] += 1
    if ta in dims and tb in facts:
        F(f'relationship {ta}->{tb}: put the fact table as "from" and the dimension as "to"; a dimension attribute only filters the "from" side')
    # a dimension a fact also links to directly is that fact's grain (a shrunken dimension: cost reported by kind), not a snowflake
    if ta in dims and tb in dims and not ta.startswith('bridge') and not any((r2.get('to') or {}).get('table') == tb and (r2.get('from') or {}).get('table') in facts for r2 in rels):
        W(f'relationship {ta}->{tb} chains two dimensions (a snowflake): it works, but one flattened dimension is simpler to slice')
    if r.get('cardinality') not in (None, 'many-to-one', 'one-to-one', 'many-to-many'):
        F(f'relationship {ta}->{tb}: cardinality is many-to-one, one-to-one or many-to-many')
    if tb in data and ta in data and tb not in facts and r.get('cardinality') != 'many-to-many':
        keys = [str(row.get(b['field'], '')).strip() for row in data[tb]]
        dup = [k for k, n in Counter(keys).items() if n > 1]
        if dup:
            W(f'{tb}.{b["field"]} is the "one" side but repeats {dup[:3]}: rows match the first copy only; fix the data')
        known = set(keys)
        miss = sorted({str(row.get(a['field'], '')).strip() for row in data[ta]} - known - {''})
        if miss:
            W(f'{ta}.{a["field"]} values missing from {tb}.{b["field"]}: {miss[:5]} (they show as (Blank))')
for p, n in pairs.items():
    if n > 1:
        W(f'{" and ".join(sorted(p))} are linked {n} times: a visual joins a table once, along the nearest path, so make one dimension per role (dim_order_date, dim_ship_date)')
if len(src) > 1:
    for t in src:
        if t not in linked:
            F(f'table {t} is in no relationship')
for f in facts:
    if not any(r.get('from', {}).get('table') == f and r.get('to', {}).get('table') in dims for r in rels):
        F(f'fact {f} looks up no dimension')

# --- row order: legends and axes list periods as the fact rows first mention them -------------------------------
YEAR = re.compile(r'(?<!\d)(?:19|20)\d\d(?!\d)')
for r in rels:
    a, b = r.get('from') or {}, r.get('to') or {}
    if a.get('table') not in data or b.get('table') not in data:
        continue
    lookup = {str(row.get(b.get('field'), '')).strip(): row for row in data[b['table']]}
    years = []  # each year in the order the fact first mentions it, from the key or its dimension row
    for row in data[a['table']]:
        key = str(row.get(a.get('field'), '')).strip()
        m = YEAR.search(key) or next((YEAR.search(str(v)) for v in (lookup.get(key) or {}).values() if YEAR.search(str(v))), None)
        if m and m.group() not in years:
            years.append(m.group())
    sorted_dim = any(c.get('sortBy') for c in src[b['table']].get('structure') or [])
    if len(years) > 1 and years == sorted(years, reverse=True) and not sorted_dim:
        W(f'{a["table"]} lists {years[0]} before {years[-1]}: charts show periods in that order (newest first, so before/after reads backwards); sort the rows oldest first, or give the period label a sortBy column')

# --- measures -----------------------------------------------------------------------------------------------
mnames = {}
for mm in measures:
    t, n = mm.get('table'), mm.get('name', '')
    if t not in src:
        F(f'measure "{n}": unknown table {t}')
        continue
    if re.search(r'[\[\]]', n) or n in cols[t] or any(k[1] == n for k in mnames):
        F(f'measure "{n}": a name must be unique in the report, not a column name of its table, and without [ ]')
    mnames[(t, n)] = mm
for mm in measures:
    t, n = mm.get('table'), mm.get('name')
    if t not in src:
        continue
    if mm.get('units') and mm['units'] not in UNITS:
        F(f'measure "{n}": units is one of {sorted(UNITS)}')
    if mm.get('op'):
        if mm['op'] not in ('+', '-', '*', '/', 'pct-diff'):
            F(f'measure "{n}": op must be + - * / or pct-diff')
        for side in ('a', 'b'):
            o = mm.get(side) or {}
            ot = o.get('table', t)
            if 'measure' in o and (ot, o['measure']) not in mnames:
                F(f'measure "{n}": operand {side} names measure "{o["measure"]}", which {ot} does not have')
            elif 'field' in o and o['field'] not in cols[t]:
                F(f'measure "{n}": operand {side} field {o["field"]} is not a column of {t}')
            elif not any(k in o for k in ('measure', 'field', 'value')):
                F(f'measure "{n}": operand {side} needs measure, field or value')
    else:
        if mm.get('aggregate', 'sum') not in AGG:
            F(f'measure "{n}": unknown aggregate {mm.get("aggregate")}')
        if mm.get('aggregate') != 'count' and mm.get('field') not in cols[t]:
            F(f'measure "{n}": field {mm.get("field")} is not a column of {t}')
        ws = mm.get('where') or []
        for w in ws if isinstance(ws, list) else [ws]:
            wt = w.get('table', t)
            if wt not in src or w.get('field') not in cols[wt]:
                F(f'measure "{n}": where {wt}.{w.get("field")} does not exist (a where on another table names it in "table")')
            elif not isinstance(w.get('values'), list) or not all(isinstance(v, str) for v in w['values']):
                F(f'measure "{n}": where.values must be a list of strings')
            else:
                check_values(f'measure "{n}" where', wt, w['field'], w['values'])
if any(cols[f] for f in facts) and not measures:
    W('no measures: ratios, shares and comparisons belong in measures')

# --- elements -----------------------------------------------------------------------------------------------
# tables connected to each table, directly or through others
related = {t: {t} for t in src}
for _ in src:
    for r in rels:
        a, b = (r.get('from') or {}).get('table'), (r.get('to') or {}).get('table')
        if a in related and b in related and related[a] != related[b]:
            related[a] |= related[b]
            for x in related[a]:
                related[x] = related[a]


def check_ref(where, home, ref):
    """A field reference as a visual on `home` reads it: its own column, "[measure]" or "table.field"."""
    if not ref:
        return
    if not home:
        F(f'{where}: uses {ref} but has no sourceId')
        return
    if home not in src:
        F(f'{where}: sourceId {home} is not a table')
        return
    if ref.startswith('[') and ref.endswith(']'):
        owners = [t for (t, n) in mnames if n == ref[1:-1]]
        if not owners:
            F(f'{where}: there is no measure {ref}')
        elif not any(t in related[home] for t in owners):
            F(f'{where}: {ref} is a measure of {owners[0]}, which is not connected to {home}')
        return
    if ref in cols[home]:
        return
    t = next((t for t in sorted(src, key=len, reverse=True) if ref.startswith(t + '.')), None)
    if not t:
        F(f'{where}: {home} has no column {ref}')
    elif t not in related[home]:
        F(f'{where}: {t} is not connected to {home}')
    elif ref[len(t) + 1:] not in cols[t]:
        F(f'{where}: {t} has no column {ref[len(t) + 1:]}')


def distinct(home, ref):
    """The distinct values of a column a visual on `home` reads (its own or "table.field"); none for measures."""
    t, n = (home, ref) if home in cols and ref in cols[home] else next(((t, ref[len(t) + 1:]) for t in sorted(src, key=len, reverse=True) if ref.startswith(t + '.')), (None, None))
    return {str(r.get(n)) for r in data.get(t, [])} if t else set()


def check_value(where, d, axis=True):
    """A value's options: display units, show as (a running total along an axis only) and its comparison."""
    d = d or {}
    if d.get('units') and d['units'] not in UNITS:
        F(f'{where}: units is one of {sorted(UNITS)}')
    if d.get('showAs') and d['showAs'] not in (('percent-of-total', 'running-total') if axis else ('percent-of-total',)):
        F(f'{where}: showAs {d["showAs"]}')
    c = d.get('compare') or {}
    if c.get('shift') and c['shift'] not in ('period', 'year'):
        F(f'{where}: compare.shift is "period" or "year"')
    if c.get('show') and c['show'] not in ('change', 'difference', 'value'):
        F(f'{where}: compare.show is "change", "difference" or "value"')
    check_filters(f'{where} compare', c.get('filters'))


def check_filters(where, fs):
    for f in fs or []:
        t = f.get('table')
        if not t:
            W(f'{where}: filter on {f.get("field")} has no "table": add it so it filters the right table')
        elif t not in src or f.get('field') not in cols[t]:
            F(f'{where}: filter {t}.{f.get("field")} does not exist')
        elif not f.get('datePart'):
            check_values(where, t, f['field'], f.get('values'))


TEMPLATE_FILTERS = {'upper', 'lower', 'title', 'truncate', 'round', 'format', 'date', 'default', 'join', 'first', 'last', 'size', 'length', 'sort', 'reverse'}


def template_errors(c):
    """What the text box would report instead of rendering: {% %} tags, unknown filters, unclosed or unopened sections."""
    if '{%' in c:
        yield '{% %} tags are not supported: use {{#name}}…{{/name}}'
    open_ = []
    for m in re.finditer(r'\{\{(?:\{([\s\S]*?)\}|\s*([#^/!&]?)([\s\S]*?))\}\}', c):
        kind, expr = m.group(2) or '', m.group(1) if m.group(1) is not None else m.group(3)
        if kind == '!':
            continue
        name, *filters = [x.strip() for x in re.split(r'\|(?=(?:[^"\']*["\'][^"\']*["\'])*[^"\']*$)', expr)]
        for f in filters:
            if f.split(':')[0].strip() not in TEMPLATE_FILTERS:
                yield f'unknown filter "{f.split(":")[0].strip()}"'
        if kind == '/':
            if open_ and open_[-1] == name:
                open_.pop()
            else:
                yield f'{{{{/{name}}}}} closes a section that is not open'
        elif kind in '#^' and kind:
            open_.append(name)
    for n in open_:
        yield f'section {{{{#{n}}}}} is never closed'


def typed_numbers(text):
    t = re.sub(r'\{\{.*?\}\}', '', text, flags=re.S)
    t = re.sub(r'\b(?:19|20)\d\d\b|\b[1-4]Q\d\d\b|\bQ[1-4]\b|\bH[12]\b|\bFY\d+\b|^\s*\d+\.\s|\b\d{1,2}:\d\d\b', '', t, flags=re.M)
    return re.search(r'[$€£¥]\s?\d|\d[\d,.]*\s?(%|[KMBT]\b|bn\b|bps\b)|\b\d[\d,]*\.\d+\b|\b\d{1,3}(,\d{3})+\b|\b\d{3,}\b', t)


check_filters('report filters', doc.get('filters'))
ids = Counter()
rows_per_page = max(1, round((doc.get('canvas') or {}).get('height', 810) / 810 * 8))
used_dims = False
for p in pages:
    pt = p.get('title', p.get('id'))
    els = p.get('elements') or []
    ids[p.get('id')] += 1
    if not els:
        F(f'page "{pt}" is empty')
    check_filters(f'page "{pt}"', p.get('filters'))
    cells = {}
    for e in els:
        eid, ty, home = e.get('id'), e.get('type'), e.get('sourceId')
        where = f'{pt} / {eid}'
        ids[eid] += 1
        x, y, w, h = (e.get(k, -1) for k in ('x', 'y', 'w', 'h'))
        if not (isinstance(x, int) and isinstance(y, int) and isinstance(w, int) and isinstance(h, int)) or x < 0 or y < 0 or w < 1 or h < 1 or x + w > 12:
            F(f'{where}: grid position x={x} y={y} w={w} h={h} (12 columns: x + w <= 12)')
        else:
            for cx in range(x, x + w):
                for cy in range(y, y + h):
                    if (cx, cy) in cells:
                        F(f'{where} overlaps {cells[(cx, cy)]}')
                        break
                    cells[(cx, cy)] = eid
                else:
                    continue
                break
            if y + h > rows_per_page:
                W(f'{where} runs past the page (rows 0-{rows_per_page - 1} fit; the page grows and viewers must pan)')
        check_filters(where, e.get('filters'))
        g = e.get('grid') or {}
        if g.get('density') not in (None, 'compact', 'roomy') or g.get('lines') not in (None, 'both', 'none'):
            F(f'{where}: grid.density is "compact" or "roomy", grid.lines "both" or "none"')
        refs = []
        if ty == 'chart':
            if e.get('chartType') not in CHARTS:
                F(f'{where}: chartType {e.get("chartType")}')
            refs = list((e.get('mapping') or {}).values())
            o = e.get('options') or {}
            if o.get('format') and o['format'] not in FMT:
                F(f'{where}: options.format {o["format"]}')
            x = (e.get('mapping') or {}).get('x')
            if e.get('chartType') in ('pie', 'donut') and not o.get('topN') and x and len(distinct(e.get('sourceId'), x)) > 6:
                W(f'{where}: a pie reads best with 6 slices or fewer; set options.topN')
            for key, allowed in (('legendPosition', ('bottom', 'top', 'right', 'left')), ('units', tuple(UNITS)), ('stack', ('stacked', 'percent'))):
                if o.get(key) is not None and o[key] not in allowed:
                    F(f'{where}: options.{key} is one of {list(allowed)}')
            for r in o.get('refLines') or []:
                if r.get('stat') not in (None, 'average', 'median', 'min', 'max') or (r.get('stat') is None and not isinstance(r.get('value'), (int, float))):
                    F(f'{where}: a reference line has a numeric value or a stat (average, median, min, max)')
            for k in ('summary', 'lineSummary'):
                check_value(f'{where} {k}', e.get(k))
                if (e.get(k) or {}).get('compare') and e.get('chartType') not in ('bar', 'hbar', 'line', 'area', 'combo'):
                    W(f'{where}: {k}.compare works on bar, hbar, line, area and combo charts')
        elif ty == 'card':
            a = e.get('aggregation') or {}
            refs = [a.get('field')]
            if a.get('method', 'sum') not in AGG:
                F(f'{where}: aggregation.method {a.get("method")}')
            cmp = e.get('compare') or {}
            check_value(where, e, False)
            if cmp.get('field'):
                refs.append(cmp['field'])
            if re.search(r'\d', str(e.get('staticValue', ''))):
                W(f'{where}: a typed staticValue ({e["staticValue"]}): make it a measure so it follows the data')
            if typed_numbers((e.get('subtitle') or '') + ' ' + (e.get('title') or '')):
                W(f'{where}: a figure in the title or subtitle: if it comes from the data, it goes stale (bind it in a text box)')
        elif ty == 'table':
            refs = [c.get('field') for c in e.get('columns') or []]
            for c in e.get('columns') or []:
                if 'label' not in c:
                    F(f'{where}: column {c.get("field")} needs a label')
                check_value(f'{where} column {c.get("field")}', c, False)
        elif ty == 'matrix':
            refs = [f.get('field') for k in ('rows', 'columns', 'values') for f in e.get(k) or []]
            for v in e.get('values') or []:
                check_value(f'{where} value {v.get("field")}', v)
            if e.get('totals') not in (None, True, False, 'row', 'column'):
                F(f'{where}: totals is false, "row" or "column"')
        elif ty == 'slicer':
            f = e.get('field')
            if f and home in cols and f not in cols[home]:
                F(f'{where}: a slicer reads its own table: {home} has no column {f}')
            elif f and home in cols and not e.get('datePart'):
                check_values(where, home, f, (e.get('selection') or {}).get('values'))
            if home in facts and f and any(f in cols[d] for d in dims if d in related.get(home, ())):
                W(f'{where}: slice on the dimension table, not the fact')
        elif ty == 'markdown':
            c = e.get('content', '')
            b = e.get('bindings') or {}
            if typed_numbers(c):
                W(f'{where}: typed figures in the text: bind any that come from the data or change with filters')
            for err in template_errors(c):
                F(f'{where}: {err}')
            for v, bd in b.items():
                t = bd.get('table')
                if t not in src:
                    F(f'{where}: binding {v} names unknown table {t}')
                    continue
                fld = bd.get('field')
                if fld and fld.startswith('['):
                    if not any(n == fld[1:-1] and mt in related[t] for (mt, n) in mnames):
                        F(f'{where}: binding {v}: {fld} is not a measure of {t} or a table connected to it')
                elif fld and fld not in cols[t]:
                    F(f'{where}: binding {v}: {t} has no column {fld}')
                check_value(f'{where}: binding {v}', bd, False)
                if bd.get('aggregate') and bd['aggregate'] not in AGG:
                    F(f'{where}: binding {v}: aggregate {bd["aggregate"]}')
                if bd.get('format') and bd['format'] not in FMT:
                    F(f'{where}: binding {v}: format {bd["format"]}')
                # what the binding writes: its format and units, else its measure's
                mm = next((m for (mt, n), m in mnames.items() if fld and n == fld[1:-1]), {})
                if not bd.get('compare') and (bd.get('format') or mm.get('format')) == 'currency' and re.search(r'[$€£]\s*\{\{\s*' + re.escape(v) + r'\b', c):
                    W(f'{where}: a $ typed before currency-formatted {v} shows twice')
                if not bd.get('compare') and (bd.get('units') or mm.get('units')) and re.search(r'\{\{\s*' + re.escape(v) + r'\s*\}\}\s*[KMB]\b', c):
                    W(f'{where}: {v} already shows its display units (K, M, B); a typed one shows twice')
            outer = re.sub(r'(\{\{[#^]\s*[\w.]+[^}]*\}\}).*?\{\{/\s*[\w.]+\s*\}\}', r'\1', c, flags=re.S)
            for v in re.findall(r'\{\{\{?[#^&]?\s*([A-Za-z_]\w*)', outer):
                if v not in b and v not in src and v not in ('title', 'page', 'rows'):
                    F(f'{where}: {{{{ {v} }}}} has no binding')
        else:
            F(f'{where}: unknown type {ty}')
        for r in refs:
            check_ref(where, home, r)
            used_dims |= bool(r) and any(r.startswith(d + '.') for d in dims)
for i, n in ids.items():
    if n > 1:
        F(f'id "{i}" is used {n} times: ids must be unique')

# --- not the tutorial -------------------------------------------------------------------------------------------
TUTORIAL = {'page_welcome', 'page_build', 'page_filter', 'page_measures', 'page_data', 'welcome_text', 'build_text',
            'filter_text', 'measures_text', 'measures_highlights', 'data_text', 'data_table', 'build_yours'}
left = sorted(TUTORIAL & set(ids))
if left or doc.get('title') == 'Dashier tutorial' or {'sales', 'regions'} <= set(src):
    F(f'tutorial content left in ({", ".join(left) or "its title or tables"}): build the document from scratch')
for p in pages:
    for e in p.get('elements') or []:
        if e.get('type') == 'markdown' and e.get('h', 0) >= 5 and e.get('w', 12) <= 4:
            W(f'page "{p.get("title")}": {e.get("id")} is a tall text column like the tutorial\'s; fine if deliberate')
if dims and facts and not used_dims:
    W('no visual uses a dimension attribute ("dim_x.field"): group and label by the dimensions')
if '—' in raw or '–' in raw:
    W('an em or en dash in the text')

print(f'tables={len(src)} (facts {len(facts)}, dims {len(dims)}) relationships={len(rels)} measures={len(measures)} pages={len(pages)}')
for w in warns:
    print('WARN:', w)
for f in fails:
    print('FAIL:', f)
print('RESULT:', 'FAIL' if fails else 'PASS')
sys.exit(1 if fails else 0)
