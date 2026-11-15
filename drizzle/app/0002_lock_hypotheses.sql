-- Spec section 6 «Защита от самообмана», enforced by the database itself so that neither the interface nor
-- the API nor a stray query can change a saved hypothesis: key fields are locked, a hypothesis cannot be
-- deleted, it can be cancelled only within 24 hours of saving (as an input error).
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
BEGIN
  SELECT RAISE(ABORT, 'hypothesis is locked: key fields cannot change after saving');
END;
--> statement-breakpoint
CREATE TRIGGER hypotheses_cancel_window
BEFORE UPDATE OF status ON hypotheses
WHEN NEW.status = 'cancelled' AND OLD.status IS NOT 'cancelled'
  AND julianday('now') - julianday(OLD.created_at) > 1
BEGIN
  SELECT RAISE(ABORT, 'hypothesis can be cancelled only within 24 hours of saving');
END;
--> statement-breakpoint
CREATE TRIGGER hypotheses_no_delete
BEFORE DELETE ON hypotheses
BEGIN
  SELECT RAISE(ABORT, 'hypotheses are never deleted');
END;
