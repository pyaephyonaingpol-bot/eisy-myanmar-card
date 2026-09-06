#!/usr/bin/env node
/**
 * Direct Kripicard createcard integration:
 *   POST + Authorization / X-API-Key headers → normalize response → upsert Supabase user_cards
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function mockSupabase(userCards) {
  return {
    from(table) {
      assert.strictEqual(table, 'user_cards');
      const state = { mode: 'select', payload: null };
      const api = {
        select() {
          return api;
        },
        contains() {
          return api;
        },
        eq() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          return api;
        },
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
}

async function testCreatecardPostAndAuthHeaders() {
  section('createExternalCard POST + auth headers + body');
  process.env.KRIPICARD_API_KEY = 'kc-integration-key';
  delete process.env.KRIPICARD_CREATE_CARD_URL;
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
          data: {
            card_id: 'kc-card-42',
            card_number: '5395020011223344',
            cvv: '987',
            exp_date: '09/28',
            name_on_card: 'Su Su',
            bin: 539502,
            balance: 15,
            brand: 'mastercard',
          },
        });
      },
    };
  };

  try {
    const { createExternalCard } = require(path.join(ROOT, 'lib/kripicard'));
    const result = await createExternalCard({
      nameOnCard: 'Su Su',
      bin: '539502',
      amount: 15,
    });

    assert.ok(
      captured.url.includes('/api/external/cards/createcard'),
      'createcard endpoint'
    );
    assert.strictEqual(captured.opts.method, 'POST');

    const headers = captured.opts.headers || {};
    assert.strictEqual(headers.Authorization, 'Bearer kc-integration-key');
    assert.strictEqual(headers['X-API-Key'], 'kc-integration-key');
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers.Accept, 'application/json');

    const body = JSON.parse(captured.opts.body);
    assert.deepStrictEqual(body, {
      api_key: 'kc-integration-key',
      name_on_card: 'Su Su',
      bin: 539502,
      amount: 15,
    });

    assert.strictEqual(result.card.card_id, 'kc-card-42');
    assert.strictEqual(result.card.card_number, '5395020011223344');
    assert.strictEqual(result.card.cvv, '987');
    assert.strictEqual(result.card.exp_date, '09/28');
    assert.strictEqual(result.card.cardholder_name, 'Su Su');
    assert.strictEqual(result.card.balance, 15);
    assert.ok(result.raw && result.raw.success === true);
    assert.deepStrictEqual(result.request, {
      name_on_card: 'Su Su',
      bin: '539502',
      amount: 15,
    });
    console.log('ok');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testCreateAndPersistToSupabase() {
  section('createAndPersistKripicardCard saves issued details to user_cards');
  process.env.KRIPICARD_API_KEY = 'kc-integration-key';
  delete require.cache[require.resolve(path.join(ROOT, 'lib/kripicard'))];
  delete require.cache[require.resolve(path.join(ROOT, 'lib/cardIssue'))];

  const providerPayload = {
    success: true,
    data: {
      card_id: 'kc-persist-7',
      card_number: '5258479988776655',
      cvv: '456',
      exp_date: '03/29',
      name_on_card: 'Ko Ko',
      bin: 525847,
      balance: 30,
      brand: 'mastercard',
    },
  };

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(providerPayload);
    },
  });

  const userCards = [];
  const supabase = mockSupabase(userCards);

  try {
    const {
      createAndPersistKripicardCard,
      publicUserCard,
    } = require(path.join(ROOT, 'lib/cardIssue'));

    const result = await createAndPersistKripicardCard({
      userId: 'user-88',
      nameOnCard: 'Ko Ko',
      bin: '525847',
      amount: 30,
      currency: 'USDT',
      metadata: { source: 'integration_test' },
      supabase,
    });

    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.provider_card.card_id, 'kc-persist-7');
    assert.strictEqual(userCards.length, 1);

    const row = result.user_card;
    assert.strictEqual(row.user_id, 'user-88');
    assert.strictEqual(row.card_id, 'kc-persist-7');
    assert.strictEqual(row.card_number, '5258479988776655');
    assert.strictEqual(row.cvv, '456');
    assert.strictEqual(row.exp_date, '03/29');
    assert.strictEqual(row.cardholder_name, 'Ko Ko');
    assert.strictEqual(row.balance, 30);
    assert.strictEqual(row.status, 'active');
    assert.strictEqual(row.purchase_amount, 30);
    assert.strictEqual(row.purchase_currency, 'USD');
    assert.strictEqual(row.metadata.provider, 'kripicard');
    assert.strictEqual(row.metadata.issuance_mode, 'realtime_createcard');
    assert.strictEqual(row.metadata.bin, '525847');
    assert.strictEqual(row.metadata.source, 'integration_test');
    assert.strictEqual(row.metadata.payment_wallet, 'usdt');
    assert.deepStrictEqual(row.metadata.provider_raw, providerPayload);
    assert.deepStrictEqual(row.metadata.kripicard_request, {
      name_on_card: 'Ko Ko',
      bin: '525847',
      amount: 30,
    });

    const pub = publicUserCard(row);
    assert.strictEqual(pub.card_id, 'kc-persist-7');
    assert.strictEqual(pub.bin, '525847');
    console.log('ok');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testExpressServiceExport() {
  section('Express cardIssueService exports createAndPersistKripicardCard');
  const service = require(path.join(ROOT, 'backend/src/services/cardIssueService'));
  assert.strictEqual(typeof service.createAndPersistKripicardCard, 'function');
  assert.strictEqual(typeof service.issueCardForUser, 'function');
  assert.strictEqual(typeof service.storeIssuedCard, 'function');
  console.log('ok');
}

async function main() {
  await testCreatecardPostAndAuthHeaders();
  await testCreateAndPersistToSupabase();
  await testExpressServiceExport();
  console.log('\nAll Kripicard createcard integration tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
