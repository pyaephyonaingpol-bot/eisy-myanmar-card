-- Eisy Myanmar — atomic USDT wallet debits for card purchase (Supabase Postgres)
-- Run in Supabase SQL Editor after supabase/schema.sql.
--
-- Flow (application layer):
--   1. debit_usdt_for_card_purchase  — balance check + deduct + pending log (single txn)
--   2. Kripicard API issue           — external call after RPC succeeds
--   3. finalize_card_purchase_wallet — completed OR refunded (compensating credit)

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

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status
  ON wallet_transactions (status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_related
  ON wallet_transactions (related_journal_id)
  WHERE related_journal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_wallet_transaction_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_transactions_updated_at ON wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_updated_at
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW
  EXECUTE PROCEDURE set_wallet_transaction_updated_at();

-- Atomically verify balance, deduct total charge, and insert pending debit log.
CREATE OR REPLACE FUNCTION debit_usdt_for_card_purchase(
  p_user_id TEXT,
  p_total_amount NUMERIC,
  p_kripicard_cost NUMERIC DEFAULT NULL,
  p_platform_markup NUMERIC DEFAULT NULL,
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
  v_tx wallet_transactions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_id is required', 'code', 'USER_REQUIRED');
  END IF;

  v_amount := round(COALESCE(p_total_amount, 0)::numeric, 4);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount must be positive', 'code', 'INVALID_AMOUNT');
  END IF;

  v_journal := COALESCE(NULLIF(trim(p_idempotency_key), ''), gen_random_uuid()::text);

  SELECT * INTO v_existing
  FROM wallet_transactions
  WHERE journal_id = v_journal
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.status IN ('pending', 'completed') THEN
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'journal_id', v_existing.journal_id,
        'transaction_id', v_existing.id,
        'balance_before', v_existing.balance_before,
        'balance_after', v_existing.balance_after,
        'amount_usdt', v_existing.amount_usdt,
        'status', v_existing.status
      );
    END IF;
    IF v_existing.status = 'refunded' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Idempotency key already used for a refunded purchase',
        'code', 'IDEMPOTENCY_CONSUMED'
      );
    END IF;
  END IF;

  SELECT * INTO v_wallet
  FROM user_wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found', 'code', 'WALLET_NOT_FOUND');
  END IF;

  v_before := round(COALESCE(v_wallet.balance_usdt, 0)::numeric, 4);
  IF v_before + 0.0001 < v_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Insufficient USDT balance. Required %s, available %s', v_amount, v_before),
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
    user_id,
    journal_id,
    tx_type,
    direction,
    amount_usdt,
    balance_before,
    balance_after,
    status,
    reference_type,
    description,
    metadata
  ) VALUES (
    p_user_id,
    v_journal,
    'card_purchase_debit',
    'debit',
    v_amount,
    v_before,
    v_after,
    'pending',
    'card_purchase',
    COALESCE(p_description, format('Card purchase debit %s USDT', v_amount)),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'kripicard_cost_usd', p_kripicard_cost,
      'platform_markup_usd', p_platform_markup,
      'purpose', 'card_issuance'
    )
  )
  RETURNING * INTO v_tx;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'journal_id', v_tx.journal_id,
    'transaction_id', v_tx.id,
    'balance_before', v_before,
    'balance_after', v_after,
    'amount_usdt', v_amount,
    'status', v_tx.status
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing FROM wallet_transactions WHERE journal_id = v_journal LIMIT 1;
    IF FOUND AND v_existing.status IN ('pending', 'completed') THEN
      RETURN jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'journal_id', v_existing.journal_id,
        'transaction_id', v_existing.id,
        'balance_before', v_existing.balance_before,
        'balance_after', v_existing.balance_after,
        'amount_usdt', v_existing.amount_usdt,
        'status', v_existing.status
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', 'DEBIT_FAILED');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', 'DEBIT_FAILED');
END;
$$;

