CREATE TABLE `signal_ideas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run` text NOT NULL,
	`security_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`score` real NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`reason` text,
	`hypothesis_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_ideas_run` ON `signal_ideas` (`run`);