CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`type` text NOT NULL,
	`security_id` integer NOT NULL,
	`portfolio_id` integer,
	`position_id` integer,
	`event_id` integer,
	`basis` text NOT NULL,
	`basis_ref` text,
	`thesis_entry_id` integer NOT NULL,
	`expectation` text,
	`review_date` text,
	`outcome` text,
	`outcome_at` text,
	`conclusion_entry_id` integer,
	`no_reason` integer DEFAULT 0 NOT NULL,
	`plan_id` integer,
	`cancelled_at` text,
	`origin` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_origin_unique` ON `decisions` (`origin`);--> statement-breakpoint
CREATE INDEX `decisions_security` ON `decisions` (`security_id`);--> statement-breakpoint
CREATE INDEX `decisions_position` ON `decisions` (`position_id`);