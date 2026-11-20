# Portfolios

A portfolio is a history of events by security: positions, average price and return are computed from it. There is no import from the broker — everything is entered by hand, a trade takes half a minute.

**Portfolio currency** — the one the broker shows the total in; it is chosen when the portfolio is created; name and currency can be changed at the bottom of the portfolio screen — totals are recomputed in the new currency at each day's rate. Dollar — US securities, benchmark S&P 500. Shekel — TASE securities and foreign ETFs if the broker shows them in shekels, benchmark TA-125. Value, return and cash are in the portfolio currency, so the numbers match the broker's screen.

**Real** — your money. **Virtual** — the same without money. **Automatic** — a source's virtual portfolio, turned on in the source card.

**Cash** — the balance by currency, as at the broker. A purchase without enough cash only warns. Positions bought earlier are brought in with «Carry over positions».

**All together** — the sum of the real portfolios in one currency at today's rate.

**Delete portfolio** — a button at the bottom of the screen: the portfolio goes entirely, with all positions and history. To confirm, type its name; before deleting, the app saves a copy of the journal in the backups.

**Export for AI.** At the bottom of the portfolio screen — all its data as one JSON: totals, positions with their trade history, cash, linked hypotheses. «Copy» — and paste into a chat with AI together with your question. Cancelled and reversed records are not exported.

**Price freshness.** The portfolio screen uses quotes — the last price of a security during the trading day (Yahoo, delayed up to 15–20 minutes) and the live dollar rate; stats and hypotheses use only checked closing prices. Under the summary you see when the quotes came and which close date is used. The «Refresh» button next to it updates now; its colour: green — the data were fetched recently (within two intervals of the settings, at least 20 minutes), yellow — refreshing, red — not updated for long. A green dot at a position — the day's quote, grey — a closing price. The quote frequency and the morning load time are in «Settings» → «Data updates»; an open portfolio screen refreshes itself at the same frequency.

**Today's change.** In a position's row, next to its value — the price change today (the last quote against yesterday's close) and on the right the result since purchase; below — the day's change in money, in the portfolio currency. For a dollar security in a shekel portfolio the money includes the dollar's move today. Above the list, under the value — the whole portfolio's change today: the sum over the positions plus the rate's move for cash in another currency. If the exchange has not opened yet or quotes are off, the change of the last trading day is shown with its date («on 19 Nov»), not «0%». «Weight» — the position's share of the portfolio's value.
