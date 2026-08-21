/**
 * Smoke tests for daily transaction CSV export helpers.
 * Run: node backend/scripts/test-transaction-csv-export.js
 */
'use strict';

require('../src/lib/loadEnv');
const assert = require('assert');
const {
  dayBoundsYangon,
  todayYangonDateString,
  toCsv,
  buildDailyTransactionsCsv,
} = require('../src/services/transactionCsvExportService');

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('day bounds Asia/Yangon');
  const bounds = dayBoundsYangon('2026-08-21');
  assert.strictEqual(bounds.timezone, 'Asia/Yangon');
  assert.ok(bounds.startIso.endsWith('Z'));
  // 2026-08-21 00:00 MMT = 2026-08-20 17:30 UTC
  assert.strictEqual(bounds.startIso, '2026-08-20T17:30:00.000Z');
  assert.strictEqual(bounds.endIso, '2026-08-21T17:29:59.999Z');
  console.log('ok', bounds.startIso, '→', bounds.endIso);

  section('todayYangonDateString shape');
  const today = todayYangonDateString();
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(today), today);
  console.log('ok', today);

  section('toCsv escaping');
  const csv = toCsv(['a', 'b'], [{ a: 'hello', b: 'x,y' }, { a: 'say "hi"', b: 'ok' }]);
  assert.ok(csv.includes('"x,y"'));
  assert.ok(csv.includes('"say ""hi"""'));
  console.log('ok');

  section('invalid date');
  let threw = false;
  try {
    dayBoundsYangon('21-08-2026');
  } catch (err) {
    threw = err.code === 'INVALID_DATE';
  }
  assert.ok(threw);
  console.log('ok');

  section('build nowpayments CSV (live Supabase if configured)');
  const { isSupabaseEnabled } = require('../src/lib/supabase');
  if (isSupabaseEnabled()) {
    const result = await buildDailyTransactionsCsv({
      date: today,
      source: 'nowpayments',
    });
    assert.ok(result.filename.includes(today));
    assert.ok(result.csv.startsWith('created_at,'));
    console.log('ok rows=', result.rowCount, 'file=', result.filename);
  } else {
    console.log('skip — Supabase not configured');
  }

  console.log('\nCSV export helper checks passed.');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
