# Ticker base

**What it is.** Here are all securities a hypothesis ticker is chosen from, and the state of their loading.

**The idea.** A check is possible only on clean data: the ticker database and its loads are the foundation of every calculation.

**How to use it.**

**Where the list comes from.** US — the official Nasdaq Trader Symbol Directory files (NASDAQ, NYSE, NYSE American, NYSE Arca, Cboe BZX). Israel — the list of securities from the Tel Aviv Stock Exchange site, with names in English and Hebrew. Stocks and ETFs are taken; test securities, warrants, rights and bonds are dropped.

**When it updates.** Automatically once a week, on Sunday morning Israel time, and at any moment with the «Refresh» button. If nothing loaded for a week — say, the server was off — the load starts by itself at startup.

**«Delisted».** A security that disappeared from the exchange list is not deleted: your hypotheses may refer to it. It is no longer offered when recording a new hypothesis.

**Last load.** For each source — when, how many rows came, how many are new and changed. «Suspicious» means half as many or twice as many rows came as usual: in that case nothing is marked as gone until you check. Loading the same list again adds no rows.

**Currency.** TASE prices are quoted in agorot (1/100 of a shekel) — this is shown at each security.

**Reminder.** Are this security's data loaded and correct?

**Trap.** Ignoring load problems and trusting empty or wrong prices.

<!-- T-019: agent's draft — idea, remind, trap -->
