CREATE TABLE `shortlist` (
	`security_id` integer PRIMARY KEY NOT NULL,
	`origin` text,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
