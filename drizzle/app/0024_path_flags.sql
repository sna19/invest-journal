CREATE TABLE `path_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`security_id` integer NOT NULL,
	`flag` text NOT NULL,
	`since` text NOT NULL,
	`cleared_at` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `path_flags_security` ON `path_flags` (`security_id`,`flag`);