-- Mark purchase debit completed after Kripicard succeeds, or refund on provider failure.
CREATE OR REPLACE FUNCTION finalize_card_purchase_wallet(
  p_journal_id TEXT,
  p_outcome TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debit wallet_transactions%ROWTYPE;
  v_wallet user_wallets%ROWTYPE;
  v_outcome TEXT;
  v_before NUMERIC(18, 4);
  v_after NUMERIC(18, 4);
  v_refund wallet_transactions%ROWTYPE;
  v_refund_journal TEXT;
BEGIN
  IF p_journal_id IS NULL OR length(trim(p_journal_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'journal_id is required', 'code', 'JOURNAL_REQUIRED');
  END IF;

  v_outcome := lower(trim(COALESCE(p_outcome, '')));
  IF v_outcome NOT IN ('completed', 'refunded') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'outcome must be completed or refunded', 'code', 'INVALID_OUTCOME');
  END IF;

  SELECT * INTO v_debit
  FROM wallet_transactions
  WHERE journal_id = trim(p_journal_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Purchase debit not found', 'code', 'DEBIT_NOT_FOUND');
  END IF;

  IF v_debit.tx_type <> 'card_purchase_debit' OR v_debit.direction <> 'debit' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid purchase debit record', 'code', 'INVALID_DEBIT');
  END IF;

  IF v_debit.status = 'completed' AND v_outcome = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outcome', 'completed',
      'journal_id', v_debit.journal_id,
      'balance_after', v_debit.balance_after
    );
  END IF;

  IF v_debit.status = 'refunded' AND v_outcome = 'refunded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'outcome', 'refunded',
      'journal_id', v_debit.journal_id,
      'refunded', true
    );
  END IF;

  IF v_debit.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format('Purchase debit is not pending (status=%s)', v_debit.status),
      'code', 'INVALID_DEBIT_STATUS'
    );
  END IF;

  IF v_outcome = 'completed' THEN
    UPDATE wallet_transactions
    SET
      status = 'completed',
      reference_id = COALESCE(p_reference_id, reference_id),
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb),
      updated_at = NOW()
    WHERE id = v_debit.id
    RETURNING * INTO v_debit;

    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'outcome', 'completed',
      'journal_id', v_debit.journal_id,
      'transaction_id', v_debit.id,
      'balance_after', v_debit.balance_after,
      'reference_id', v_debit.reference_id
    );
  END IF;

  -- Refund path: credit wallet back atomically with compensating ledger entry.
  SELECT * INTO v_wallet
  FROM user_wallets
  WHERE user_id = v_debit.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Wallet not found for refund', 'code', 'WALLET_NOT_FOUND');
  END IF;

  v_before := round(COALESCE(v_wallet.balance_usdt, 0)::numeric, 4);
  v_after := round(v_before + v_debit.amount_usdt, 4);

  UPDATE user_wallets
  SET balance_usdt = v_after, updated_at = NOW()
  WHERE user_id = v_debit.user_id;

  v_refund_journal := v_debit.journal_id || '-refund';

  INSERT INTO wallet_transactions (
    user_id,
    journal_id,
    tx_type,
    direction,
    amount_usdt,
    balance_before,
    balance_after,
    status,
    reference_type,
    reference_id,
    description,
    metadata,
    related_journal_id
  ) VALUES (
    v_debit.user_id,
    v_refund_journal,
    'card_purchase_refund',
    'credit',
    v_debit.amount_usdt,
    v_before,
    v_after,
    'completed',
    'card_purchase',
    p_reference_id,
    COALESCE(p_failure_reason, 'Card provider issuance failed — automatic refund'),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('refund_for', v_debit.journal_id),
    v_debit.journal_id
  )
  ON CONFLICT (journal_id) DO NOTHING
  RETURNING * INTO v_refund;

  IF NOT FOUND THEN
    SELECT * INTO v_refund FROM wallet_transactions WHERE journal_id = v_refund_journal LIMIT 1;
  END IF;

  UPDATE wallet_transactions
  SET
    status = 'refunded',
    metadata = metadata || jsonb_build_object(
      'refund_journal_id', v_refund.journal_id,
      'failure_reason', p_failure_reason
    ),
    updated_at = NOW()
  WHERE id = v_debit.id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'outcome', 'refunded',
    'journal_id', v_debit.journal_id,
    'refund_journal_id', v_refund.journal_id,
    'balance_before', v_before,
    'balance_after', v_after,
    'amount_usdt', v_debit.amount_usdt,
    'refunded', true
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM, 'code', 'FINALIZE_FAILED');
END;
$$;

GRANT EXECUTE ON FUNCTION debit_usdt_for_card_purchase(TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_card_purchase_wallet(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_wallet_transactions" ON wallet_transactions;
CREATE POLICY "service_role_wallet_transactions" ON wallet_transactions FOR ALL USING (true) WITH CHECK (true);
