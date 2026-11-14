CREATE TABLE `ref_exchanges` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`timezone` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ops_ingest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`provider_code` text NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`rows_received` integer DEFAULT 0 NOT NULL,
	`rows_added` integer DEFAULT 0 NOT NULL,
	`rows_updated` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ops_ingest_runs_job` ON `ops_ingest_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `ops_ingest_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`security_id` integer NOT NULL,
	`period_from` text NOT NULL,
	`period_to` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ops_ingest_tasks_status` ON `ops_ingest_tasks` (`status`,`job`);--> statement-breakpoint
CREATE TABLE `ref_provider_symbols` (
	`security_id` integer NOT NULL,
	`provider_code` text NOT NULL,
	`provider_symbol` text NOT NULL,
	PRIMARY KEY(`security_id`, `provider_code`),
	FOREIGN KEY (`security_id`) REFERENCES `ref_securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ref_provider_symbols_lookup` ON `ref_provider_symbols` (`provider_code`,`provider_symbol`);--> statement-breakpoint
CREATE TABLE `ops_providers` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data_kind` text NOT NULL,
	`rate_limit` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ops_quality_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`security_id` integer,
	`date` text,
	`rule` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ops_quality_issues_status` ON `ops_quality_issues` (`status`);--> statement-breakpoint
CREATE TABLE `ops_raw_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`provider_code` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ops_ingest_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ref_securities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange_code` text NOT NULL,
	`type` text NOT NULL,
	`symbol` text NOT NULL,
	`name_en` text NOT NULL,
	`name_he` text,
	`isin` text,
	`currency` text NOT NULL,
	`price_unit` text NOT NULL,
	`listed_at` text,
	`delisted_at` text,
	`active` integer DEFAULT true NOT NULL,
	`is_benchmark` integer DEFAULT false NOT NULL,
	`search` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`exchange_code`) REFERENCES `ref_exchanges`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ref_securities_symbol` ON `ref_securities` (`symbol`);--> statement-breakpoint
CREATE INDEX `ref_securities_exchange` ON `ref_securities` (`exchange_code`,`active`);--> statement-breakpoint
CREATE TABLE `ref_security_symbols` (
	`security_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	PRIMARY KEY(`security_id`, `valid_from`),
	FOREIGN KEY (`security_id`) REFERENCES `ref_securities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ref_trading_days` (
	`exchange_code` text NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`exchange_code`, `date`)
);
