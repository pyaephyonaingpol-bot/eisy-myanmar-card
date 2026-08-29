#!/usr/bin/env node
/**
 * Unit tests for Kripicard pool model helpers (no live network / Supabase required).
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function testNormalizeAndUnwrap() {
  section('kripicard normalize + unwrap');
  const {
    normalizePoolCard,
    unwrapCardList,
  } = require(path.join(ROOT, 'lib/kripicard'));

  assert.strictEqual(unwrapCardList(null).length, 0);
  assert.strictEqual(unwrapCardList([{ card_id: 'a' }]).length, 1);
  assert.strictEqual(unwrapCardList({ data: [{ id: 'b' }] }).length, 1);
  assert.strictEqual(unwrapCardList({ cards: [{ cardId: 'c' }] }).length, 1);
  assert.strictEqual(unwrapCardList({ data: { card_id: 'solo' } }).length, 1);

  const normalized = normalizePoolCard({
    card_id: 'kc-100',
    card_number: '4111111111111111',
    cvv: '123',
    exp_month: 9,
    exp_year: 2028,
    first_name: 'Aung',
    last_name: 'Min',
    brand: 'visa',
    bin: '411111',
    balance: 25,
  });

  assert.strictEqual(normalized.card_id, 'kc-100');
  assert.strictEqual(normalized.card_number, '4111111111111111');
  assert.strictEqual(normalized.cvv, '123');
  assert.strictEqual(normalized.exp_date, '09/28');
  assert.strictEqual(normalized.cardholder_name, 'Aung Min');
  assert.strictEqual(normalized.brand, 'visa');
  assert.strictEqual(normalized.provider, 'kripicard');
  assert.strictEqual(normalizePoolCard({ foo: 1 }), null);
  console.log('ok');
}

async function testFetchVirtualCards() {
  section('kripicard fetchVirtualCards with mocked fetch');
  process.env.KRIPICARD_API_KEY = 'test-kripicard-key';

  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.ok(String(url).includes('appapi.kripicard.com'));
    assert.strictEqual(opts.headers.Authorization, 'Bearer test-kripicard-key');
    assert.strictEqual(opts.headers['X-API-Key'], 'test-kripicard-key');
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          data: [
            {
              card_id: 'pool-1',
              pan: '4000000000000002',
              cvc: '456',
              expiry: '12/29',
              brand: 'visa',
            },
            { not_a_card: true },
          ],
        });
      },
    };
  };

  try {
    delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
    const { fetchVirtualCards } = require(path.join(ROOT, 'lib/kripicard'));
    const result = await fetchVirtualCards();
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.cards[0].card_id, 'pool-1');
    assert.strictEqual(result.cards[0].card_number, '4000000000000002');
    assert.strictEqual(result.cards[0].cvv, '456');
    console.log('ok');
  } finally {
    global.fetch = originalFetch;
  }
}

function createMemorySupabase(seed = []) {
  const rows = seed.map((r) => ({ ...r }));

  return {
    from(table) {
      if (table !== 'card_pools' && table !== 'user_cards') {
        throw new Error(`unexpected table ${table}`);
      }

      const state = {
        table,
        filters: [],
        orderAsc: true,
        limitN: null,
        payload: null,
        mode: 'select',
        countOnly: false,
      };

      const api = {
        select(cols, opts) {
          state.mode = 'select';
          state.countOnly = Boolean(opts && opts.head && opts.count === 'exact');
          state.selectCols = cols;
          return api;
        },
        insert(payload) {
          state.mode = 'insert';
          state.payload = Array.isArray(payload) ? payload : [payload];
          return api;
        },
        update(payload) {
          state.mode = 'update';
          state.payload = payload;
          return api;
        },
        eq(col, val) {
          state.filters.push({ type: 'eq', col, val });
          return api;
        },
        in(col, vals) {
          state.filters.push({ type: 'in', col, vals });
          return api;
        },
        not(col, op, val) {
          state.filters.push({ type: 'not', col, op, val });
          return api;
        },
        order(col, { ascending }) {
          state.orderCol = col;
          state.orderAsc = ascending !== false;
          return api;
        },
        limit(n) {
          state.limitN = n;
          return api;
        },
        maybeSingle() {
          return api.thenSingle(true);
        },
        single() {
          return api.thenSingle(false);
        },
        async thenSingle(allowNull) {
          const result = await api.execute();
          if (result.error) return result;
          const data = Array.isArray(result.data) ? result.data[0] : result.data;
          if (!data && !allowNull) {
            return { data: null, error: { message: 'not found', code: 'PGRST116' } };
          }
          return { data: data || null, error: null };
        },
        then(resolve, reject) {
          return api.execute().then(resolve, reject);
        },
        async execute() {
          const match = (row) =>
            state.filters.every((f) => {
              if (f.type === 'eq') return String(row[f.col]) === String(f.val);
              if (f.type === 'in') return f.vals.map(String).includes(String(row[f.col]));
              if (f.type === 'not' && f.op === 'is' && f.val == null) {
                return row[f.col] != null;
              }
              return true;
            });

          if (state.table === 'card_pools') {
            if (state.mode === 'select') {
              let list = rows.filter(match);
              if (state.orderCol) {
                list = list.sort((a, b) => {
                  const av = a[state.orderCol];
                  const bv = b[state.orderCol];
                  if (av < bv) return state.orderAsc ? -1 : 1;
                  if (av > bv) return state.orderAsc ? 1 : -1;
                  return 0;
                });
              }
              if (state.limitN != null) list = list.slice(0, state.limitN);
              if (state.countOnly) {
                return { data: null, count: list.length, error: null };
              }
              return { data: list.map((r) => ({ ...r })), error: null, count: list.length };
            }

            if (state.mode === 'insert') {
              for (const item of state.payload) {
                if (rows.some((r) => r.card_id === item.card_id)) {
                  return { data: null, error: { message: 'duplicate', code: '23505' } };
                }
                rows.push({
                  id: item.id || `pool-${rows.length + 1}`,
                  assigned_to_user_id: null,
                  assigned_at: null,
                  created_at: item.created_at || new Date().toISOString(),
                  ...item,
                });
              }
              return { data: state.payload, error: null };
            }

            if (state.mode === 'update') {
              const updated = [];
              for (const row of rows) {
                if (!match(row)) continue;
                Object.assign(row, state.payload);
                updated.push({ ...row });
              }
              return { data: updated, error: null };
            }
          }

          if (state.table === 'user_cards') {
            if (!api._userCards) api._userCards = [];
            // store on outer closure via rows is wrong — use function-level store
          }

          return { data: null, error: { message: 'unhandled' } };
        },
      };

      // Attach user_cards store on the supabase object
      if (!api._parent) {
        /* noop */
      }

      return api;
    },
    async rpc(name, args) {
      if (name !== 'assign_card_from_pool') {
        return { data: null, error: { message: 'unknown rpc', code: 'PGRST202' } };
      }
      // Simulate RPC using fallback logic path by returning missing function,
      // so assignCardToUser uses assignCardToUserFallback against memory DB.
      return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
    },
    _rows: rows,
  };
}

