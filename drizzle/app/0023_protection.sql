CREATE TABLE `protection_days` (
	`date` text NOT NULL,
	`portfolio_id` integer NOT NULL,
	`protected_pct` real NOT NULL,
	`unprotected` integer NOT NULL,
	PRIMARY KEY(`date`, `portfolio_id`)
);
--> statement-breakpoint
CREATE TABLE `protection_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_id` integer NOT NULL,
	`type` text NOT NULL,
	`stop` real,
	`limit_price` real,
	`trail_pct` real,
	`base_price` real,
	`qty` real,
	`set_date` text NOT NULL,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `protection_orders_position` ON `protection_orders` (`position_id`);