CREATE TABLE `fund_overrides` (
	`security_id` integer NOT NULL,
	`kind` text NOT NULL,
	`weights` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`security_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `position_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_id` integer NOT NULL,
	`date` text NOT NULL,
	`thesis` text,
	`would_buy` integer NOT NULL,
	`exit_condition` text,
	`entry_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `position_reviews_position` ON `position_reviews` (`position_id`);