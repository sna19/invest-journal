CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`author` text,
	`url` text,
	`title` text,
	`published_at` text,
	`read_at` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `articles_url` ON `articles` (`url`);--> statement-breakpoint
CREATE INDEX `articles_source` ON `articles` (`source_id`);--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`security_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`security_name` text NOT NULL,
	`exchange_code` text NOT NULL,
	`currency` text NOT NULL,
	`price_unit` text NOT NULL,
	`signal_type` text NOT NULL,
	`direction` text NOT NULL,
	`direction_source` text NOT NULL,
	`thesis` text NOT NULL,
	`confidence_pct` integer,
	`invalidation` text NOT NULL,
	`mode` text DEFAULT 'sim' NOT NULL,
	`horizon_date` text NOT NULL,
	`horizon_source` text NOT NULL,
	`target_price` real,
	`amount` real,
	`tags` text,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`entry_date` text NOT NULL,
	`entry_price` real,
	`benchmark_id` integer NOT NULL,
	`benchmark_symbol` text NOT NULL,
	`benchmark_entry` real,
	`status` text DEFAULT 'open' NOT NULL,
	`exit_date` text,
	`exit_price` real,
	`benchmark_exit` real,
	`return_pct` real,
	`benchmark_return_pct` real,
	`excess_pct` real,
	`outcome` text,
	`cancelled_at` text,
	`lesson` text,
	`close_reason` text,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hypotheses_status` ON `hypotheses` (`status`,`horizon_date`);--> statement-breakpoint
CREATE INDEX `hypotheses_article` ON `hypotheses` (`article_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`kind` text DEFAULT 'publication' NOT NULL,
	`market` text DEFAULT 'any' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_name_unique` ON `sources` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_domain_unique` ON `sources` (`domain`);