# Ticker base

**What it is.** Here are all securities a hypothesis ticker is chosen from, and the state of their loading.

**The idea.** A check is possible only on clean data: the ticker database and its loads are the foundation of every calculation.

**How to use it.**

**Sorting the list.** Pick a kind (stocks, ETFs) or a sector — the sort buttons are under them: market cap, quant score, the return over 1 year and 3 months, P/E, P/S, dividends, revenue growth, beta. The first tap sorts the most useful way (quant score — green first, they are stronger than their sector peers and worth a look; P/E and P/S — cheap first; beta — calm first), the second the other way (↓ / ↑). Each row shows the value it is sorted by; securities without data go last. A P/E under 1 or negative (a loss) is left out of the order. The choice is remembered on the device.

**Sectors, industries, indices.** Under the search — three lists: every sector of both markets (how many companies and industries are in the base, the sector's ETF and its year), every industry (with a search) and the indices (S&P 500, Nasdaq 100, Dow Jones, Russell 2000, TA-35, TA-90, TA-125) — through the ETFs that track them. A tap on a sector or an industry opens its page with the companies, on an ETF — its card. A tap on a column header sorts: the first — descending, the second — ascending, the third — the own order; every table in the app works this way.

**Where the list comes from.** US — the official Nasdaq Trader Symbol Directory files (NASDAQ, NYSE, NYSE American, NYSE Arca, Cboe BZX). Israel — the list of securities from the Tel Aviv Stock Exchange site, with names in English and Hebrew. Stocks and ETFs are taken; test securities, warrants, rights and bonds are dropped.

**When it updates.** Automatically once a week, on Sunday morning Israel time, and at any moment with the «Refresh» button. If nothing loaded for a week — say, the server was off — the load starts by itself at startup.

**«Delisted».** A security that disappeared from the exchange list is not deleted: your hypotheses may refer to it. It is no longer offered when recording a new hypothesis.

**Last load.** For each source — when, how many rows came, how many are new and changed. «Suspicious» means half as many or twice as many rows came as usual: in that case nothing is marked as gone until you check. Loading the same list again adds no rows.

**Currency.** TASE prices are quoted in agorot (1/100 of a shekel) — this is shown at each security.

**Reminder.** Are this security's data loaded and correct?

**Trap.** Ignoring load problems and trusting empty or wrong prices.

<!-- T-019: agent's draft — idea, remind, trap -->
