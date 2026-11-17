CREATE TABLE `market_fx_daily` (
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`rate` real NOT NULL,
	`provider_code` text NOT NULL,
	`run_id` integer,
	PRIMARY KEY(`pair`, `date`)
);
