/**
 * Real-time Kripicard issuance → persist to Supabase user_cards.
 */
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { createExternalCard } = require('./kripicard');

function validateIssueInput({
  userId,
  nameOnCard,
  bin,
  amount,
} = {}) {
  const errors = [];

  if (userId === undefined || userId === null || String(userId).trim() === '') {
    errors.push({ field: 'user_id', code: 'USER_REQUIRED', message: 'user_id is required' });
  }

  const name = String(nameOnCard || '').trim();
  if (name.length < 2) {
    errors.push({
      field: 'name_on_card',
      code: 'INVALID_NAME_ON_CARD',
      message: 'name_on_card must be at least 2 characters',
    });
  }

  const binValue = String(bin || '').trim();
  if (!binValue) {
    errors.push({ field: 'bin', code: 'INVALID_BIN', message: 'bin is required' });
  }

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    errors.push({
      field: 'amount',
      code: 'INVALID_AMOUNT',
      message: 'amount must be a positive number',
    });
  }

  if (errors.length) {
    const err = new Error(errors[0].message);
    err.code = errors[0].code;
    err.errors = errors;
    throw err;
  }

  return {
    userId: String(userId).trim(),
    nameOnCard: name,
    bin: binValue,
    amount: amountNum,
  };
}

/**
 * Card issuance is USD/USDT only — reject MMK and other fiat wallets.
 * Stored purchase_currency is normalized to USD (1 USDT ≈ 1 USD).
 */
function resolveIssuanceCurrency(raw) {
  const value = String(raw || 'USD').trim().toUpperCase();
  if (!value || value === 'USD' || value === 'USDT') {
    return 'USD';
  }
  if (value === 'MMK' || value === 'KS' || value === 'KYAT') {
    const err = new Error(
      'Card issuance accepts USD/USDT only. MMK wallet and bank deposits are not supported.'
    );
    err.code = 'USDT_ONLY_CARD_ISSUANCE';
    throw err;
  }
  const err = new Error(`Unsupported card issuance currency: ${value}. Use USD or USDT.`);
  err.code = 'USDT_ONLY_CARD_ISSUANCE';
  throw err;
}

/**
 * Find an existing user_cards row for the same payment/idempotency key.
 */
async function findByIdempotencyKey(supabase, userId, idempotencyKey) {
  if (!idempotencyKey) return null;

  const { data, error } = await supabase
    .from('user_cards')
    .select('*')
    .eq('user_id', String(userId))
    .contains('metadata', { idempotency_key: String(idempotencyKey) })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // contains() may fail on older schemas — ignore and proceed without dedupe
    console.warn('[cardIssue] idempotency lookup skipped:', error.message);
    return null;
  }
  return data || null;
}

/**
 * Persist a successfully created provider card into user_cards.
 */
async function storeIssuedCard({
  userId,
  card,
  amount,
  currency = 'USD',
  bin,
  metadata = {},
  supabase,
} = {}) {
  const db = supabase || getSupabaseAdmin();

  const row = {
    user_id: String(userId),
    pool_id: null,
    card_id: card.card_id,
    card_number: card.card_number,
    cvv: card.cvv,
    exp_date: card.exp_date,
    cardholder_name: card.cardholder_name,
    brand: card.brand,
    currency: card.currency || currency || 'USD',
    balance: card.balance ?? amount ?? 0,
    status: 'active',
    purchase_amount: amount ?? null,
    purchase_currency: currency || 'USD',
    metadata: {
      provider: 'kripicard',
      bin: bin || card.bin || null,
      issuance_mode: 'realtime_createcard',
      ...metadata,
    },
    updated_at: new Date().toISOString(),
  };

  // Prefer upsert on (user_id, card_id) unique constraint
  const { data, error } = await db
    .from('user_cards')
    .upsert(row, { onConflict: 'user_id,card_id' })
    .select('*')
    .single();

  if (error) {
    // Fallback insert if upsert conflict target not available
    const { data: inserted, error: insertError } = await db
      .from('user_cards')
      .insert(row)
      .select('*')
      .single();

    if (insertError) {
      throw Object.assign(new Error(insertError.message || error.message), {
        code: insertError.code || error.code || 'USER_CARD_STORE_FAILED',
        details: insertError.details || error.details,
        hint: insertError.hint || error.hint,
      });
    }
    return inserted;
  }

  return data;
}

/**
 * End-to-end: validate → call Kripicard createcard → store in user_cards.
 */
async function issueCardForUser(input = {}) {
  const validated = validateIssueInput(input);
  const currency = resolveIssuanceCurrency(input.currency || input.purchase_currency);
  const db = input.supabase || getSupabaseAdmin();

  const idempotencyKey =
    input.idempotencyKey
    || input.paymentRef
    || (input.metadata && input.metadata.idempotency_key)
    || null;

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(db, validated.userId, idempotencyKey);
    if (existing) {
      return {
        user_card: existing,
        provider_card: null,
        reused: true,
      };
    }
  }

  const created = await createExternalCard({
    nameOnCard: validated.nameOnCard,
    bin: validated.bin,
    amount: validated.amount,
    extra: input.extra || {},
    timeoutMs: input.timeoutMs,
  });

  const userCard = await storeIssuedCard({
    userId: validated.userId,
    card: created.card,
    amount: validated.amount,
    currency,
    bin: validated.bin,
    metadata: {
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
      idempotency_key: idempotencyKey || undefined,
      payment_ref: input.paymentRef || undefined,
      payment_wallet: 'usdt',
      exchange_rate_applied: false,
      kripicard_request: created.request,
    },
    supabase: db,
  });

  return {
    user_card: userCard,
    provider_card: created.card,
    raw: created.raw,
    reused: false,
  };
}

function publicUserCard(card) {
  if (!card) return null;
  const meta = card.metadata && typeof card.metadata === 'object' ? card.metadata : {};
  return {
    id: card.id,
    user_id: card.user_id,
    card_id: card.card_id,
    card_number: card.card_number,
    cvv: card.cvv,
    exp_date: card.exp_date,
    cardholder_name: card.cardholder_name,
    brand: card.brand,
    bin: meta.bin || null,
    currency: card.currency,
    balance: card.balance,
    status: card.status,
    purchase_amount: card.purchase_amount,
    purchase_currency: card.purchase_currency,
    created_at: card.created_at,
  };
}

module.exports = {
  validateIssueInput,
  resolveIssuanceCurrency,
  storeIssuedCard,
  issueCardForUser,
  findByIdempotencyKey,
  publicUserCard,
};
