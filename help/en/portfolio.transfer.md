# Carry over positions

Positions bought before the portfolio was started are entered as a list — one line per security; first a line `date YYYY-MM-DD` with the carry-over date.

- `SCHD 103.205 35.45` — ticker, quantity, price on the carry-over date (fractions — up to 6 decimals).
- `ESLT value=4770 cost=3032` — the position's value and purchase cost in the portfolio currency: quantity = value / close on the date, to whole units.
- `yahoo:CSPX.L value=15564` — a UCITS ETF on the London exchange by its Yahoo symbol: the security is added to the base by hand (it is not in search or models).
- `cash ILS 5290.91`, `cash USD 663.15` — cash; `tax 2881.45` — accrued tax, for reference.

A line can get `avg=` (average price) or `cost=` (the whole purchase cost): then profit counts from the purchase, otherwise — «since carry-over».

First «Check»: the app finds the securities and shows quantities, roundings over 1% and prices more than 5% off the base. Then «Carry over». The portfolio data stay in the app only.
