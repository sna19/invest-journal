CREATE TABLE `help_topics` (
	`key` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body_md` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
