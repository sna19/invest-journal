# Carry over positions

**What it is.** Positions bought before the portfolio was started are entered as a list — one line per security; first a line `date YYYY-MM-DD` with the carry-over date.

**The idea.** A portfolio not started from zero must know the past purchases, or profit and tax are counted wrong.

**How to use it.**

- `SCHD 40.5 30.00` — ticker, quantity, price on the carry-over date (fractions — up to 6 decimals).
- `ESLT value=5000 cost=4000` — the position's value and purchase cost in the portfolio currency: quantity = value / close on the date, to whole units.
- `yahoo:CSPX.L value=10000` — a UCITS ETF on the London exchange by its Yahoo symbol: the security is added to the base by hand (it is not in search or models).
- `cash ILS 5290.91`, `cash USD 663.15` — cash; `tax 2881.45` — accrued tax, for reference.

A line can get `avg=` (average price) or `cost=` (the whole purchase cost): then profit counts from the purchase, otherwise — «since carry-over».

First «Check»: the app finds the securities and shows quantities, roundings over 1% and prices more than 5% off the base. Then «Carry over». The portfolio data stay in the app only.

**Reminder.** Does the journal know what I paid?

**Trap.** Carrying over positions without the purchase price and forgetting to add it.

<!-- T-019: agent's draft — idea, remind, trap -->
