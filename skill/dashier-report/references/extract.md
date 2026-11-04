# extract.py: from any source to data/*.csv

`extract.py` turns the source into the star schema's CSVs. It is code, not typing: a rerun on next month's source
rebuilds every table, and a wrong number can be traced to the row it came from. Use pandas; it reads nearly every
connector, and its frames write the CSVs the app reads.

## Reading the source

| Source | pandas |
|---|---|
| CSV, TSV, text exports | `pd.read_csv(path, sep=None, engine="python")` (sniffs the separator) |
| Excel (every sheet) | `pd.read_excel(path, sheet_name=None)` → `{sheet: frame}` (needs `openpyxl`; `xlrd` for `.xls`) |
| Databases | `pd.read_sql(query, conn)` with a SQLAlchemy engine or a DB-API connection (`sqlite3`, `psycopg`, `pyodbc`) |
| Parquet, Feather | `pd.read_parquet(path)` (needs `pyarrow`) |
| JSON, APIs | `pd.json_normalize(requests.get(url).json(), record_path=[...])` |
| Google Sheets | `pd.read_csv(f"https://docs.google.com/spreadsheets/d/{id}/export?format=csv&gid={gid}")` (shared by link) |
| HTML tables | `pd.read_html(url_or_path)` → a frame per table |
| A workbook pandas can't open | `soffice --headless --convert-to 'csv:Text - txt - csv (StarCalc):44,34,UTF8,1,,0,false,true,false,false,false,-1' book.xls --outdir sheets` (every sheet, as `book-<SHEET>.csv`) |

Read with `dtype=str` when ids or codes have leading zeros, then convert the number columns yourself.

## Shaping it into a star

```python
import pandas as pd
raw = pd.read_excel("sales.xlsx", sheet_name="Orders")
raw["date"] = pd.to_datetime(raw["Order Date"]).dt.strftime("%Y-%m-%d")      # ISO dates

dim_store = (raw[["Store ID", "Store", "Region"]].drop_duplicates("Store ID")
             .rename(columns={"Store ID": "store_id", "Store": "store", "Region": "region"}))
fact_sales = raw.rename(columns={"Store ID": "store_id", "Revenue": "revenue", "Units": "units"})[
    ["date", "store_id", "revenue", "units"]].sort_values(["date", "store_id"])

assert dim_store.store_id.is_unique and fact_sales.store_id.isin(dim_store.store_id).all()
for name, df in {"dim_store": dim_store, "fact_sales": fact_sales}.items():
    df.to_csv(f"data/{name}.csv", index=False)
```

- **Split flat sheets.** Repeated descriptive columns move to a dimension (`drop_duplicates` on its key); the fact
  keeps the key. Rename columns to the labels readers see (`region`, not `Rgn_Cd`).
- **Assert the joins.** Every dimension key unique (`is_unique`), every fact key present in its dimension (`isin`).
  Add an `"Unknown"` member rather than leave a gap.
- **Check every total the source prints.** Categories add up to the total, segments too, gross margin minus
  operating expenses is operating income. A misread row then stops the script, and no wrong number reaches the
  report.
- **Convert units once:** a filing in millions gets `* 1_000_000` as it is read; store amounts in full.
- **Plain values:** numbers without `$`, `,` or `%` (`pd.to_numeric(s.str.replace(r"[$,]", "", regex=True))`),
  percentages as fractions, `(1,234)` as negative, `—` as 0, booleans `true`/`false`.
- **Order:** fact rows oldest first; dimensions in their natural order, with an order column for `sortBy`
  (`month_number`, `segment_order`).
- **Dimensions from lists** in the script when the source has no table for them (segments, statement lines), each
  with its order column.

## Statements and reports laid out for print

Find rows by their label, not their position. A helper such as `row(df, "Total net sales", after="Cost of sales")`
returns the numbers on the first row whose label starts with that text, after a heading when a label repeats
("Products" under net sales and under cost of sales). Skip the change columns (`%`) between years.

## Values Dashier can't compute

Dashier has no formula language (no rolling windows, ranks, ALL, or OR between conditions; a condition's `values`
list is the OR). Compute those in pandas at the fact's grain, as plain columns:

```python
df = df.sort_values(["store_id", "month"])
g = df.groupby("store_id")["revenue"]
df["revenue_rolling_3m"] = g.transform(lambda s: s.rolling(3, min_periods=1).sum())     # trailing 3 months
df["revenue_fytd"] = df.groupby(["store_id", "fiscal_year"])["revenue"].cumsum()         # a custom year-to-date reset
df["first_month"] = df.groupby("customer_id")["month"].transform("min")                  # each customer's cohort
```

Name such a column for what it is and remember which add up: a value per row (a cohort) sums like any fact; a
rolling or to-date value adds up across members but never across periods, so show it with the period on the axis.
Ratios are never columns: they are measures.

## The stored form

`build_report.py` packs each CSV: a table is its `structure` (`[{name, type, sortBy?}]`) and its `payload`, gzip+base64
of a CSV with one line per column (its name, then its values). To read a payload in Python:
`cols = list(csv.reader(io.StringIO(gzip.decompress(base64.b64decode(p)).decode())))` (one list per column, its
name first).
