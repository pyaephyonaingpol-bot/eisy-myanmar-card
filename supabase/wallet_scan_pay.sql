-- Eisy Myanmar — atomic USDT debit for Scan Pay (Supabase Postgres)
-- Run in Supabase SQL Editor after supabase/schema.sql / wallet_card_purchase.sql.
--
-- REQUIRED for atomic Scan Pay ledger on Supabase. Until applied, Express
-- falls back to Turso debitUsdt + user_wallets sync.

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  tx_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_usdt NUMERIC(18, 4) NOT NULL CHECK (amount_usdt > 0),
  balance_before NUMERIC(18, 4),
  balance_after NUMERIC(18, 4),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  reference_type TEXT,
  reference_id TEXT,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_journal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_transactions_journal_unique UNIQUE (journal_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user
  ON wallet_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usdt_scan_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  ref_code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  destination_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  amount_usdt NUMERIC(18, 4) NOT NULL CHECK (amount_usdt > 0),
  fee_usdt NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_debit_usdt NUMERIC(18, 4) NOT NULL,
  qr_payload TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  payout_status TEXT NOT NULL DEFAULT 'pending',
  payout_tx_hash TEXT,
  journal_id TEXT,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usdt_scan_payments_user
  ON usdt_scan_payments (user_id, created_at DESC);

-- Atomically verify balance, deduct, and insert completed debit log for Scan Pay.
CREATE OR REPLACE FUNCTION debit_usdt_for_scan_pay(
  p_user_id TEXT,
  p_amount NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet user_wallets%ROWTYPE;
  v_amount NUMERIC(18, 4);
  v_before NUMERIC(18, 4);
  v_after NUMERIC(18, 4);
  v_journal TEXT;
  v_existing wallet_transactions%ROWTYPE;
BEGIN
  v_amount := round(COALESCE(p_amount, 0)::numeric, 4);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Amount must be positive', 'code', 'INVALID_AMOUNT');
  END IF;

  v_journal := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  IF v_journal IS NULL THEN
    v_journal := 'SCAN-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8);
  END IF;

  SELECT * INTO v_existing FROM wallet_transactions WHERE journal_id = v_journal;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'journal_id', v_existing.journal_id,
      'amount_usdt', v_existing.amount_usdt,
      'balance_before', v_existing.balance_before,
      'balance_after', v_existing.balance_after,
      'status', v_existing.status
    );
  END IF;

  SELECT * INTO v_wallet
  FROM user_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found', 'code', 'WALLET_NOT_FOUND');
  END IF;

  IF COALESCE(v_wallet.is_blocked, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Wallet is blocked', 'code', 'WALLET_BLOCKED');
  END IF;

  v_before := round(COALESCE(v_wallet.balance_usdt, 0)::numeric, 4);
  IF v_before < v_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Insufficient USDT balance',
      'code', 'INSUFFICIENT_USDT_BALANCE',
      'required_usdt', v_amount,
      'available_usdt', v_before
    );
  END IF;

  v_after := round(v_before - v_amount, 4);

  UPDATE user_wallets
  SET balance_usdt = v_after, updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO wallet_transactions (
    user_id, journal_id, tx_type, direction, amount_usdt,
    balance_before, balance_after, status, reference_type,
    description, metadata
  ) VALUES (
    p_user_id, v_journal, 'scan_pay', 'debit', v_amount,
    v_before, v_after, 'completed', 'usdt_scan_pay',
    COALESCE(p_description, 'Scan Pay USDT payment'),
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'journal_id', v_journal,
    'amount_usdt', v_amount,
    'balance_before', v_before,
    'balance_after', v_after,
    'status', 'completed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION debit_usdt_for_scan_pay(TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
