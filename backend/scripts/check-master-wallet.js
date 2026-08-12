/**
 * Check Hot/Master wallet balances (USDT TRC20 + TRX for gas).
 *
 * Reads MASTER_PRIVATE_KEY (and optional MASTER_WALLET_ADDRESS, TRONGRID_API_KEY)
 * from .env via dotenv, then queries Tron via TronWeb.
 *
 * Usage (from repo root or backend/):
 *   node backend/scripts/check-master-wallet.js
 *   npm run check-master-wallet
 *   npm run check-master-wallet --prefix backend
 */

const path = require('path');

// Prefer backend/.env, then root .env, then process env already set
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config();

const {
  getMasterWalletInfo,
  USDT_TRC20_CONTRACT,
} = require('../src/services/tronMasterWalletService');

function formatNum(n, digits = 6) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

async function main() {
  const info = await getMasterWalletInfo();
  const checkedAt = new Date().toISOString();
  const payload = {
    address: info.address,
    network: 'TRC20',
    usdt_balance: Number(info.usdtBalance) || 0,
    trx_balance: Number(info.trxBalance) || 0,
    usdt_contract: info.contract || USDT_TRC20_CONTRACT,
    checked_at: checkedAt,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(payload, null, 2));
    return info;
  }

  console.log('');
  console.log('=== Master / Hot Wallet Balance ===');
  console.log(`Address:     ${payload.address}`);
  console.log(`Network:     ${payload.network} (TRON)`);
  console.log(`USDT:        ${formatNum(payload.usdt_balance, 6)} USDT`);
  console.log(`TRX (gas):   ${formatNum(payload.trx_balance, 6)} TRX`);
  console.log(`USDT contract: ${payload.usdt_contract}`);
  console.log(`Checked at:  ${payload.checked_at}`);
  console.log('');

  return info;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('');
    console.error('Failed to check master wallet balance:');
    console.error(`  ${err.code ? `[${err.code}] ` : ''}${err.message || err}`);
    console.error('');
    if (err.code === 'MASTER_KEY_MISSING') {
      console.error('Set MASTER_PRIVATE_KEY in backend/.env or the root .env file.');
      console.error('Optional: MASTER_WALLET_ADDRESS, TRONGRID_API_KEY, TRON_FULL_HOST');
    }
    process.exit(1);
  });
}

module.exports = { main };
