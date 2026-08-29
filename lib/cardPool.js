/**
 * Card pool helpers — upsert from Kripicard + assign to buyers.
 */
const { getSupabaseAdmin } = require('./supabaseAdmin');
const { fetchVirtualCards } = require('./kripicard');

const UPSERT_CHUNK_SIZE = 100;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function summarizeCards(cards) {
  return cards.map((c) => ({
    card_id: c.card_id,
    brand: c.brand,
    bin: c.bin,
    currency: c.currency,
    balance: c.balance,
    card_number_last4: c.card_number ? String(c.card_number).slice(-4) : null,
  }));
}

/**
 * Upsert cards into card_pools without clobbering assignment lifecycle:
 * - New card_id → insert with status 'available'
 * - Existing card_id → update details only (status / assigned_* preserved)
 */
async function upsertCardsIntoPool(cards, { supabase } = {}) {
  const db = supabase || getSupabaseAdmin();
  if (!Array.isArray(cards) || cards.length === 0) {
    return { inserted: 0, updated: 0, upserted: 0, available: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (const batch of chunk(cards, UPSERT_CHUNK_SIZE)) {
    const cardIds = batch.map((c) => c.card_id);
    const { data: existing, error: existingError } = await db
      .from('card_pools')
      .select('card_id')
      .in('card_id', cardIds);

    if (existingError) {
      throw Object.assign(new Error(existingError.message), {
        code: existingError.code || 'POOL_LOOKUP_FAILED',
        details: existingError.details,
        hint: existingError.hint,
      });
    }

    const existingIds = new Set((existing || []).map((row) => row.card_id));
    const toInsert = [];
    const toUpdate = [];

    for (const card of batch) {
      const payload = {
        card_id: card.card_id,
        card_number: card.card_number,
        cvv: card.cvv,
        exp_date: card.exp_date,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        cardholder_name: card.cardholder_name,
        brand: card.brand,
        bin: card.bin,
        currency: card.currency || 'USD',
        balance: card.balance ?? 0,
        provider: card.provider || 'kripicard',
        raw_payload: card.raw_payload || {},
        updated_at: new Date().toISOString(),
      };

      if (!existingIds.has(card.card_id)) {
        toInsert.push({ ...payload, status: 'available' });
      } else {
        toUpdate.push(payload);
      }
    }

    if (toInsert.length) {
      const { error } = await db.from('card_pools').insert(toInsert);
      if (error) {
        // Concurrent insert race → treat as update path for duplicates
        if (error.code === '23505') {
          for (const row of toInsert) {
            const { status: _status, ...updatePayload } = row;
            const { error: updateError } = await db
              .from('card_pools')
              .update(updatePayload)
              .eq('card_id', row.card_id);
            if (updateError) {
              throw Object.assign(new Error(updateError.message), {
                code: updateError.code || 'POOL_UPDATE_FAILED',
              });
            }
            updated += 1;
          }
        } else {
          throw Object.assign(new Error(error.message), {
            code: error.code || 'POOL_INSERT_FAILED',
            details: error.details,
            hint: error.hint,
          });
        }
      } else {
        inserted += toInsert.length;
      }
    }

    for (const payload of toUpdate) {
      const { error } = await db
        .from('card_pools')
        .update(payload)
        .eq('card_id', payload.card_id);
      if (error) {
        throw Object.assign(new Error(error.message), {
          code: error.code || 'POOL_UPDATE_FAILED',
          details: error.details,
        });
      }
      updated += 1;
    }
  }

  const { count, error: countError } = await db
    .from('card_pools')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'available');

  if (countError) {
    throw Object.assign(new Error(countError.message), {
      code: countError.code || 'POOL_COUNT_FAILED',
    });
  }

  return {
    inserted,
    updated,
    upserted: inserted + updated,
    available: count ?? 0,
  };
}

/**
 * Fetch from Kripicard and upsert into card_pools (status: available for new rows).
 */
async function fetchAndStorePoolCards(options = {}) {
  const fetched = await fetchVirtualCards(options);
  const result = await upsertCardsIntoPool(fetched.cards, {
    supabase: options.supabase,
  });

  return {
    fetched: fetched.count,
    skipped_invalid: fetched.skipped,
    inserted: result.inserted,
    updated: result.updated,
    upserted: result.upserted,
    available_in_pool: result.available,
    cards: summarizeCards(fetched.cards),
  };
}

/**
 * Assign one available pool card to a user (atomic via Postgres RPC).
 */
async function assignCardToUser({
  userId,
  purchaseAmount = null,
  purchaseCurrency = null,
  metadata = {},
  cardholderName = null,
  supabase,
} = {}) {
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    const err = new Error('user_id is required');
    err.code = 'USER_REQUIRED';
    throw err;
  }

  const db = supabase || getSupabaseAdmin();
  const { data, error } = await db.rpc('assign_card_from_pool', {
    p_user_id: String(userId),
    p_purchase_amount: purchaseAmount,
    p_purchase_currency: purchaseCurrency,
    p_metadata: metadata || {},
    p_cardholder_name: cardholderName,
  });

  if (error) {
    // Missing RPC → optimistic fallback so environments without migration still work
    if (
      error.code === 'PGRST202' ||
      /Could not find the function|assign_card_from_pool/i.test(error.message || '')
    ) {
      return assignCardToUserFallback({
        userId,
        purchaseAmount,
        purchaseCurrency,
        metadata,
        cardholderName,
        supabase: db,
      });
    }

    throw Object.assign(new Error(error.message), {
      code: error.code || 'ASSIGN_RPC_FAILED',
      details: error.details,
      hint: error.hint,
    });
  }

  if (!data || data.ok !== true) {
    const err = new Error((data && data.error) || 'Card assignment failed');
    err.code = (data && data.code) || 'ASSIGN_FAILED';
    throw err;
  }

  return {
    user_card: data.user_card,
    pool_card: data.pool_card,
  };
}

