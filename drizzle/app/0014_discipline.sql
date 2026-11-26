CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_id` integer NOT NULL,
	`event_id` integer,
	`kind` text NOT NULL,
	`thesis` text,
	`wrong_if` text,
	`stop` real,
	`target` real,
	`review_date` text,
	`no_stop_reason` text,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trade_plans_position` ON `trade_plans` (`position_id`);--> statement-breakpoint
CREATE TABLE `trade_reviews` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`followed` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `rules` (`text`, `sort_order`) VALUES ('Нет условия выхода — нет сделки.', 1), ('Сделка по модели исполняется по модели целиком, включая выход.', 2), ('Спекуляции — только из игрового бюджета с потолком и заранее принятым максимальным убытком.', 3);
