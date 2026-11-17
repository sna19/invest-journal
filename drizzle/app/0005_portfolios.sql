CREATE TABLE `cash_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`note` text,
	`position_id` integer,
	`reverses_event_id` integer,
	`auto` integer DEFAULT false NOT NULL,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_events_portfolio` ON `cash_events` (`portfolio_id`,`date`);--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'real' NOT NULL,
	`auto_source_id` integer,
	`auto_amount_ils` real DEFAULT 10000 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`auto_source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_name_unique` ON `portfolios` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_autoSourceId_unique` ON `portfolios` (`auto_source_id`);--> statement-breakpoint
CREATE TABLE `position_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_id` integer NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`qty` real,
	`price` real,
	`currency` text NOT NULL,
	`fee` real,
	`fx_rate` real,
	`amount` real,
	`note` text,
	`hypothesis_id` integer,
	`reverses_event_id` integer,
	`auto` integer DEFAULT false NOT NULL,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hypothesis_id`) REFERENCES `hypotheses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `position_events_position` ON `position_events` (`position_id`,`date`);--> statement-breakpoint
CREATE INDEX `position_events_hypothesis` ON `position_events` (`hypothesis_id`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`security_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`security_name` text NOT NULL,
	`exchange_code` text NOT NULL,
	`currency` text NOT NULL,
	`price_unit` text NOT NULL,
	`stage` text DEFAULT 'watch' NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `positions_portfolio` ON `positions` (`portfolio_id`,`stage`);--> statement-breakpoint
-- Spec section 18: events are never deleted or changed. A mistake is fixed by a reverse event (storno) and a
-- new right one; within 24 hours of entering an event can be cancelled as an input error. The database itself
-- enforces it, as for hypotheses.
CREATE TRIGGER position_events_no_delete
BEFORE DELETE ON position_events
BEGIN
  SELECT RAISE(ABORT, 'position events are never deleted: reverse the event instead');
END;
--> statement-breakpoint
CREATE TRIGGER position_events_locked
BEFORE UPDATE ON position_events
WHEN NEW.position_id IS NOT OLD.position_id OR NEW.kind IS NOT OLD.kind OR NEW.date IS NOT OLD.date
  OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.currency IS NOT OLD.currency OR NEW.fee IS NOT OLD.fee
  OR NEW.fx_rate IS NOT OLD.fx_rate OR NEW.amount IS NOT OLD.amount OR NEW.hypothesis_id IS NOT OLD.hypothesis_id
  OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a position event cannot change: reverse it and enter the right one');
END;
--> statement-breakpoint
CREATE TRIGGER position_events_cancel_window
BEFORE UPDATE OF cancelled_at ON position_events
WHEN NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL AND julianday('now') - julianday(OLD.created_at) > 1
BEGIN
  SELECT RAISE(ABORT, 'an event can be cancelled only within 24 hours of entering it');
END;
--> statement-breakpoint
CREATE TRIGGER cash_events_no_delete
BEFORE DELETE ON cash_events
BEGIN
  SELECT RAISE(ABORT, 'cash events are never deleted: reverse the event instead');
END;
--> statement-breakpoint
CREATE TRIGGER cash_events_locked
BEFORE UPDATE ON cash_events
WHEN NEW.portfolio_id IS NOT OLD.portfolio_id OR NEW.kind IS NOT OLD.kind OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount
  OR NEW.currency IS NOT OLD.currency OR NEW.fx_rate IS NOT OLD.fx_rate OR NEW.position_id IS NOT OLD.position_id
  OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a cash event cannot change: reverse it and enter the right one');
END;
--> statement-breakpoint
CREATE TRIGGER cash_events_cancel_window
BEFORE UPDATE OF cancelled_at ON cash_events
WHEN NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL AND julianday('now') - julianday(OLD.created_at) > 1
BEGIN
  SELECT RAISE(ABORT, 'an event can be cancelled only within 24 hours of entering it');
END;