async function testUpsertAndAssign() {
  section('cardPool upsert + assign fallback');

  // Richer in-memory supabase for assign path
  const poolRows = [];
  const userCards = [];

  const supabase = {
    from(table) {
      const state = {
        table,
        filters: [],
        orderAsc: true,
        limitN: null,
        payload: null,
        mode: 'select',
        countOnly: false,
      };

      const match = (row) =>
        state.filters.every((f) => {
          if (f.type === 'eq') return String(row[f.col]) === String(f.val);
          if (f.type === 'in') return f.vals.map(String).includes(String(row[f.col]));
          return true;
        });

      const api = {
        select(_cols, opts) {
          // PostgREST: .update().select() returns updated rows; don't wipe update mode.
          if (state.mode === 'insert' || state.mode === 'update') {
            state.returning = true;
          } else {
            state.mode = 'select';
          }
          state.countOnly = Boolean(opts && opts.head && opts.count === 'exact');
          return api;
        },
        insert(payload) {
          state.mode = 'insert';
          state.payload = Array.isArray(payload) ? payload : [payload];
          return api;
        },
        update(payload) {
          state.mode = 'update';
          state.payload = payload;
          return api;
        },
        eq(col, val) {
          state.filters.push({ type: 'eq', col, val });
          return api;
        },
        in(col, vals) {
          state.filters.push({ type: 'in', col, vals });
          return api;
        },
        order(col, { ascending } = {}) {
          state.orderCol = col;
          state.orderAsc = ascending !== false;
          return api;
        },
        limit(n) {
          state.limitN = n;
          return api;
        },
        maybeSingle() {
          return api.exec().then((r) => {
            if (r.error) return r;
            const data = Array.isArray(r.data) ? r.data[0] || null : r.data;
            return { data, error: null };
          });
        },
        single() {
          return api.exec().then((r) => {
            if (r.error) return r;
            const data = Array.isArray(r.data) ? r.data[0] : r.data;
            if (!data) return { data: null, error: { message: 'not found', code: 'PGRST116' } };
            return { data, error: null };
          });
        },
        then(resolve, reject) {
          return api.exec().then(resolve, reject);
        },
        async exec() {
          const store = table === 'card_pools' ? poolRows : userCards;

          if (state.mode === 'select') {
            let list = store.filter(match);
            if (state.orderCol) {
              list.sort((a, b) => {
                const av = a[state.orderCol];
                const bv = b[state.orderCol];
                if (av < bv) return state.orderAsc ? -1 : 1;
                if (av > bv) return state.orderAsc ? 1 : -1;
                return 0;
              });
            }
            if (state.limitN != null) list = list.slice(0, state.limitN);
            if (state.countOnly) return { data: null, count: list.length, error: null };
            return { data: list.map((r) => ({ ...r })), error: null };
          }

          if (state.mode === 'insert') {
            const inserted = [];
            for (const item of state.payload) {
              if (table === 'card_pools' && store.some((r) => r.card_id === item.card_id)) {
                return { data: null, error: { message: 'duplicate', code: '23505' } };
              }
              const row = {
                id: `${table}-${store.length + 1}`,
                created_at: new Date().toISOString(),
                ...item,
              };
              store.push(row);
              inserted.push({ ...row });
            }
            return { data: inserted, error: null };
          }

          if (state.mode === 'update') {
            const updated = [];
            for (const row of store) {
              if (!match(row)) continue;
              Object.assign(row, state.payload);
              updated.push({ ...row });
            }
            return { data: updated, error: null };
          }

          return { data: null, error: { message: 'unhandled mode' } };
        },
      };

      return api;
    },
    async rpc() {
      return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
    },
  };

  delete require.cache[require.resolve(path.join(ROOT, 'lib/cardPool'))];
  const {
    upsertCardsIntoPool,
    assignCardToUser,
  } = require(path.join(ROOT, 'lib/cardPool'));

  const first = await upsertCardsIntoPool(
    [
      {
        card_id: 'kc-1',
        card_number: '4111111111111111',
        cvv: '111',
        exp_date: '01/30',
        brand: 'visa',
        currency: 'USD',
        balance: 0,
        provider: 'kripicard',
        raw_payload: { card_id: 'kc-1' },
      },
      {
        card_id: 'kc-2',
        card_number: '4000000000000002',
        cvv: '222',
        exp_date: '02/30',
        brand: 'visa',
        currency: 'USD',
        balance: 10,
        provider: 'kripicard',
        raw_payload: { card_id: 'kc-2' },
      },
    ],
    { supabase }
  );

  assert.strictEqual(first.inserted, 2);
  assert.strictEqual(first.available, 2);
  assert.strictEqual(poolRows[0].status, 'available');

  // Re-upsert should update details, not duplicate
  const second = await upsertCardsIntoPool(
    [
      {
        card_id: 'kc-1',
        card_number: '4111111111111111',
        cvv: '999',
        exp_date: '01/31',
        brand: 'visa',
        currency: 'USD',
        balance: 5,
        provider: 'kripicard',
        raw_payload: { card_id: 'kc-1', refreshed: true },
      },
    ],
    { supabase }
  );
  assert.strictEqual(second.inserted, 0);
  assert.strictEqual(second.updated, 1);
  assert.strictEqual(poolRows.find((r) => r.card_id === 'kc-1').cvv, '999');
  assert.strictEqual(poolRows.find((r) => r.card_id === 'kc-1').status, 'available');

  const assigned = await assignCardToUser({
    userId: '42',
    purchaseAmount: 15,
    purchaseCurrency: 'USD',
    cardholderName: 'Test User',
    supabase,
  });

  assert.strictEqual(assigned.user_card.user_id, '42');
  assert.strictEqual(assigned.user_card.card_id, 'kc-1');
  assert.strictEqual(assigned.pool_card.status, 'assigned');
  assert.strictEqual(poolRows.find((r) => r.card_id === 'kc-1').assigned_to_user_id, '42');
  assert.strictEqual(userCards.length, 1);

  // Second assign takes next available
  const assigned2 = await assignCardToUser({ userId: '43', supabase });
  assert.strictEqual(assigned2.user_card.card_id, 'kc-2');

  // Pool empty
  let emptyError = null;
  try {
    await assignCardToUser({ userId: '44', supabase });
  } catch (err) {
    emptyError = err;
  }
  assert.ok(emptyError);
  assert.strictEqual(emptyError.code, 'POOL_EMPTY');

  console.log('ok');
}

