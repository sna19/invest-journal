CREATE TABLE `entry_context` (
	`entry_id` integer NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`data` text NOT NULL,
	`restored` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`entry_id`, `object_type`, `object_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entry_links` (
	`entry_id` integer NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`entry_id`, `object_type`, `object_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_links_object` ON `entry_links` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `entry_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_revisions_entry` ON `entry_revisions` (`entry_id`);--> statement-breakpoint
CREATE TABLE `entry_tags` (
	`entry_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_tags_tag` ON `entry_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`body` text NOT NULL,
	`parent_entry_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`origin` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_origin_unique` ON `journal_entries` (`origin`);--> statement-breakpoint
CREATE INDEX `journal_entries_created` ON `journal_entries` (`created_at`);--> statement-breakpoint
CREATE INDEX `journal_entries_parent` ON `journal_entries` (`parent_entry_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`grp` text NOT NULL,
	`system` integer DEFAULT 0 NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_group` ON `tags` (`name`,`grp`);--> statement-breakpoint
CREATE VIRTUAL TABLE `journal_fts` USING fts5(body, content='journal_entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ai` AFTER INSERT ON `journal_entries` BEGIN INSERT INTO journal_fts(rowid, body) VALUES (new.id, new.body); END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ad` AFTER DELETE ON `journal_entries` BEGIN INSERT INTO journal_fts(journal_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_au` AFTER UPDATE OF body ON `journal_entries` BEGIN INSERT INTO journal_fts(journal_fts, rowid, body) VALUES ('delete', old.id, old.body); INSERT INTO journal_fts(rowid, body) VALUES (new.id, new.body); END;
