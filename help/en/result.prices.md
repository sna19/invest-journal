# When prices update

**What it is.** Closing prices load once a day, in the morning Israel time (07:15 by default; the time is changed in «More» → «Settings» → «Data updates»): for the past trading day of the US exchanges and TASE.

**The idea.** The check uses closing prices, the same for everyone: so the result does not depend on when you looked.

**How to use it.**

**That is why** a result is shown «as of a date» — the last trading day with a price, not as of now. Within the day the numbers do not change.

**A fresh hypothesis.** The entry price is the close of the record day (or the nearest trading day). While the last price is the same day, the result is zero by definition, so instead of «0.0%» it says «first result — tomorrow».

**Reminder.** Prices as of which day?

**Trap.** Taking a fresh hypothesis' zero result for an error.

<!-- T-019: agent's draft — idea, remind, trap -->
