ALTER TABLE `hypotheses` ADD `entry_price_date` text;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `last_date` text;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `last_price` real;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `benchmark_last` real;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `current_return_pct` real;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `current_benchmark_return_pct` real;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD `current_excess_pct` real;
--> statement-breakpoint
DROP TRIGGER hypotheses_locked_fields;
--> statement-breakpoint
CREATE TRIGGER hypotheses_locked_fields
BEFORE UPDATE ON hypotheses
WHEN NEW.article_id IS NOT OLD.article_id
  OR NEW.security_id IS NOT OLD.security_id
  OR NEW.symbol IS NOT OLD.symbol
  OR NEW.exchange_code IS NOT OLD.exchange_code
  OR NEW.signal_type IS NOT OLD.signal_type
  OR NEW.direction IS NOT OLD.direction
  OR NEW.direction_source IS NOT OLD.direction_source
  OR NEW.thesis IS NOT OLD.thesis
  OR NEW.confidence_pct IS NOT OLD.confidence_pct
  OR NEW.invalidation IS NOT OLD.invalidation
  OR NEW.mode IS NOT OLD.mode
  OR NEW.horizon_date IS NOT OLD.horizon_date
  OR NEW.horizon_source IS NOT OLD.horizon_source
  OR NEW.target_price IS NOT OLD.target_price
  OR NEW.amount IS NOT OLD.amount
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.entry_date IS NOT OLD.entry_date
  OR NEW.benchmark_id IS NOT OLD.benchmark_id
  OR (OLD.entry_price IS NOT NULL AND NEW.entry_price IS NOT OLD.entry_price)
  OR (OLD.benchmark_entry IS NOT NULL AND NEW.benchmark_entry IS NOT OLD.benchmark_entry)
  OR (OLD.entry_price_date IS NOT NULL AND NEW.entry_price_date IS NOT OLD.entry_price_date)
  -- a closed hypothesis keeps its result: a later correction of market data does not change it (section 14)
  OR (OLD.status IN ('closed', 'closed_early') AND (
        NEW.status IS NOT OLD.status OR NEW.exit_date IS NOT OLD.exit_date OR NEW.exit_price IS NOT OLD.exit_price
     OR NEW.benchmark_exit IS NOT OLD.benchmark_exit OR NEW.return_pct IS NOT OLD.return_pct
     OR NEW.benchmark_return_pct IS NOT OLD.benchmark_return_pct OR NEW.excess_pct IS NOT OLD.excess_pct
     OR NEW.outcome IS NOT OLD.outcome))
BEGIN
  SELECT RAISE(ABORT, 'hypothesis is locked: key fields cannot change after saving');
END;
