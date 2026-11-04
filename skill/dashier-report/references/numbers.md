# How numbers are shown

Every number goes through one of three writers.

**1. Values (cards, text bindings, table and matrix cells, a gauge's center)** use the value's `format` and `units`:

| format | 0.004 | 0.336 | 7.456 | 182.5 | 1234.5 | 999999.9 | 416161000 |
|---|---|---|---|---|---|---|---|
| `number` | 0.004 | 0.34 | 7.46 | 182.50 | 1.2K | 1.0M | 416.2M |
| `integer` | 0 | 0 | 7 | 183 | 1,235 | 1,000,000 | 416,161,000 |
| `currency` | $0.004 | $0.34 | $7.46 | $183 | $1,235 | $1,000,000 | $416,161,000 |
| `percent` | 0.4% | 33.6% | 745.6% | | | | |

- `number` keeps up to 2 decimals under 1,000 and compacts from 1,000 (K, M, B, T). `currency` is in the document's
  `currency` (USD, EUR, JPY, GBP, CNY, AUD, CAD, CHF, HKD, SGD; default USD, shown above): whole units from 100,
  cents below. `percent` multiplies a fraction by 100, 1 decimal.
- `units` divides and suffixes to 2 decimals (whole with `integer`): `thousands` K, `millions` M, `billions` B,
  `auto` the largest unit reached. 416161000000 as `currency` with `billions` is $416.16B. `percent` ignores units.
- Where a value's format comes from: the card's, binding's, column's or matrix value's own, else its measure's (a
  `pct-diff` measure defaults to `percent`). With none, a card uses `number`, a text binding writes the raw number
  (for the `round` and `format` filters), table and matrix cells the viewer's locale with up to 3 and 2 decimals.

**2. Charts (axes, data labels, slice and node labels)** write compact numbers in the chart's format
(`options.format`, else the y measure's, never its units): ticks as $0, $50B, $100B; data labels 3 significant
digits under 1,000, 1 decimal above ($1.1B). `options.units` fixes every label to one unit. Shares read 25%.
Tooltips are exact.

**3. Comparisons (a card's line, a binding or chart or matrix value with `compare`)**: `change` is (this − other) /
|other| as a signed percent (+6.4%); `difference` is signed in the value's format (+$25.13B, +1.6% for a rate);
`value` is the other period's number. With nothing to compare, a card drops the line and a binding writes "—". A
card colors a rise green and a fall red (`invert: true` for costs). Its label is the moved period ("vs 2024"), unless
`label` is set.

| Numbers | Store | Measure |
|---|---|---|
| Money, large | full amounts | `"format": "currency", "units": "billions"` (or `millions`; `auto` when sizes vary) |
| Money per unit (EPS, a price) | full amounts | `"format": "currency"`, no units |
| Counts | whole numbers | `"format": "integer"` |
| Rates, margins, shares | fractions (0.468) | `"format": "percent"`; compare as `difference` |
| Scores, ratios | plain numbers | `"format": "number"`; the scale in the title |
| A currency not in the list | amounts | `number` or `integer` with units, the currency in the title or text |

Matrices and tables sum plain fields at totals: a column that doesn't add up (a price, a rate, a balance across
time) needs a measure or `totals: false`.
