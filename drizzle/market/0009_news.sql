CREATE TABLE `news_maya_companies` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`company_id` integer,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `news_fetches` (
	`key` text PRIMARY KEY NOT NULL,
	`fetched_at` text NOT NULL,
	`items` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`publisher` text,
	`provider` text NOT NULL,
	`published_at` text NOT NULL,
	`snippet` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_url_unique` ON `news_items` (`url`);--> statement-breakpoint
CREATE INDEX `news_items_title_key` ON `news_items` (`title_key`);--> statement-breakpoint
CREATE INDEX `news_items_published` ON `news_items` (`published_at`);--> statement-breakpoint
CREATE TABLE `news_links` (
	`news_id` integer NOT NULL,
	`security_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`news_id`, `security_id`, `role`)
);
--> statement-breakpoint
CREATE INDEX `news_links_security` ON `news_links` (`security_id`,`role`);--> statement-breakpoint
CREATE TABLE `news_moves` (
	`security_id` integer NOT NULL,
	`date` text NOT NULL,
	`move_pct` real NOT NULL,
	`atr_pct` real,
	`market_pct` real,
	`sector_pct` real,
	`own_pct` real,
	`news` integer DEFAULT 0 NOT NULL,
	`top_title` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`security_id`, `date`)
);
