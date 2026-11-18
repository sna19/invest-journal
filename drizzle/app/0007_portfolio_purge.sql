-- A portfolio can be deleted whole, at the owner's request (17.11.2026: portfolios made by mistake). Events stay
-- undeletable one by one; they go only together with their portfolio, while its id is in portfolio_purge — the
-- app puts it there inside the deleting transaction and takes it out at the end.
CREATE TABLE `portfolio_purge` (`portfolio_id` integer PRIMARY KEY NOT NULL);
--> statement-breakpoint
DROP TRIGGER position_events_no_delete;
--> statement-breakpoint
CREATE TRIGGER position_events_no_delete
BEFORE DELETE ON position_events
WHEN NOT EXISTS (
  SELECT 1 FROM portfolio_purge g JOIN positions p ON p.portfolio_id = g.portfolio_id WHERE p.id = OLD.position_id
)
BEGIN
  SELECT RAISE(ABORT, 'position events are never deleted: reverse the event instead');
END;
--> statement-breakpoint
DROP TRIGGER cash_events_no_delete;
--> statement-breakpoint
CREATE TRIGGER cash_events_no_delete
BEFORE DELETE ON cash_events
WHEN NOT EXISTS (SELECT 1 FROM portfolio_purge g WHERE g.portfolio_id = OLD.portfolio_id)
BEGIN
  SELECT RAISE(ABORT, 'cash events are never deleted: reverse the event instead');
END;
