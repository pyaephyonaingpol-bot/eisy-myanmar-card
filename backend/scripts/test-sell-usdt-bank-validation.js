#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { validateBankDetails } = require('../src/services/withdrawalService');

assert.throws(() => validateBankDetails({
  bank_name: 'Random Bank',
  account_name: 'Alice',
  account_number: '09123456789',
}), /Select your bank/);

const ok = validateBankDetails({
  bank_name: 'KPay',
  account_name: 'Alice Demo',
  account_number: '09123456789',
});
assert.strictEqual(ok.bankName, 'KPay');
assert.strictEqual(ok.accountNumber, '09123456789');

const spaced = validateBankDetails({
  bank_name: 'WavePay',
  account_name: 'Bob',
  account_number: '09 987 654 321',
});
assert.strictEqual(spaced.accountNumber, '09987654321');

console.log('SELL USDT BANK VALIDATION PASSED');
