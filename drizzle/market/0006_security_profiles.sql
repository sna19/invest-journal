CREATE TABLE `ref_security_profiles` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sector` text,
	`industry` text,
	`country` text,
	`market_cap` real,
	`cap_currency` text,
	`fund_category` text,
	`sector_weights` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `ref_securities`(`id`) ON UPDATE no action ON DELETE no action
);
