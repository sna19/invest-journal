# Trend filter

**What it is.** A candidate is taken only if the price is above its 10-month average (or the 3-month average is above the 10-month one).

**The idea.** The average describes the past and does not predict. As a filter it takes you out of long falls: smaller drawdowns at a similar return. Seasonality and trend can disagree — the data decide who is right.

**How to use it.** Turn it on only if the filter passed the acceptance rule. Watch how many candidates it cuts: fewer than 5 is a concentration risk.

**Reminder.** The average is a risk filter, not a buy signal.

**Trap.** Trying parameters until the table looks nice: that is overfitting.