async function testRouteWiring() {
  section('Express route wiring present');
  const fs = require('fs');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
  const userSrc = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  const fetchRoute = fs.readFileSync(
    path.join(ROOT, 'app/api/admin/fetch-cards/route.js'),
    'utf8'
  );
  const purchaseRoute = fs.readFileSync(
    path.join(ROOT, 'app/api/cards/purchase/route.js'),
    'utf8'
  );
  const issueRoute = fs.readFileSync(
    path.join(ROOT, 'app/api/cards/issue/route.js'),
    'utf8'
  );

  assert.ok(adminSrc.includes("router.post('/fetch-cards'"));
  assert.ok(adminSrc.includes("router.post('/cards/assign-from-pool'"));
  assert.ok(userSrc.includes("router.post('/cards/purchase'"));
  assert.ok(userSrc.includes("router.post('/cards/issue'"));
  assert.ok(fetchRoute.includes('fetchAndStorePoolCards'));
  assert.ok(purchaseRoute.includes('assignCardToUser'));
  assert.ok(issueRoute.includes('issueCardForUser'));
  assert.ok(issueRoute.includes('createcard') || issueRoute.includes('createExternalCard') || issueRoute.includes('name_on_card'));
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase/card_pools.sql')));
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/cardIssue.js')));
  console.log('ok');
}

