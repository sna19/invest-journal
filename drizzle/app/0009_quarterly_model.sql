CREATE TABLE `model_quarters` (
	`variant` text NOT NULL,
	`quarter` text NOT NULL,
	`version_id` integer NOT NULL,
	`hypotheses` integer NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`variant`, `quarter`),
	FOREIGN KEY (`version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_settings` (
	`variant` text PRIMARY KEY NOT NULL,
	`params` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variant` text NOT NULL,
	`params` text NOT NULL,
	`source_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `model_version_id` integer;--> statement-breakpoint
CREATE TRIGGER hypotheses_model_version_locked
BEFORE UPDATE ON hypotheses
WHEN NEW.model_version_id IS NOT OLD.model_version_id
BEGIN
  SELECT RAISE(ABORT, 'hypothesis is locked: the model version cannot change');
END;
