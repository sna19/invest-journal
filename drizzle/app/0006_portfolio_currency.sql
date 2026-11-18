DROP INDEX `portfolios_autoSourceId_unique`;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `currency` text DEFAULT 'ILS' NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `tax_accrued` real;--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_auto_source_currency` ON `portfolios` (`auto_source_id`,`currency`);--> statement-breakpoint
ALTER TABLE `cash_events` ADD `to_amount` real;--> statement-breakpoint
ALTER TABLE `cash_events` ADD `to_currency` text;--> statement-breakpoint
ALTER TABLE `position_events` ADD `cost_total` real;--> statement-breakpoint
-- the new columns are locked like the rest of an event
DROP TRIGGER position_events_locked;
--> statement-breakpoint
CREATE TRIGGER position_events_locked
BEFORE UPDATE ON position_events
WHEN NEW.position_id IS NOT OLD.position_id OR NEW.kind IS NOT OLD.kind OR NEW.date IS NOT OLD.date
  OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.currency IS NOT OLD.currency OR NEW.fee IS NOT OLD.fee
  OR NEW.fx_rate IS NOT OLD.fx_rate OR NEW.amount IS NOT OLD.amount OR NEW.cost_total IS NOT OLD.cost_total
  OR NEW.hypothesis_id IS NOT OLD.hypothesis_id OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto
  OR NEW.created_at IS NOT OLD.created_at OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a position event cannot change: reverse it and enter the right one');
END;
--> statement-breakpoint
DROP TRIGGER cash_events_locked;
--> statement-breakpoint
CREATE TRIGGER cash_events_locked
BEFORE UPDATE ON cash_events
WHEN NEW.portfolio_id IS NOT OLD.portfolio_id OR NEW.kind IS NOT OLD.kind OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount
  OR NEW.currency IS NOT OLD.currency OR NEW.to_amount IS NOT OLD.to_amount OR NEW.to_currency IS NOT OLD.to_currency
  OR NEW.fx_rate IS NOT OLD.fx_rate OR NEW.position_id IS NOT OLD.position_id
  OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a cash event cannot change: reverse it and enter the right one');
END;
--> statement-breakpoint
-- the automatic portfolios made so far were in shekels; their sum stays 10 000 ₪
UPDATE portfolios SET currency = 'ILS' WHERE auto_source_id IS NOT NULL;