/**
 * Optimistic-lock assign without RPC. Prefer assignCardToUser (uses RPC).
 */
async function assignCardToUserFallback({
  userId,
  purchaseAmount = null,
  purchaseCurrency = null,
  metadata = {},
  cardholderName = null,
  supabase,
} = {}) {
  if (userId === undefined || userId === null || String(userId).trim() === '') {
    const err = new Error('user_id is required');
    err.code = 'USER_REQUIRED';
    throw err;
  }

  const db = supabase || getSupabaseAdmin();
  const uid = String(userId);

  const { data: candidates, error: selectError } = await db
    .from('card_pools')
    .select('*')
    .eq('status', 'available')
    .order('created_at', { ascending: true })
    .limit(1);

  if (selectError) {
    throw Object.assign(new Error(selectError.message), {
      code: selectError.code || 'POOL_SELECT_FAILED',
    });
  }

  const candidate = candidates && candidates[0];
  if (!candidate) {
    const err = new Error('No available cards in pool');
    err.code = 'POOL_EMPTY';
    throw err;
  }

  const { data: locked, error: lockError } = await db
    .from('card_pools')
    .update({
      status: 'assigned',
      assigned_to_user_id: uid,
      assigned_at: new Date().toISOString(),
      cardholder_name: cardholderName || candidate.cardholder_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidate.id)
    .eq('status', 'available')
    .select('*')
    .maybeSingle();

  if (lockError) {
    throw Object.assign(new Error(lockError.message), {
      code: lockError.code || 'POOL_LOCK_FAILED',
    });
  }

  if (!locked) {
    const err = new Error('Card was claimed by another request — retry');
    err.code = 'POOL_RACE';
    throw err;
  }

  const expDate =
    locked.exp_date ||
    (locked.exp_month && locked.exp_year
      ? `${locked.exp_month}/${String(locked.exp_year).slice(-2)}`
      : null);

  const { data: userCard, error: insertError } = await db
    .from('user_cards')
    .insert({
      user_id: uid,
      pool_id: locked.id,
      card_id: locked.card_id,
      card_number: locked.card_number,
      cvv: locked.cvv,
      exp_date: expDate,
      cardholder_name: cardholderName || locked.cardholder_name,
      brand: locked.brand,
      currency: locked.currency,
      balance: locked.balance,
      status: 'active',
      purchase_amount: purchaseAmount,
      purchase_currency: purchaseCurrency,
      metadata: metadata || {},
    })
    .select('*')
    .single();

  if (insertError) {
    await db
      .from('card_pools')
      .update({
        status: 'available',
        assigned_to_user_id: null,
        assigned_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', locked.id)
      .eq('assigned_to_user_id', uid);

    throw Object.assign(new Error(insertError.message), {
      code: insertError.code || 'USER_CARD_INSERT_FAILED',
      details: insertError.details,
    });
  }

  return { user_card: userCard, pool_card: locked };
}

async function getPoolStats({ supabase } = {}) {
  const db = supabase || getSupabaseAdmin();
  const statuses = ['available', 'assigned', 'reserved', 'disabled', 'exhausted'];
  const stats = {};

  for (const status of statuses) {
    const { count, error } = await db
      .from('card_pools')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);
    if (error) {
      throw Object.assign(new Error(error.message), { code: error.code });
    }
    stats[status] = count ?? 0;
  }

  return stats;
}

module.exports = {
  upsertCardsIntoPool,
  fetchAndStorePoolCards,
  assignCardToUser,
  assignCardToUserFallback,
  getPoolStats,
};
