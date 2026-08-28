/**
 * Regression: TronWeb Method._send crashes with
 * "Cannot read properties of undefined (reading 'toLowerCase')"
 * when the contract ABI omits stateMutability.
 *
 * Run: node backend/scripts/test-tron-transfer-abi.js
 */
const { TronWeb } = require('tronweb');
const { USDT_TRC20_ABI } = require('../src/services/tronMasterWalletService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(Array.isArray(USDT_TRC20_ABI) && USDT_TRC20_ABI.length > 0, 'USDT_TRC20_ABI missing');

  for (const entry of USDT_TRC20_ABI) {
    assert(
      typeof entry.stateMutability === 'string' && entry.stateMutability.length > 0,
      `ABI entry "${entry.name}" is missing stateMutability (TronWeb toLowerCase crash)`
    );
  }

  const transfer = USDT_TRC20_ABI.find((e) => e.name === 'transfer');
  assert(transfer, 'transfer ABI missing');
  assert(
    transfer.stateMutability === 'nonpayable' || transfer.stateMutability === 'payable',
    `transfer.stateMutability must be nonpayable/payable, got ${transfer.stateMutability}`
  );

  const pk = 'a'.repeat(64);
  const tw = new TronWeb({ fullHost: 'https://api.trongrid.io', privateKey: pk });
  const from = tw.address.fromPrivateKey(pk);
  const contract = await tw.contract(USDT_TRC20_ABI, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');

  try {
    await contract.methods.transfer(from, '1').send({
      feeLimit: 100_000_000,
      callValue: 0,
      shouldPollResponse: false,
      keepTxID: true,
    });
    console.log('ok: transfer.send completed (unexpected on dummy key, but no toLowerCase crash)');
  } catch (err) {
    const msg = err.message || String(err);
    if (/toLowerCase/.test(msg)) {
      console.error('FAIL: toLowerCase regression still present:', msg);
      process.exit(1);
    }
    // Expected: network / signature / balance errors after clearing the ABI footgun.
    console.log('ok: transfer.send past ABI check; downstream error:', msg.slice(0, 120));
  }

  console.log('All ABI regression checks passed.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
