ALTER TABLE `ref_security_profiles` ADD `expense_ratio` real;--> statement-breakpoint
-- the profiles of funds loaded before had no fee: they are refreshed at the next load
UPDATE `ref_security_profiles` SET `fetched_at` = '2000-01-01T00:00:00.000Z' WHERE `kind` = 'etf';
