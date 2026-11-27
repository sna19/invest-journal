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

**Reconciling with the broker.** The broker's whole list can be pasted into a portfolio that already holds some of it: each line is matched with the portfolio. The same quantity — «already there», not added (an average price more than 1% off is marked). Another quantity — marked and not added: the difference goes in as a «Bought» / «Sold» trade. Not in the portfolio — added. The portfolio's positions missing from the list are listed separately. **Duplicates:** if the portfolio holds more than the broker by exactly repeats of the same entry (the same kind, date, quantity and price), «Carry over» reverses the repeats — they stay in the history marked as a duplicate. A security held on another exchange under the same ticker (say New York instead of Tel Aviv) is not added a second time — it is marked. The line `total 150000` is the broker's total of the securities: the app compares it with the sum of the lines at today's prices and shows the difference.

**Reminder.** Does the journal know what I paid?

**Trap.** Carrying over positions without the purchase price and forgetting to add it.

<!-- T-019: agent's draft — idea, remind, trap -->
