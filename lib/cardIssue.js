/**
 * Real-time Bitnob virtual-card issuance → persist to Supabase user_cards.
 *
 * Requires a Bitnob Card KYC `customer_id` (per-user or BITNOB_DEFAULT_CUSTOMER_ID).
 * PAN/CVV are not returned on create — poll getCardDetails / use getSecureCardDetails.
 */

const { getSupabaseAdmin } = require('./supabaseAdmin');
const {
  createVirtualCard,
  getCardDetails,
  getSecureCardDetails,
  getBitnobConfig,
} = require('./bitnob');

function resolveBitnobCustomerId({ customerId, user } = {}) {
  const fromOpts = String(customerId || '').trim();
  if (fromOpts) return fromOpts;

  const fromUser =
    String(user?.bitnob_customer_id || '').trim()
    || String(user?.bitnobCustomerId || '').trim();
  if (fromUser) return fromUser;

  // Optional shared sandbox / company customer for early integration.
  const fromEnv = String(process.env.BITNOB_DEFAULT_CUSTOMER_ID || '').trim();
  if (fromEnv) return fromEnv;

  return null;
}

function assertBitnobConfigured() {
  const { clientId, clientSecret } = getBitnobConfig();
  if (!clientId || !clientSecret || clientSecret.includes('...')) {
    const err = new Error(
      'Bitnob API credentials are not configured (BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET)'
    );
    err.code = 'BITNOB_NOT_CONFIGURED';
    throw err;
  }
}

function validateIssueInput({
  userId,
  nameOnCard,
  amount,
  customerId,
  user,
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

  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    errors.push({
      field: 'amount',
      code: 'INVALID_AMOUNT',
      message: 'amount must be a positive number',
    });
  }

  const resolvedCustomerId = resolveBitnobCustomerId({ customerId, user });
  if (!resolvedCustomerId) {
    errors.push({
      field: 'customer_id',
      code: 'BITNOB_CUSTOMER_REQUIRED',
      message:
        'Bitnob customer_id is required. Complete Card KYC first, or set BITNOB_DEFAULT_CUSTOMER_ID.',
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
    amount: amountNum,
    customerId: resolvedCustomerId,
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
    console.warn('[cardIssue] idempotency lookup skipped:', error.message);
    return null;
  }
  return data || null;
}

/**
 * Persist a Bitnob card into Supabase `user_cards`.
 * Sensitive PAN/CVV are usually absent until secure-details is fetched.
 */
async function storeIssuedCard({
  userId,
  card,
  amount,
  currency = 'USD',
  customerId = null,
  metadata = {},
  providerRaw = null,
  supabase,
} = {}) {
  const db = supabase || getSupabaseAdmin();

  const row = {
    user_id: String(userId),
    pool_id: null,
    card_id: card.card_id,
    card_number: card.card_number || card.masked_pan || null,
    cvv: card.cvv || null,
    exp_date: card.exp_date || null,
    cardholder_name: card.cardholder_name || card.name || null,
    brand: card.brand || 'visa',
    currency: card.currency || card.balance_currency || currency || 'USD',
    balance: card.balance ?? card.balance_usd ?? amount ?? 0,
    status: card.status === 'active' ? 'active' : (card.status || 'pending'),
    purchase_amount: amount ?? null,
    purchase_currency: currency || 'USD',
    metadata: {
      provider: 'bitnob',
      customer_id: customerId || card.customer_id || null,
      issuance_mode: 'realtime_bitnob',
      masked_pan: card.masked_pan || null,
      created_status: card.created_status || null,
      provider_raw: providerRaw || card.raw || null,
      ...metadata,
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('user_cards')
    .upsert(row, { onConflict: 'user_id,card_id' })
    .select('*')
    .single();

  if (error) {
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
 * End-to-end: validate → Bitnob create → store in user_cards.
 */
async function issueCardForUser(input = {}) {
  assertBitnobConfigured();
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

  const created = await createVirtualCard({
    customerId: validated.customerId,
    name: validated.nameOnCard,
    amountUsd: validated.amount,
    currency,
    reference: idempotencyKey || undefined,
    webhookUrl: input.webhookUrl,
    contactlessPayment: input.contactlessPayment,
    createdBy: validated.userId,
    extra: input.extra || {},
    timeoutMs: input.timeoutMs,
  });

  const providerCard = {
    ...created.card,
    cardholder_name: created.card.name,
    balance: created.card.balance_usd,
    // Bitnob does not return full PAN on create.
    card_number: created.card.masked_pan || null,
    cvv: null,
    exp_date: null,
  };

  const userCard = await storeIssuedCard({
    userId: validated.userId,
    card: providerCard,
    amount: validated.amount,
    currency,
    customerId: validated.customerId,
    providerRaw: created.raw,
    metadata: {
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
      idempotency_key: idempotencyKey || undefined,
      payment_ref: input.paymentRef || undefined,
      payment_wallet: 'usdt',
      exchange_rate_applied: false,
      bitnob_request: created.request,
    },
    supabase: db,
  });

  return {
    user_card: userCard,
    provider_card: providerCard,
    raw: created.raw,
    reused: false,
  };
}

/** Alias used by admin / Next issue routes. */
async function createAndPersistBitnobCard(opts = {}) {
  return issueCardForUser(opts);
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
    customer_id: meta.customer_id || null,
    currency: card.currency,
    balance: card.balance,
    status: card.status,
    purchase_amount: card.purchase_amount,
    purchase_currency: card.purchase_currency,
    provider: meta.provider || 'bitnob',
    created_at: card.created_at,
  };
}

module.exports = {
  resolveBitnobCustomerId,
  assertBitnobConfigured,
  validateIssueInput,
  resolveIssuanceCurrency,
  storeIssuedCard,
  issueCardForUser,
  createAndPersistBitnobCard,
  findByIdempotencyKey,
  publicUserCard,
  getCardDetails,
  getSecureCardDetails,
};
