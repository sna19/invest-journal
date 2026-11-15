CREATE TABLE `market_adjustment_factors` (
	`security_id` integer NOT NULL,
	`date` text NOT NULL,
	`factor` real NOT NULL,
	PRIMARY KEY(`security_id`, `date`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `market_corporate_actions` (
	`security_id` integer NOT NULL,
	`ex_date` text NOT NULL,
	`kind` text NOT NULL,
	`ratio` real,
	`amount` real,
	`provider_code` text NOT NULL,
	PRIMARY KEY(`security_id`, `ex_date`, `kind`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `market_prices_daily` (
	`security_id` integer NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real NOT NULL,
	`volume` real,
	`provider_code` text NOT NULL,
	`run_id` integer,
	PRIMARY KEY(`security_id`, `date`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `ops_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ref_securities` ADD `price_status` text;
--> statement-breakpoint
-- spec section 14: the close times the cumulative dividend factor of the first factor date after the price
CREATE VIEW `market_prices_adjusted` AS
SELECT p.security_id, p.date, p.close,
       p.close * coalesce((SELECT f.factor FROM market_adjustment_factors f
                            WHERE f.security_id = p.security_id AND f.date > p.date
                            ORDER BY f.date LIMIT 1), 1.0) AS adj_close
  FROM market_prices_daily p;
