CREATE TABLE `market_quotes` (
	`key` text PRIMARY KEY NOT NULL,
	`security_id` integer,
	`price` real NOT NULL,
	`prev_close` real,
	`currency` text,
	`market_time` text NOT NULL,
	`fetched_at` text NOT NULL,
	`provider_code` text NOT NULL
);
