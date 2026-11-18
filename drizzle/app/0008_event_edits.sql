-- An event can be corrected, at the owner's request (18.11.2026: a purchase entered wrong could not be fixed).
-- Its date and numbers change in place; what it was before is kept by the database itself in event_edits, so the
-- history of corrections stays whole. The kind, the position, the currency and the links stay locked as before.
CREATE TABLE `event_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_table` text NOT NULL,
	`event_id` integer NOT NULL,
	`old_values` text NOT NULL,
	`new_values` text NOT NULL,
	`edited_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_edits_event` ON `event_edits` (`event_table`,`event_id`);
--> statement-breakpoint
CREATE TRIGGER event_edits_no_change
BEFORE UPDATE ON event_edits
BEGIN
  SELECT RAISE(ABORT, 'the log of corrections is never changed');
END;
--> statement-breakpoint
CREATE TRIGGER event_edits_no_delete
BEFORE DELETE ON event_edits
WHEN NOT EXISTS (
  SELECT 1 FROM portfolio_purge g WHERE
    (OLD.event_table = 'cash_events' AND g.portfolio_id = (SELECT portfolio_id FROM cash_events WHERE id = OLD.event_id))
    OR (OLD.event_table = 'position_events' AND g.portfolio_id = (
      SELECT p.portfolio_id FROM position_events e JOIN positions p ON p.id = e.position_id WHERE e.id = OLD.event_id))
)
BEGIN
  SELECT RAISE(ABORT, 'the log of corrections is never deleted');
END;
--> statement-breakpoint
DROP TRIGGER position_events_locked;
--> statement-breakpoint
CREATE TRIGGER position_events_locked
BEFORE UPDATE ON position_events
WHEN NEW.position_id IS NOT OLD.position_id OR NEW.kind IS NOT OLD.kind OR NEW.currency IS NOT OLD.currency
  OR NEW.hypothesis_id IS NOT OLD.hypothesis_id OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto
  OR NEW.created_at IS NOT OLD.created_at OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a position event keeps its kind, position and currency: reverse it and enter the right one');
END;
--> statement-breakpoint
CREATE TRIGGER position_events_log_edit
AFTER UPDATE OF date, qty, price, fee, amount, cost_total, note ON position_events
WHEN NEW.date IS NOT OLD.date OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.fee IS NOT OLD.fee
  OR NEW.amount IS NOT OLD.amount OR NEW.cost_total IS NOT OLD.cost_total OR NEW.note IS NOT OLD.note
BEGIN
  INSERT INTO event_edits (event_table, event_id, old_values, new_values) VALUES ('position_events', OLD.id,
    json_object('date', OLD.date, 'qty', OLD.qty, 'price', OLD.price, 'fee', OLD.fee, 'amount', OLD.amount, 'cost_total', OLD.cost_total, 'fx_rate', OLD.fx_rate, 'note', OLD.note),
    json_object('date', NEW.date, 'qty', NEW.qty, 'price', NEW.price, 'fee', NEW.fee, 'amount', NEW.amount, 'cost_total', NEW.cost_total, 'fx_rate', NEW.fx_rate, 'note', NEW.note));
END;
--> statement-breakpoint
DROP TRIGGER cash_events_locked;
--> statement-breakpoint
CREATE TRIGGER cash_events_locked
BEFORE UPDATE ON cash_events
WHEN NEW.portfolio_id IS NOT OLD.portfolio_id OR NEW.kind IS NOT OLD.kind OR NEW.currency IS NOT OLD.currency
  OR NEW.to_currency IS NOT OLD.to_currency OR NEW.position_id IS NOT OLD.position_id
  OR NEW.reverses_event_id IS NOT OLD.reverses_event_id OR NEW.auto IS NOT OLD.auto OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NOT OLD.cancelled_at)
BEGIN
  SELECT RAISE(ABORT, 'a cash event keeps its kind and currency: reverse it and enter the right one');
END;
--> statement-breakpoint
CREATE TRIGGER cash_events_log_edit
AFTER UPDATE OF date, amount, to_amount, note ON cash_events
WHEN NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.to_amount IS NOT OLD.to_amount OR NEW.note IS NOT OLD.note
BEGIN
  INSERT INTO event_edits (event_table, event_id, old_values, new_values) VALUES ('cash_events', OLD.id,
    json_object('date', OLD.date, 'amount', OLD.amount, 'to_amount', OLD.to_amount, 'fx_rate', OLD.fx_rate, 'note', OLD.note),
    json_object('date', NEW.date, 'amount', NEW.amount, 'to_amount', NEW.to_amount, 'fx_rate', NEW.fx_rate, 'note', NEW.note));
END;
