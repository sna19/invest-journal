# How candidates are computed

For the chosen quarter the model takes every share of the base and looks at how its price changed **inside that quarter** in each of the last 10 years: from the close of the last month before the quarter to the close of the quarter's last month (for the third quarter — from 30 June to 30 September). Prices are monthly, adjusted for splits and dividends. The growth accumulated over 10 years plays no role; in other quarters the share may fall.

**Universe.** Only shares (no ETFs and no funds the exchange labels as shares: exchange-traded products and closed-end funds) with a full 10-year history, an average daily turnover over the last year not below the threshold and a price not below the threshold. Otherwise penny shares and data errors clutter the candidates.

**Selection.** Shares that rose in at least K of 10 years remain. In variant B «rise» means beating the market (S&P 500 for the US, TA-125 for Israel) or the average of the share's sector. The rest are sorted by the mean (median, worst year), and the 10 best are taken, at most 2 per sector and 7 per market.

**Each candidate** has 10 quarterly results, the mean, the median and the worst year. A tap on a row opens the security's card with the model's block: the years next to the market (a mean can rest on one exceptional year), the chart with the quarter shaded and the trade buttons.

The data update once a month, at night.

The screen remembers on this device the variant, the quarter and the parameters you tried but did not save: after a security's card or another tab everything is in place. «Back to the saved» drops the trial.
