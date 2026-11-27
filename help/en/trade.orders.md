# Order types: stop-loss, trailing, take-profit

**What it is.** Orders placed at the broker in advance that fire by themselves, without you. The app is not connected to the broker: it computes the levels, gives a cheat sheet and, after «I placed it», follows them by the prices.

- **Stop-loss (market, Stop / Stop Market).** When the price falls to the stop, the broker sells **at any price**. You get out for sure, but on a gap (the price opened far lower in the morning) — below the stop. Good for very liquid shares and when getting out is what matters.
- **Stop-limit (Stop Limit).** Two levels: at the **stop** price a sale is placed with a **limit** — no cheaper than that price. The sale price is under control, but on a sharp fall below the limit the order **does not fill**, and you stay in the share. So the limit goes 2% or 1 ATR under the stop — as «Protection» does.
- **Trailing stop (Trailing Stop %).** A stop that **rises with the price** by a set percent from its high and **never goes down**. The price rose from 100 to 130 with a 10% trail — the stop rose from 90 to 117. For what you hold for growth: the profit is kept on a turn, and a big rise is not cut. The percent comes from the share's usual move (3 × ATR%, from 8 to 20%).
- **Take-profit (Take Profit, Limit Sell).** A limit sale at the **target** above the price. Locks in the profit but **cuts the rise** above the target. The app's target is the price plus 2 risks (the risk is the distance to the stop; the multiple is in «Settings → Protective plan»), but not above the 52 weeks' high, where sellers usually wait.
- **OCO (One-Cancels-Other) / «bracket».** The stop and the target tied together: when one fills, the other is cancelled by itself. If the broker cannot do this — place two separate orders and, when one fills, **cancel the other at once**, or it will sell what is no longer there.

**The idea.** The exit is decided in advance and calmly, not at the moment of a fall. The stop limits the loss, the target the greed, the trailing stop lets the profit grow.

**How to use it.**

- **Bought with a concrete plan and a term** (a model, a quarter, speculation) — a stop-limit **and** a take-profit, OCO if possible.
- **Holding for growth with no term**, or the position is already in profit — a **trailing stop**, no target.
- **The share moves sharply or gaps** (reports, crypto, small companies) — a market stop-loss is safer than a stop-limit: better to get out worse than not at all.
- A security's card → «Protection» → «Cheat sheet for the broker»: the order type, stop, limit or %, target, quantity, GTC — each value copied by a tap; placed — «I placed it».
- **GTC** (Good Till Cancelled) — the order lives until it fills or you cancel it; **DAY** — only to the end of the day.

An example. Bought at 100, ATR 2 (2%). The stop 93.97 under the 20-day low, the limit 91.97, a risk of ≈ 6 per share → the target 100 + 2 × 6 = 112. If you hold for growth — instead a trailing stop of 8% (a stop at 92 and up with the price).

**Reminder.** A stop is only raised. A target — set in advance, not «just a bit more».

**Trap.** Lowering the stop as the price comes near it; placing the stop so close that the usual daily noise hits it; forgetting to cancel the second order when the first filled.
