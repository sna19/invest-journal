ALTER TABLE `entry_revisions` ADD `format` text DEFAULT 'md' NOT NULL;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `format` text DEFAULT 'md' NOT NULL;--> statement-breakpoint
ALTER TABLE `journal_entries` ADD `body_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `journal_entries` SET `body_text` = `body`;
--> statement-breakpoint
DROP TRIGGER `journal_fts_ai`;
--> statement-breakpoint
DROP TRIGGER `journal_fts_ad`;
--> statement-breakpoint
DROP TRIGGER `journal_fts_au`;
--> statement-breakpoint
DROP TABLE `journal_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `journal_fts` USING fts5(body_text, content='journal_entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO `journal_fts`(`journal_fts`) VALUES ('rebuild');
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ai` AFTER INSERT ON `journal_entries` BEGIN INSERT INTO journal_fts(rowid, body_text) VALUES (new.id, new.body_text); END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_ad` AFTER DELETE ON `journal_entries` BEGIN INSERT INTO journal_fts(journal_fts, rowid, body_text) VALUES ('delete', old.id, old.body_text); END;
--> statement-breakpoint
CREATE TRIGGER `journal_fts_au` AFTER UPDATE OF body_text ON `journal_entries` BEGIN INSERT INTO journal_fts(journal_fts, rowid, body_text) VALUES ('delete', old.id, old.body_text); INSERT INTO journal_fts(rowid, body_text) VALUES (new.id, new.body_text); END;
