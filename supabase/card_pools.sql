-- Eisy Myanmar — Kripicard card inventory + issued cards
-- Run in Supabase SQL Editor (after supabase/schema.sql if starting fresh).
--
-- Flows:
-- A) Pool Model: admin fetches blank cards → card_pools (available)
--    → purchase assigns one row + inserts user_cards
-- B) Real-time issue: POST createcard (name_on_card, bin, amount, api_key)
--    → store directly in user_cards (pool_id null)

CREATE TABLE IF NOT EXISTS card_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id TEXT NOT NULL,
  card_number TEXT,
  cvv TEXT,
  exp_date TEXT,
  exp_month TEXT,
  exp_year TEXT,
  cardholder_name TEXT,
  brand TEXT,
  bin TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'assigned', 'disabled', 'exhausted')),
  provider TEXT NOT NULL DEFAULT 'kripicard',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to_user_id TEXT,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT card_pools_card_id_unique UNIQUE (card_id)
);

CREATE INDEX IF NOT EXISTS idx_card_pools_status ON card_pools (status);
CREATE INDEX IF NOT EXISTS idx_card_pools_provider ON card_pools (provider);
CREATE INDEX IF NOT EXISTS idx_card_pools_available
  ON card_pools (created_at ASC)
  WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_card_pools_assigned_user
  ON card_pools (assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  pool_id UUID REFERENCES card_pools (id) ON DELETE SET NULL,
  card_id TEXT NOT NULL,
  card_number TEXT,
  cvv TEXT,
  exp_date TEXT,
  cardholder_name TEXT,
  brand TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'suspended', 'cancelled', 'expired')),
  purchase_amount NUMERIC(18, 4),
  purchase_currency TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_cards_user_card_unique UNIQUE (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards (user_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_card_id ON user_cards (card_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_status ON user_cards (status);
CREATE INDEX IF NOT EXISTS idx_user_cards_created ON user_cards (created_at DESC);

CREATE OR REPLACE FUNCTION set_card_pool_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_card_pools_updated_at ON card_pools;
CREATE TRIGGER trg_card_pools_updated_at
  BEFORE UPDATE ON card_pools
  FOR EACH ROW
  EXECUTE PROCEDURE set_card_pool_updated_at();

DROP TRIGGER IF EXISTS trg_user_cards_updated_at ON user_cards;
CREATE TRIGGER trg_user_cards_updated_at
  BEFORE UPDATE ON user_cards
  FOR EACH ROW
  EXECUTE PROCEDURE set_card_pool_updated_at();

-- Atomically pick one available pool card, mark assigned, and create user_cards row.
-- Returns JSON: { ok, user_card, pool_card } or { ok:false, error, code }.
CREATE OR REPLACE FUNCTION assign_card_from_pool(
  p_user_id TEXT,
  p_purchase_amount NUMERIC DEFAULT NULL,
  p_purchase_currency TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_cardholder_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool card_pools%ROWTYPE;
  v_user_card user_cards%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_id is required', 'code', 'USER_REQUIRED');
  END IF;

  SELECT *
  INTO v_pool
  FROM card_pools
  WHERE status = 'available'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No available cards in pool', 'code', 'POOL_EMPTY');
  END IF;

  UPDATE card_pools
  SET
    status = 'assigned',
    assigned_to_user_id = p_user_id,
    assigned_at = NOW(),
    cardholder_name = COALESCE(NULLIF(trim(p_cardholder_name), ''), cardholder_name),
    updated_at = NOW()
  WHERE id = v_pool.id
  RETURNING * INTO v_pool;

  INSERT INTO user_cards (
    user_id,
    pool_id,
    card_id,
    card_number,
    cvv,
    exp_date,
    cardholder_name,
    brand,
    currency,
    balance,
    status,
    purchase_amount,
    purchase_currency,
    metadata
  ) VALUES (
    p_user_id,
    v_pool.id,
    v_pool.card_id,
    v_pool.card_number,
    v_pool.cvv,
    COALESCE(v_pool.exp_date, NULLIF(concat_ws('/', v_pool.exp_month, v_pool.exp_year), '')),
    COALESCE(NULLIF(trim(p_cardholder_name), ''), v_pool.cardholder_name),
    v_pool.brand,
    v_pool.currency,
    v_pool.balance,
    'active',
    p_purchase_amount,
    p_purchase_currency,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_user_card;

  RETURN jsonb_build_object(
    'ok', true,
    'user_card', to_jsonb(v_user_card),
    'pool_card', to_jsonb(v_pool)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Card already linked to this user',
      'code', 'ALREADY_ASSIGNED'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', SQLERRM,
      'code', 'ASSIGN_FAILED'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION assign_card_from_pool(TEXT, NUMERIC, TEXT, JSONB, TEXT) TO service_role;

ALTER TABLE card_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cards ENABLE ROW LEVEL SECURITY;

-- Service-role / server-side access (tighten before exposing anon clients).
DROP POLICY IF EXISTS "service_role_card_pools" ON card_pools;
CREATE POLICY "service_role_card_pools" ON card_pools FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_user_cards" ON user_cards;
CREATE POLICY "service_role_user_cards" ON user_cards FOR ALL USING (true) WITH CHECK (true);