async function testCreateExternalCard() {
  section('createExternalCard posts name_on_card, bin, amount, api_key');
  process.env.KRIPICARD_API_KEY = 'test-kripicard-key';
  delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];

  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          success: true,
          message: 'Card created',
          data: {
            card_id: 'created-99',
            card_number: '4111111111111111',
            cvv: '321',
            exp_date: '11/30',
            name_on_card: 'Aung Min',
            bin: 428803,
            balance: 25,
          },
        });
      },
    };
  };

  try {
    const { createExternalCard } = require(path.join(ROOT, 'lib/kripicard'));
    const result = await createExternalCard({
      nameOnCard: 'Aung Min',
      bin: '428803',
      amount: 25,
    });

    assert.ok(captured.url.includes('/api/external/cards/createcard'));
    assert.strictEqual(captured.opts.method, 'POST');
    const body = JSON.parse(captured.opts.body);
    assert.strictEqual(body.api_key, 'test-kripicard-key');
    assert.strictEqual(body.name_on_card, 'Aung Min');
    assert.strictEqual(body.bin, 428803);
    assert.strictEqual(body.amount, 25);
    assert.strictEqual(result.card.card_id, 'created-99');
    assert.strictEqual(result.card.cardholder_name, 'Aung Min');
    console.log('ok');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testIssueCardForUser() {
  section('issueCardForUser stores into user_cards');
  process.env.KRIPICARD_API_KEY = 'test-kripicard-key';
  delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/cardIssue'))];

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        card_id: 'live-1',
        pan: '4000000000000002',
        cvc: '111',
        expiry: '12/31',
        brand: 'visa',
      });
    },
  });

  const userCards = [];
  const supabase = {
    from(table) {
      assert.strictEqual(table, 'user_cards');
      const state = { mode: 'select', filters: [], payload: null };
      const api = {
        select() { return api; },
        contains() { return api; },
        eq(col, val) { state.filters.push({ col, val }); return api; },
        order() { return api; },
        limit() { return api; },
        upsert(payload) {
          state.mode = 'upsert';
          state.payload = payload;
          return api;
        },
        insert(payload) {
          state.mode = 'insert';
          state.payload = payload;
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return api.exec().then((r) => {
            if (r.error) return r;
            const data = Array.isArray(r.data) ? r.data[0] : r.data;
            return { data, error: null };
          });
        },
        then(resolve, reject) {
          return api.exec().then(resolve, reject);
        },
        async exec() {
          if (state.mode === 'upsert' || state.mode === 'insert') {
            const row = {
              id: `user_cards-${userCards.length + 1}`,
              created_at: new Date().toISOString(),
              ...state.payload,
            };
            userCards.push(row);
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };

  try {
    const { issueCardForUser, validateIssueInput } = require(path.join(ROOT, 'lib/cardIssue'));

    let validationErr = null;
    try {
      validateIssueInput({ userId: '1', nameOnCard: 'A', bin: '1', amount: 10 });
    } catch (err) {
      validationErr = err;
    }
    assert.ok(validationErr);
    assert.strictEqual(validationErr.code, 'INVALID_NAME_ON_CARD');

    const result = await issueCardForUser({
      userId: '7',
      nameOnCard: 'Maung Maung',
      bin: '428803',
      amount: 20,
      paymentRef: 'pay-100',
      supabase,
    });

    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.user_card.user_id, '7');
    assert.strictEqual(result.user_card.card_id, 'live-1');
    assert.strictEqual(result.user_card.metadata.idempotency_key, 'pay-100');
    assert.strictEqual(userCards.length, 1);
    console.log('ok');
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  await testNormalizeAndUnwrap();
  await testFetchVirtualCards();
  await testCreateExternalCard();
  await testIssueCardForUser();
  await testUpsertAndAssign();
  await testRouteWiring();
  console.log('\nAll card pool tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
