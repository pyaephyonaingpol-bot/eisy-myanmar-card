/**
 * Smoke tests for daily transaction CSV export helpers.
 * Run: node backend/scripts/test-transaction-csv-export.js
 */
'use strict';

require('../src/lib/loadEnv');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

  section('export service accepts current sources only');
  const exportSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/transactionCsvExportService.js'),
    'utf8'
  );
  assert.ok(exportSrc.includes("src === 'usdt_deposit'"));
  assert.ok(exportSrc.includes("src === 'usdt_withdrawal'"));
  assert.ok(exportSrc.includes("src === 'card_issuance'"));
  assert.ok(exportSrc.includes("src === 'mmk_withdrawal'"));
  assert.ok(!exportSrc.includes("src === 'nowpayments'"));
  console.log('ok');

  section('invalid export source');
  let invalid = false;
  try {
    await buildDailyTransactionsCsv({ date: today, source: 'nowpayments' });
  } catch (err) {
    invalid = err.code === 'INVALID_SOURCE';
  }
  assert.ok(invalid);
  console.log('ok');

  console.log('\nCSV export helper checks passed.');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
