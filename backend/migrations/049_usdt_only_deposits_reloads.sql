-- Reject MMK deposits and MMK card reloads at the database layer.
-- MMK remains available for withdrawal flows only.

CREATE TRIGGER IF NOT EXISTS trg_card_reload_reject_mmk_insert
BEFORE INSERT ON card_reload_requests
FOR EACH ROW
WHEN NEW.wallet_type = 'mmk'
BEGIN
  SELECT RAISE(ABORT, 'USDT_ONLY_CARD_RELOAD: MMK card reloads are not supported');
END;

CREATE TRIGGER IF NOT EXISTS trg_card_reload_reject_mmk_update
BEFORE UPDATE OF wallet_type ON card_reload_requests
FOR EACH ROW
WHEN NEW.wallet_type = 'mmk'
BEGIN
  SELECT RAISE(ABORT, 'USDT_ONLY_CARD_RELOAD: MMK card reloads are not supported');
END;

CREATE TRIGGER IF NOT EXISTS trg_deposit_reject_mmk_insert
BEFORE INSERT ON deposit_requests_v2
FOR EACH ROW
WHEN COALESCE(NEW.deposit_currency, 'MMK') != 'USDT'
BEGIN
  SELECT RAISE(ABORT, 'USDT_ONLY_DEPOSIT: MMK bank deposits are not supported');
END;
