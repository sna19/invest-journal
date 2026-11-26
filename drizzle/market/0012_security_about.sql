CREATE TABLE `ref_security_about` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`summary` text,
	`summary_ru` text,
	`website` text,
	`employees` integer,
	`city` text,
	`country` text,
	`fund_family` text,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`security_id`) REFERENCES `ref_securities`(`id`) ON UPDATE no action ON DELETE no action
);
