# Position stages

A position is the history of one security from the first interest to the full sale. Each step is an event with a date and a note:

- **Watching** — the security came into view.
- **Want to buy** — the decision is ripening: the reason, the desired price, the amount.
- **Bought** — a purchase, possibly in parts; quantity — up to 6 decimal places.
- **Carried over** — a position bought before the portfolio was started: quantity and price on the carry-over date. **Purchase price** (average or the whole cost) is added at once or later — then profit counts from the purchase rather than «since carry-over».
- **Want to sell**, **Sold** (you cannot sell more than you hold), **Changed my mind**, **Note**.

**Mistakes.** A wrong date, quantity, price or fee is fixed by the pencil at the event: it changes in place, the old values stay in the edit log. Cash records are fixed the same way. The event kind and the security do not change: for that — «Reverse» (the event stops counting but stays in the history) and a new event. Within 24 hours a record can also simply be cancelled. A security added by mistake can be removed from the portfolio entirely — the button at the bottom of the position card; before deleting, the app saves a copy of the journal.

**A price far from the day.** If the price is more than 10% outside the day's range, the app asks again — that catches typos and shekels instead of agorot.

**Sorting.** Above the list — «Invested» (how much money is in the security), «Ticker», «Change» (% from the purchase price), «Profit» (realized and unrealized together). Tapping again flips the order: best on top ↓ or worst on top ↑. The choice is remembered on this device.
