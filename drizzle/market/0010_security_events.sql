CREATE TABLE `ops_events_loads` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`fetched_at` text NOT NULL,
	`status` text NOT NULL,
	`earnings` integer DEFAULT 0 NOT NULL,
	`dividends` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `ref_security_events` (
	`security_id` integer NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`provider_code` text NOT NULL,
	PRIMARY KEY(`security_id`, `kind`, `date`)
);
