CREATE TABLE `reminder_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reminder_id` integer NOT NULL,
	`kind` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`note` text,
	FOREIGN KEY (`reminder_id`) REFERENCES `reminders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminder_events_reminder` ON `reminder_events` (`reminder_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`condition` text NOT NULL,
	`params` text NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`next_due` text,
	`snoozes` integer DEFAULT 0 NOT NULL,
	`fired_at` text,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_state` ON `reminders` (`state`);--> statement-breakpoint
CREATE INDEX `reminders_entry` ON `reminders` (`entry_id`);--> statement-breakpoint
CREATE TABLE `signal_snoozes` (
	`key` text PRIMARY KEY NOT NULL,
	`until` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL
);
