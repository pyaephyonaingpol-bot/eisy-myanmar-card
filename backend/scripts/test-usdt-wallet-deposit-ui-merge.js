#!/usr/bin/env node
/**
 * Regression: balance-only wallet payloads must not wipe deposit_addresses.
 * Mirrors Dashboard.syncUsdtWalletBalancesFromPayload merge rules.
 */
'use strict';

function mergeUsdtWalletCache(cache, data) {
  const merged = { ...(cache || {}), ...data };
  if (!Object.prototype.hasOwnProperty.call(data, 'deposit_addresses') && cache?.deposit_addresses) {
    merged.deposit_addresses = cache.deposit_addresses;
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'linked_addresses') && cache?.linked_addresses) {
    merged.linked_addresses = cache.linked_addresses;
  }
  return merged;
}

const cache = {
  deposit_addresses: [{ network: 'TRC20', address: 'TTestAddress111111111111111111111' }],
  linked_addresses: [],
  balance_usdt: 10,
};

const balanceOnly = { balance_usdt: 12, balance_usdt_locked: 0 };
const merged = mergeUsdtWalletCache(cache, balanceOnly);

if (!merged.deposit_addresses || merged.deposit_addresses.length !== 1) {
  console.error('FAIL: deposit addresses wiped by balance-only refresh');
  process.exit(1);
}
if (merged.balance_usdt !== 12) {
  console.error('FAIL: balance not updated');
  process.exit(1);
}

const emptyOverview = mergeUsdtWalletCache(cache, { deposit_addresses: [] });
if (emptyOverview.deposit_addresses.length !== 0) {
  console.error('FAIL: explicit empty deposit_addresses should clear the list');
  process.exit(1);
}

console.log('OK: usdt wallet cache merge preserves deposit addresses');
