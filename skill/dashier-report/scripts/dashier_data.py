"""
What Dashier does with a table's values, for build_report.py and validate_dashier.py: how a payload is stored (a CSV
line per column, its name then its values, gzip+base64), how a column's type is guessed, and how the app reads,
compares and keys values. Each rule follows the app's own (src/runtime: hydrate.ts, dates.ts, data.ts); change them
together.
"""
import base64, calendar, csv, gzip, io, re
from decimal import Decimal

NUM = re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$')
NUMERIC = ('int', 'uint', 'float')
# how the skill asks dates to be written (the app reads others too: see to_iso)
ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$')
_LEADING_ZERO = re.compile(r'^[-+]?0\d')
_ISO = re.compile(r'^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$')
_SLASHED = re.compile(r'^(\d{1,2})([/.])(\d{1,2})\2(\d{4})$')
# a month name by its first three letters, as the browser reads them ("Sept", "January")
_MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_abbr) if m}
_NAMED = re.compile(r'^(?:([A-Za-z]+)\.?\s+(\d{1,2}),?|(\d{1,2})\s+([A-Za-z]+)\.?,?)\s+(\d{4})$')


def js_num(f):
    """A number as JavaScript's String() writes it: the shortest digits that read back (2, not 2.0;
    123456789012345680000), in exponent form from 1e21 and below 1e-6 (1e-7)."""
    if f != f or f in (float('inf'), float('-inf')):
        return 'NaN' if f != f else ('Infinity' if f > 0 else '-Infinity')
    if not f:
        return '0'
    if 1e-6 <= abs(f) < 1e21:
        s = format(Decimal(repr(f)), 'f')
        return s.rstrip('0').rstrip('.') if '.' in s else s
    return re.sub(r'e([+-])0*(\d)', r'e\1\2', repr(f))


def js_str(v):
    """A JSON value as String() makes it (filter and slicer values are compared this way)."""
    return 'true' if v is True else 'false' if v is False else 'null' if v is None else js_num(float(v)) if isinstance(v, (int, float)) else str(v)


def number(s):
    """A cell as a number column reads it, or None: blank, or not wholly a number ("1,234", "12%", "0x1A")."""
    s = str(s).strip()
    return float(s) if NUM.match(s) else None


def boolean(s):
    """A cell as a true/false column reads it: true, 1 and yes (any case) are true, other text false, blank None."""
    s = str(s)
    return None if not s else s.lower() in ('true', '1', 'yes')


def day_first(values):
    """True when a column's slashed dates are day first: one of them starts above 12."""
    return any(int(m[1]) > 12 for v in values if (m := re.match(r'^\s*(\d\d?)/\d\d?/\d{4}\s*$', str(v))))


_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _valid(y, m, d):
    return 1 <= m <= 12 and 1 <= d <= (29 if m == 2 and y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else _DAYS[m - 1])


def to_iso(v, first=False):
    """A date-like value as the app stores it (2024-01-03, 2024-01-03T10:00), or None when it isn't one."""
    s = str(v if v is not None else '').strip()
    if m := _ISO.match(s):
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
        if not _valid(y, mo, d):
            return None
        return f'{y:04}-{mo:02}-{d:02}' + (f'T{int(m[4]):02}:{m[5]}' if m[4] and (int(m[4]) or int(m[5])) else '')
    if m := _SLASHED.match(s):
        a, b, y = int(m[1]), int(m[3]), int(m[4])
        mo, d = (b, a) if m[2] == '.' or a > 12 or first else (a, b)
        return f'{y:04}-{mo:02}-{d:02}' if _valid(y, mo, d) else None
    # "Jan 3, 2024", "3 January 2024": the app hands any text with a month name and a 4-digit year to the browser's
    # date parser, which reads more forms than these two (they are the ones it reads the same in every browser)
    if m := _NAMED.match(s):
        mo, d = (_MONTHS.get(m[1][:3].lower()), int(m[2])) if m[1] else (_MONTHS.get(m[4][:3].lower()), int(m[3]))
        return f'{int(m[5]):04}-{mo:02}-{d:02}' if mo and _valid(int(m[5]), mo, d) else None
    return None


def cell(v, type, first=False):
    """A cell as the app holds it, written as String() writes it ('' for a blank): what filters and slicers compare."""
    if type in NUMERIC:
        f = number(v)
        return '' if f is None else js_num(f)
    if type == 'boolean':
        b = boolean(v)
        return '' if b is None else 'true' if b else 'false'
    if type == 'datetime':
        return to_iso(v, first) or ''
    return str(v if v is not None else '').strip()


def key_text(v, type, first=False):
    """A cell as relationship keys compare it: numbers by value, text trimmed and ignoring case, dates without a midnight time."""
    s = cell(v, type, first)
    if type in NUMERIC:
        return s
    return js_num(float(s)) if NUM.match(s) and not _LEADING_ZERO.match(s) else re.sub(r'[T ]00:00(:00)?$', '', s).lower()


def date_part(iso, part):
    """The bucket an ISO date falls in, as the app keys it: 2024, 2024 Q1, 2024-01, 2024-01-31."""
    if not iso:
        return ''
    return iso[:4] if part == 'year' else f'{iso[:4]} Q{(int(iso[5:7]) + 2) // 3}' if part == 'quarter' else iso[:7 if part == 'month' else 10]


def infer(values):
    """A column's type from its values, by the app's rules (it looks at the first 1,000 rows; this at them all): a
    column mixing kinds is text, except 0/1 among true/false; numbers with a leading zero (zip codes) are text too."""
    kinds, bits = set(), True
    for v in values:
        s = str(v).strip()
        if not s:
            continue
        if s.lower() in ('true', 'false'):
            kinds.add('boolean')
        elif NUM.match(s) and not _LEADING_ZERO.match(s):
            kinds.add('int' if float(s).is_integer() else 'float')
            bits = bits and s in ('0', '1')
        else:
            kinds.add('datetime' if to_iso(s) else 'string')
    if 'float' in kinds or (bits and 'boolean' in kinds):
        kinds.discard('int')
    return kinds.pop() if len(kinds) == 1 else 'string'


def pack(columns):
    """Columns (each its name, then its values) as a payload: a CSV line each, gzip -9 (no timestamp) + base64."""
    out = io.StringIO()
    csv.writer(out, lineterminator='\n').writerows(columns)
    return base64.b64encode(gzip.compress(out.getvalue().encode('utf-8'), 9, mtime=0)).decode()


def unpack(payload):
    """A payload's columns, in order: (name, values) pairs, every column as long as the longest (a short one is padded
    blank), values trimmed as the app trims them."""
    text = gzip.decompress(base64.b64decode(payload)).decode('utf-8-sig')
    # each column trimmed as it's read: a table of millions of rows is never held twice
    columns = [(r[0].strip(), list(map(str.strip, r[1:]))) for r in csv.reader(io.StringIO(text)) if r]
    n = max((len(v) for _, v in columns), default=0)
    for _, v in columns:
        v.extend([''] * (n - len(v)))
    return columns
