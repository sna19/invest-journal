CREATE TABLE `ops_monthly_loads` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`fetched_at` text NOT NULL,
	`status` text NOT NULL,
	`months` integer DEFAULT 0 NOT NULL,
	`first_month` text,
	`last_month` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `market_prices_monthly` (
	`security_id` integer NOT NULL,
	`month` text NOT NULL,
	`close` real NOT NULL,
	`adj_close` real NOT NULL,
	`volume` real,
	`provider_code` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`security_id`, `month`)
);
