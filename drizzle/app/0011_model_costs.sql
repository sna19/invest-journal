CREATE TABLE `auto_carries` (
	`portfolio_id` integer NOT NULL,
	`hypothesis_id` integer NOT NULL,
	`position_id` integer NOT NULL,
	`from_hypothesis_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`portfolio_id`, `hypothesis_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP INDEX `portfolios_auto_source_currency`;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `auto_hold` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_auto_source_currency_hold` ON `portfolios` (`auto_source_id`,`currency`,`auto_hold`);